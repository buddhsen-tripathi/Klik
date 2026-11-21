import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'
import type { Analysis, ModelFile, ObjectIdentity, Part, Reference, ScanProgress, Step, Timing, Triage } from '../shared/types'
import { answerSpecs, searchPages, type ResearchFindings, type ToolTiming } from './clonvo'
import { exportTrace, traceIdFor } from './otel'
import { triage } from './decisions'
import { analyzePhotos, buildReference, identifyObject, writeGroupSteps, type ThinkingLevel } from './gemini'
import { getFalResult, getFalStatus, layoutsOf, submitSam3d, type FalJob, type FalStatus } from './fal'

export interface ScanParams {
  scanId: string
}

interface PhotoRow {
  photo_key: string
  photo_type: string
  width: number
  height: number
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

const POLL_EVERY = '3 seconds'
const MAX_POLLS = 200 // about 10 minutes
const LIVE_WRITE_MS = 1000 // how often streamed progress is saved for the app to poll

/** One SAM 3D job: a few parts (usually one). SAM 3D time grows ~25 s per box, so jobs run in parallel. */
interface Job3d {
  job: FalJob
  partIds: string[]
  /** Epoch ms, for the waterfall. */
  submittedAt?: number
}

/** Latest bold heading from Gemini's thought summaries ("**Identifying fasteners**"), or the last sentence. */
function thoughtHeadline(buf: string): string | null {
  const heads = [...buf.matchAll(/\*\*(.+?)\*\*/g)]
  if (heads.length) return heads[heads.length - 1][1].trim().slice(0, 80)
  const sentences = buf.trim().split(/(?<=[.!?])\s+/)
  const last = sentences[sentences.length - 1]?.trim()
  return last ? last.slice(0, 80) : null
}

const THINKING_LEVELS: ThinkingLevel[] = ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']

/** Split the boxed parts into at most `maxJobs` jobs, biggest boxes first so they start earliest. */
function planJobs(parts: Part[], maxJobs: number): string[][] {
  const area = (p: Part) => (p.box2d ? (p.box2d[2] - p.box2d[0]) * (p.box2d[3] - p.box2d[1]) : 0)
  const boxed = parts.filter((p) => p.box2d).sort((a, b) => area(b) - area(a))
  const n = Math.max(1, Math.min(maxJobs, boxed.length))
  const jobs: string[][] = Array.from({ length: n }, () => [])
  boxed.forEach((p, i) => jobs[i % n].push(p.id))
  return jobs.filter((j) => j.length)
}

/**
 * One instance per scan. Each step.do() result is stored by Workflows, so if the Worker
 * restarts mid-way it resumes from the last finished step instead of paying again.
 *
 * Critical path (what the user waits for):
 *   identify ‖ triage  →  cited spec answer  →  planner (streams parts; 3D jobs start when parts are final)
 *                                               ‖ page search + reference sheet
 *   →  step writers (parallel, one per subassembly)          3D: one SAM 3D job per part, in parallel
 */
export class ScanWorkflow extends WorkflowEntrypoint<Env, ScanParams> {
  async run(event: Readonly<WorkflowEvent<ScanParams>>, step: WorkflowStep) {
    const { scanId } = event.payload
    const db = this.env.DB

    const setFields = (fields: Record<string, string | number | null>) => {
      const keys = Object.keys(fields)
      return db
        .prepare(`UPDATE scans SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
        .bind(...keys.map((k) => fields[k]), scanId)
        .run()
    }

    // Latency waterfall: append-only, atomic per row update, never fails the scan.
    const mark = (t: Timing) =>
      db
        .prepare(`UPDATE scans SET timings = json_insert(coalesce(timings, '[]'), '$[#]', json(?)) WHERE id = ?`)
        .bind(JSON.stringify(t), scanId)
        .run()
        .catch(() => {})
    const timed = async <T>(name: string, fn: () => Promise<T>, note?: (r: T) => string | undefined): Promise<T> => {
      const start = Date.now()
      try {
        const r = await fn()
        await mark({ name, start, end: Date.now(), note: note?.(r) })
        return r
      } catch (err) {
        await mark({ name, start, end: Date.now(), note: `failed: ${String((err as Error)?.message ?? err).slice(0, 120)}` })
        throw err
      }
    }
    const markTool = (t: ToolTiming) =>
      mark({ name: t.name, start: t.start, end: t.end, generationId: t.generationId, spanId: t.spanId, note: [t.provider, t.cached ? 'cached' : '', t.ok ? '' : 'failed'].filter(Boolean).join(' · ') || undefined })

    const photoRows = async () => {
      const { results } = await db
        .prepare('SELECT photo_key, photo_type, width, height FROM scan_photos WHERE scan_id = ? ORDER BY idx')
        .bind(scanId)
        .all<PhotoRow>()
      if (results.length === 0) throw new NonRetryableError(`no photos for scan ${scanId}`)
      return results
    }
    const readPhoto = async (row: PhotoRow) => {
      const obj = await this.env.FILES.get(row.photo_key)
      if (!obj) throw new NonRetryableError(`photo ${row.photo_key} missing`)
      return toBase64(await obj.arrayBuffer())
    }
    const loadImages = async () => {
      const rows = await photoRows()
      return Promise.all(rows.map(async (r) => ({ base64: await readPhoto(r), mimeType: r.photo_type })))
    }

    /**
     * Submit the SAM 3D jobs once per scan (one per part, in parallel), reusing an earlier
     * submission, e.g. the early one made while the planner was still streaming.
     */
    const maxJobs = Math.max(1, Number(this.env.MAX_3D_JOBS) || 10)
    const submitFal = async (a: Analysis): Promise<Job3d[]> => {
      const existing = await db.prepare('SELECT fal_job FROM scans WHERE id = ?').bind(scanId).first<{ fal_job: string | null }>()
      if (existing?.fal_job) {
        const saved = JSON.parse(existing.fal_job)
        if (Array.isArray(saved)) return saved as Job3d[]
      }
      const rows = await photoRows()
      const row = rows[Math.min(a.bestPhotoIndex, rows.length - 1)]
      const imageDataUri = `data:${row.photo_type};base64,${await readPhoto(row)}`
      const byId = new Map(a.parts.map((p) => [p.id, p]))
      const plan = planJobs(a.parts, maxJobs)
      const jobs = await timed(
        'fal.submit',
        () =>
          Promise.all(
            plan.map(async (ids) => {
              const { job, partIds } = await submitSam3d({
                apiKey: this.env.FAL_KEY,
                imageDataUri,
                width: row.width,
                height: row.height,
                parts: ids.map((id) => byId.get(id)!),
                objectName: a.objectName,
              })
              return { job, partIds, submittedAt: Date.now() }
            }),
          ),
        (j) => `${j.length} parallel job${j.length > 1 ? 's' : ''}`,
      )
      await setFields({
        fal_job: JSON.stringify(jobs),
        fal_request_id: jobs[0]?.job.requestId ?? null,
        model_part_ids: JSON.stringify(jobs.flatMap((j) => j.partIds)),
      })
      return jobs
    }

    const thinking = THINKING_LEVELS.find((l) => l === this.env.ANALYSIS_THINKING) ?? null
    const progress: ScanProgress = { thought: null, partsFinal: false, fal: null, phase: 'identifying', identity: null, research: null, agents: [] }
    const saveProgress = () => setFields({ progress: JSON.stringify(progress) })
    /** Send the whole run to Clonvo Traces (one trace per scan, built from the waterfall). */
    const sendTrace = (ok: boolean, note?: string) =>
      step.do('export-trace', async () => {
        if (!this.env.CLONVO_API_KEY) return
        const row = await db.prepare('SELECT timings, created_at FROM scans WHERE id = ?').bind(scanId).first<{ timings: string | null; created_at: number }>()
        const timings: Timing[] = row?.timings ? JSON.parse(row.timings) : []
        await exportTrace({
          apiKey: this.env.CLONVO_API_KEY,
          scanId,
          name: 'scan',
          start: row?.created_at ?? Math.min(...timings.map((t) => t.start), Date.now()),
          end: Math.max(...timings.map((t) => t.end), Date.now()),
          timings,
          model: this.env.GEMINI_MODEL,
          attributes: { 'scan.result': note },
          ok,
        })
      })
    const fail = async (err: unknown) => {
      await step.do('mark-failed', async () => {
        await setFields({ stage: 'failed', error: String((err as Error)?.message ?? err) })
      })
      await sendTrace(false, String((err as Error)?.message ?? err).slice(0, 200))
    }

    // In a step so a replay (e.g. after a restart during 3D polling) doesn't reset the stage.
    const createdAt = await step.do('start', async () => {
      const row = await db.prepare('SELECT created_at FROM scans WHERE id = ?').bind(scanId).first<{ created_at: number }>()
      const now = Date.now()
      await setFields({ stage: 'analyzing', fal_job: null, timings: '[]', model_files: null, progress: JSON.stringify(progress) })
      if (row) await mark({ name: 'queue', start: row.created_at, end: now, note: 'upload → workflow start' })
      return row?.created_at ?? now
    })
    const hintRow = await db.prepare('SELECT hint FROM scans WHERE id = ?').bind(scanId).first<{ hint: string | null }>()
    const hint = hintRow?.hint ?? null

    // 1. Identify (Hydrogen) ‖ triage (Decisions API, ~0.5 s).
    let identity: ObjectIdentity
    let triaged: Triage | null
    try {
      ;[identity, triaged] = await Promise.all([
        step.do('identify', { retries: { limit: 2, delay: '3 seconds', backoff: 'exponential' }, timeout: '2 minutes' }, () =>
          timed('identify', async () => identifyObject({ apiKey: this.env.GEMINI_API_KEY, model: this.env.IDENTIFY_MODEL, images: await loadImages(), hint }), (r) => r.objectName),
        ),
        // Routing is a bonus: without it the planner and research just use their defaults.
        step
          .do('triage', { retries: { limit: 1, delay: '2 seconds' }, timeout: '1 minute' }, () =>
            timed('triage', async () => triage(this.env.GEMINI_API_KEY, await loadImages(), hint), (r) => `${r.state}, ${r.complexity}, docs ${r.hasDocs.toFixed(2)}`),
          )
          .catch((err) => {
            console.warn('triage failed', err)
            return null
          }),
      ])
    } catch (err) {
      return fail(err)
    }
    progress.identity = { objectName: identity.objectName, brand: identity.brand, model: identity.model }
    progress.triage = triaged
    const research = Boolean(this.env.CLONVO_API_KEY) && (!triaged || triaged.hasDocs >= 0.4 || Boolean(identity.model))

    // 2a. Fast research (~2 s): one cited answer about dimensions and fasteners. The planner
    //     only waits for this; the slow page search runs alongside the planner (2b).
    let specFacts: ResearchFindings | null = null
    if (research) {
      progress.phase = 'researching'
      progress.research = { status: 'searching', queries: [identity.specQuestion, ...identity.queries], sources: [] }
      await saveProgress()
      specFacts = await step
        .do('research-answer', { retries: { limit: 1, delay: '2 seconds' }, timeout: '1 minute' }, () =>
          answerSpecs(this.env.CLONVO_API_KEY, identity.specQuestion, markTool, traceIdFor(scanId)),
        )
        .catch((err) => {
          console.warn('spec answer failed', err)
          return null
        })
      progress.research = { status: 'reading', queries: identity.queries, sources: specFacts?.sources ?? [] }
    } else {
      progress.research = { status: this.env.CLONVO_API_KEY ? 'not_needed' : 'skipped', queries: [], sources: [] }
    }

    // 2b. Slow research: manual / teardown pages + the cited answer → reference sheet for the
    //     step writers (official order, every fastener). Runs in parallel with the planner.
    const referenceP: Promise<Reference | null> = research
      ? step
          .do('research-pages', { retries: { limit: 1, delay: '5 seconds' }, timeout: '3 minutes' }, async () => {
            const pages = await searchPages(this.env.CLONVO_API_KEY, identity.queries, markTool, specFacts?.sources.length ?? 0, traceIdFor(scanId)).catch((err) => {
              console.warn('page search failed', err)
              return null
            })
            const notes = (specFacts?.notes ?? '') + (pages?.notes ?? '')
            if (!notes) return null
            const [first] = await photoRows()
            return timed(
              'research.condense',
              async () =>
                buildReference({
                  apiKey: this.env.GEMINI_API_KEY,
                  model: this.env.STEPS_MODEL || this.env.GEMINI_MODEL,
                  thinkingLevel: thinking,
                  identity,
                  image: { base64: await readPhoto(first), mimeType: first.photo_type },
                  notes,
                  sources: [...(specFacts?.sources ?? []), ...(pages?.sources ?? [])],
                }),
              (r) => `${r.match} match, ${r.hardware.length} hardware types`,
            )
          })
          .catch((err) => {
            console.warn('reference failed, continuing without it', err)
            return null
          })
      : Promise.resolve(null)

    // 3. Planner (main agent), streamed: parts (one per fastener type), blockout, groups.
    //    The 3D jobs start as soon as the parts list is final.
    const plannerP = step.do(
      'analyze',
      { retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' }, timeout: '4 minutes' },
      async () => {
        progress.phase = 'planning'
        await setFields({ fal_job: null, progress: JSON.stringify(progress) })
        const images = await loadImages()

        let thoughtBuf = ''
        let latest: Analysis | null = null
        let lastWrite = 0
        let writes: Promise<unknown> = Promise.resolve()
        let early: Promise<unknown> | null = null
        const t0 = Date.now()
        let firstThought = 0
        let firstPart = 0
        const save = () => {
          const now = Date.now()
          if (now - lastWrite < LIVE_WRITE_MS) return
          lastWrite = now
          const fields: Record<string, string> = { progress: JSON.stringify(progress) }
          if (latest) fields.analysis = JSON.stringify(latest)
          writes = writes.then(() => setFields(fields)).catch(() => {})
        }

        const analysis = await analyzePhotos({
          apiKey: this.env.GEMINI_API_KEY,
          model: this.env.GEMINI_MODEL,
          images,
          hint: hint && hint !== identity.objectName ? `${identity.objectName} (camera tag: ${hint})` : identity.objectName,
          reference: null,
          specFacts: specFacts?.notes || null,
          triage: triaged,
          thinkingLevel: thinking,
          onThought: (chunk) => {
            firstThought ||= Date.now()
            thoughtBuf = (thoughtBuf + chunk).slice(-2000)
            progress.thought = thoughtHeadline(thoughtBuf)
            save()
          },
          onPartial: (partial, partsFinal) => {
            if (partial.parts.length && !firstPart) {
              firstPart = Date.now()
              void mark({ name: 'planner.thinking', start: t0, end: firstPart, note: 'request → first part on screen' })
            }
            latest = { ...partial, triage: triaged }
            progress.partsFinal = partsFinal
            save()
            if (partsFinal && !early && this.env.FAL_KEY && partial.parts.length > 0) {
              void mark({ name: 'planner.parts', start: firstPart || t0, end: Date.now(), note: `${partial.parts.length} parts streamed` })
              early = submitFal(partial).catch((err) => console.warn('early fal submit failed, will retry', err))
            }
          },
        })
        if (analysis.parts.length === 0) throw new NonRetryableError('Gemini could not find any parts in this photo')
        await mark({ name: 'planner', start: t0, end: Date.now(), note: `${analysis.parts.length} parts, ${analysis.groups?.length ?? 0} groups${firstThought ? `, first thought ${((firstThought - t0) / 1000).toFixed(1)}s` : ''}` })
        await early
        await writes
        analysis.triage = triaged
        progress.thought = null
        progress.partsFinal = true
        await setFields({
          analysis: JSON.stringify(analysis),
          progress: JSON.stringify(progress),
          model_photo_index: analysis.bestPhotoIndex,
        })
        return analysis
      },
    )

    let analysis: Analysis
    let reference: Reference | null
    try {
      ;[analysis, reference] = await Promise.all([plannerP, referenceP])
    } catch (err) {
      return fail(err)
    }

    // Attach the reference: official dimensions win on an exact match.
    progress.research = research
      ? reference
        ? { status: 'done', queries: identity.queries, sources: reference.sources, match: reference.match }
        : { status: 'failed', queries: identity.queries, sources: specFacts?.sources ?? [] }
      : progress.research
    analysis.reference = reference
    analysis.sources = reference?.sources ?? specFacts?.sources ?? []
    if (reference?.match === 'exact' && reference.dimensions) {
      analysis.dimensions = reference.dimensions
      analysis.dimensionsSource = 'docs'
    } else if (!specFacts && (!reference || reference.match === 'none')) analysis.dimensionsSource = 'estimate'
    const groups = analysis.groups ?? []
    progress.phase = 'writing'
    progress.agents = groups.map((g) => ({ id: g.id, name: g.name, status: 'running' as const }))
    await step.do('attach-reference', async () => {
      await setFields({ analysis: JSON.stringify(analysis), progress: JSON.stringify(progress) })
    })

    // 4. Step-writer subagents, one per subassembly, all in parallel. Each is its own durable
    //    step, so a retry only re-runs the group that failed.
    const bestRow = async () => {
      const rows = await photoRows()
      return rows[Math.min(analysis.bestPhotoIndex, rows.length - 1)]
    }
    const markAgent = (i: number, status: 'done' | 'failed') =>
      db
        .prepare(`UPDATE scans SET progress = json_set(progress, '$.agents[${i}].status', ?) WHERE id = ?`)
        .bind(status, scanId)
        .run()
        .catch(() => {})

    const groupSteps = await Promise.all(
      groups.map((g, i) =>
        step
          .do(`steps-${i}-${g.id}`, { retries: { limit: 2, delay: '3 seconds', backoff: 'exponential' }, timeout: '3 minutes' }, () =>
            timed(
              `writer.${g.name}`,
              async () => {
                const row = await bestRow()
                const steps = await writeGroupSteps({
                  apiKey: this.env.GEMINI_API_KEY,
                  model: this.env.STEPS_MODEL || this.env.GEMINI_MODEL,
                  thinkingLevel: thinking,
                  image: { base64: await readPhoto(row), mimeType: row.photo_type },
                  analysis,
                  groupIndex: i,
                  reference,
                })
                await markAgent(i, 'done')
                return steps
              },
              (s) => `${s.length} steps`,
            ),
          )
          .catch(async (err): Promise<Step[]> => {
            // One agent failing shouldn't sink the scan: fall back to a single generic step for its parts.
            console.warn(`step writer for ${g.name} failed`, err)
            await markAgent(i, 'failed')
            return [
              {
                partIds: g.partIds,
                title: `Remove the ${g.name.toLowerCase()}`,
                disassembly: `Detach the ${g.name.toLowerCase()} (${g.partIds.length} part${g.partIds.length > 1 ? 's' : ''}).`,
                assembly: `Fit the ${g.name.toLowerCase()} back in place.`,
                tools: [],
                caution: null,
                group: groups.length > 1 ? g.name : null,
              },
            ]
          }),
      ),
    )

    analysis = await step.do('finish-analysis', async () => {
      const merged: Analysis = { ...analysis, steps: groupSteps.flat() }
      const hasFal = Boolean(this.env.FAL_KEY)
      const done: ScanProgress = { thought: null, partsFinal: true, fal: null, research: null, agents: [] }
      await setFields({
        analysis: JSON.stringify(merged),
        progress: JSON.stringify(done),
        stage: hasFal ? 'modeling' : 'done',
        model_error: hasFal ? null : 'FAL_KEY is not set, so only the blockout model is available.',
      })
      await mark({ name: 'steps ready', start: createdAt, end: Date.now(), note: 'upload → steps on screen' })
      return merged
    })

    if (!this.env.FAL_KEY) return

    // 5. SAM 3D: parallel jobs (usually one per part). Each finished mesh is copied to R2 straight
    //    away with its pose, so a failed or slow part doesn't hold the others back.
    try {
      const jobs = await step.do('submit-3d', { retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' }, timeout: '2 minutes' }, () =>
        submitFal(analysis),
      )
      const files: (ModelFile & { key: string })[] = []
      const finished = new Set<number>()
      const failed = new Set<number>()
      let lastStatus: FalStatus | null = null

      for (let i = 0; i < MAX_POLLS && finished.size + failed.size < jobs.length; i++) {
        await step.sleep(`wait-${i}`, POLL_EVERY)
        const pending = jobs.map((_, j) => j).filter((j) => !finished.has(j) && !failed.has(j))
        const statuses = await step.do(`poll-${i}`, { retries: { limit: 3, delay: '3 seconds' } }, async () => {
          const res = await Promise.all(pending.map((j) => getFalStatus(this.env.FAL_KEY, jobs[j].job).catch(() => null)))
          return res.map((s, k) => ({ j: pending[k], s }))
        })
        const completed = statuses.filter((x) => x.s?.status === 'COMPLETED').map((x) => x.j)
        lastStatus = statuses.find((x) => x.s && x.s.status !== 'COMPLETED')?.s ?? lastStatus

        // Save the newly finished meshes in parallel.
        const saved = await Promise.all(
          completed.map((j) =>
            step
              .do(`save-3d-${j}`, { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' }, timeout: '3 minutes' }, async () => {
                const t = Date.now()
                const result = await getFalResult(this.env.FAL_KEY, jobs[j].job)
                const url = result.model_glb?.url
                if (!url) throw new NonRetryableError('fal returned no GLB file')
                const res = await fetch(url)
                if (!res.ok || !res.body) throw new Error(`GLB download failed: ${res.status}`)
                const key = `scans/${scanId}/part-${j}.glb`
                const obj = await this.env.FILES.put(key, res.body, { httpMetadata: { contentType: 'model/gltf-binary' } })
                const bytes = obj?.size ?? null
                // Whole job: submit → mesh saved (fal queue + GPU + our download).
                await mark({
                  name: `3D ${jobs[j].partIds.join('+')}`,
                  start: jobs[j].submittedAt ?? t,
                  end: Date.now(),
                  note: `${bytes ? (bytes / 1e6).toFixed(1) : '?'} MB, download ${((Date.now() - t) / 1000).toFixed(1)}s`,
                })
                return { key, url: '', partIds: jobs[j].partIds, layouts: layoutsOf(result), bytes }
              })
              .then((f) => ({ j, f }))
              .catch((err) => {
                console.warn(`3D job ${j} failed`, err)
                return { j, f: null }
              }),
          ),
        )
        for (const { j, f } of saved) {
          if (f) {
            finished.add(j)
            files.push(f)
          } else failed.add(j)
        }

        // Live progress: parts done so far; the app can load them as they arrive.
        await step.do(`progress-3d-${i}`, async () => {
          const p: ScanProgress = {
            thought: null,
            partsFinal: true,
            fal: {
              status: lastStatus?.status === 'IN_QUEUE' && finished.size === 0 ? 'IN_QUEUE' : 'IN_PROGRESS',
              queuePosition: lastStatus?.queuePosition ?? null,
              log: lastStatus?.log ?? null,
              done: finished.size,
              total: jobs.length,
            },
          }
          await setFields({
            progress: JSON.stringify(p),
            model_files: files.length ? JSON.stringify(files) : null,
            model_bytes: files.reduce((n, f) => n + (f.bytes ?? 0), 0) || null,
          })
        })
      }

      await step.do('finish-3d', async () => {
        if (files.length === 0) throw new NonRetryableError(failed.size ? 'every 3D job failed' : '3D generation timed out after 10 minutes')
        await setFields({
          stage: 'done',
          model_error: failed.size ? `${failed.size} of ${jobs.length} parts couldn't be scanned in 3D; they show as blocks.` : null,
        })
        await mark({ name: 'model ready', start: createdAt, end: Date.now(), note: `${files.length}/${jobs.length} parts` })
      })
      await sendTrace(true, 'done')
    } catch (err) {
      await step.do('mark-model-failed', async () => {
        await setFields({ stage: 'done', model_error: `3D model failed: ${String((err as Error)?.message ?? err)}` })
      })
      await sendTrace(false, '3D model failed')
    }
  }
}
