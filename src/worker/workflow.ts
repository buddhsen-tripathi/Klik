import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'
import type { Analysis, ModelFile, ObjectIdentity, Part, Reference, ScanProgress, Step, Timing, Triage } from '../shared/types'
import { answerSpecs, searchPages, type ResearchFindings, type ToolTiming } from './clonvo'
import { exportTrace, traceIdFor } from './otel'
import { findReferenceImage, referenceCandidates } from './referenceImage'
import { triage } from './decisions'
import { analyzePhotos, buildReference, identifyObject, writeGroupSteps, type ThinkingLevel } from './gemini'
import { checkGroup, checkPlan, orderGroups, repairBrief, type GroupResult } from './review'
import { toBase64 } from './util'
import { getOrTranslate } from './translate'
import { isLang } from '../shared/i18n'
import { getFalResult, getFalStatus, layoutsOf, submitSam3d, type FalJob } from './fal'

export interface ScanParams {
  scanId: string
  /** App language when the scan was made: the guide is translated as soon as it's written. */
  lang?: string
}

interface PhotoRow {
  photo_key: string
  photo_type: string
  width: number
  height: number
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
  /** Modelled from a product photo found online (a part the user's photo can't show). */
  reference?: { imageUrl: string; pageUrl: string; title: string }
}

/** At most this many hidden parts get a reference-photo model per scan. */
const MAX_REFERENCE_PARTS = 3

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
 *   →  step writers (parallel, one per subassembly, leave handoff notes)   3D: one SAM 3D job per part, in parallel
 *   →  reviewer (code checks; re-runs only a broken writer, reorders groups from the notes)
 */
export class ScanWorkflow extends WorkflowEntrypoint<Env, ScanParams> {
  async run(event: Readonly<WorkflowEvent<ScanParams>>, step: WorkflowStep) {
    const { scanId } = event.payload
    const lang = isLang(event.payload.lang) && event.payload.lang !== 'en' ? event.payload.lang : null
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

    // Photos never change during a run: read each from D1/R2 and base64 it once, not per step.
    // (A failed read is dropped from the cache so a retry reads again.)
    let rowsP: Promise<PhotoRow[]> | null = null
    const photoRows = () =>
      (rowsP ??= (async () => {
        const { results } = await db
          .prepare('SELECT photo_key, photo_type, width, height FROM scan_photos WHERE scan_id = ? ORDER BY idx')
          .bind(scanId)
          .all<PhotoRow>()
        if (results.length === 0) throw new NonRetryableError(`no photos for scan ${scanId}`)
        return results
      })().catch((err) => {
        rowsP = null
        throw err
      }))
    const photoCache = new Map<string, Promise<string>>()
    const readPhoto = (row: PhotoRow) => {
      let p = photoCache.get(row.photo_key)
      if (!p) {
        p = (async () => {
          const obj = await this.env.FILES.get(row.photo_key)
          if (!obj) throw new NonRetryableError(`photo ${row.photo_key} missing`)
          return toBase64(await obj.arrayBuffer())
        })()
        p.catch(() => photoCache.delete(row.photo_key))
        photoCache.set(row.photo_key, p)
      }
      return p
    }
    const loadImages = async (max = Infinity) => {
      const rows = (await photoRows()).slice(0, max)
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
    const progress: ScanProgress = { fal: null, phase: 'identifying', identity: null, research: null, agents: [] }
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
          attributes: { 'scan.result': note, 'scan.steps_model': this.env.STEPS_MODEL || this.env.GEMINI_MODEL },
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
            timed('triage', async () => triage(this.env.GEMINI_API_KEY, await loadImages(3), hint), (r) => `${r.state}, ${r.complexity}, docs ${r.hasDocs.toFixed(2)}`),
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
    const research = Boolean(this.env.CLONVO_API_KEY) && (!triaged || triaged.hasDocs >= 0.4 || Boolean(identity.model))

    // 2a. Fast research (~2 s): one cited answer about dimensions and fasteners. The planner
    //     only waits for this; the slow page search runs alongside the planner (2b).
    let specFacts: ResearchFindings | null = null
    if (research) {
      progress.phase = 'researching'
      progress.research = { status: 'searching' }
      await saveProgress()
      specFacts = await step
        .do('research-answer', { retries: { limit: 1, delay: '2 seconds' }, timeout: '1 minute' }, () =>
          answerSpecs(this.env.CLONVO_API_KEY, identity.specQuestion, markTool, traceIdFor(scanId)),
        )
        .catch((err) => {
          console.warn('spec answer failed', err)
          return null
        })
      progress.research = { status: 'reading' }
    } else {
      progress.research = { status: this.env.CLONVO_API_KEY ? 'not_needed' : 'skipped' }
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
                  // On the critical path before planning: the fast model (the planner itself is neon).
                  model: this.env.IDENTIFY_MODEL || this.env.GEMINI_MODEL,
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
          onThought: () => {
            firstThought ||= Date.now()
          },
          onPartial: (partial, partsFinal) => {
            if (partial.parts.length && !firstPart) {
              firstPart = Date.now()
              void mark({ name: 'planner.thinking', start: t0, end: firstPart, note: 'request → first part on screen' })
            }
            latest = { ...partial, triage: triaged }
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
        ? { status: 'done', match: reference.match }
        : { status: 'failed' }
      : progress.research
    analysis.reference = reference
    analysis.sources = reference?.sources ?? specFacts?.sources ?? []
    if (reference?.match === 'exact' && reference.dimensions) {
      analysis.dimensions = reference.dimensions
      analysis.dimensionsSource = 'docs'
    } else if (!specFacts && (!reference || reference.match === 'none')) analysis.dimensionsSource = 'estimate'
    const groups = analysis.groups ?? []
    progress.phase = 'writing'
    progress.agents = groups.map((g) => ({ id: g.id, name: g.name }))
    await step.do('attach-reference', async () => {
      await setFields({ analysis: JSON.stringify(analysis), progress: JSON.stringify(progress) })
    })

    // 4. Step-writer subagents, one per subassembly, all in parallel. Each is its own durable
    //    step, so a retry only re-runs the group that failed.
    const bestRow = async () => {
      const rows = await photoRows()
      return rows[Math.min(analysis.bestPhotoIndex, rows.length - 1)]
    }

    const writeGroup = async (i: number, repair?: string) => {
      const row = await bestRow()
      return writeGroupSteps({
        apiKey: this.env.GEMINI_API_KEY,
        model: this.env.STEPS_MODEL || this.env.GEMINI_MODEL,
        thinkingLevel: thinking,
        image: { base64: await readPhoto(row), mimeType: row.photo_type },
        analysis,
        groupIndex: i,
        reference,
        repair,
      })
    }

    const groupResults: GroupResult[] = await Promise.all(
      groups.map((g, i) =>
        step
          .do(`steps-${i}-${g.id}`, { retries: { limit: 2, delay: '3 seconds', backoff: 'exponential' }, timeout: '3 minutes' }, () =>
            timed(
              `writer.${g.name}`,
              () => writeGroup(i),
              (r) => `${r.steps.length} steps · ${r.notes.length} handoff note${r.notes.length === 1 ? '' : 's'}`,
            ),
          )
          .catch(async (err): Promise<GroupResult> => {
            // One agent failing shouldn't sink the scan: fall back to a single generic step for its parts.
            console.warn(`step writer for ${g.name} failed`, err)
            const steps: Step[] = [
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
            return { steps, notes: [], failed: true }
          }),
      ),
    )

    // 5. Reviewer: the writers couldn't see each other, so check the merged plan (plain code),
    //    re-run only the writers whose group has a problem (with the reviewer's notes and the other
    //    writers' handoffs), and fix the group order from the handoff notes. Clean plan = no extra time.
    const reviewStart = Date.now()
    const issues = checkPlan(analysis, groups, groupResults)
    const toRepair = [...new Set(issues.map((x) => x.groupIndex))]
    const fixed: string[] = []
    let results = groupResults
    if (toRepair.length) {
      progress.phase = 'reviewing'
      progress.agents = []
      await step.do('review-start', async () => {
        await saveProgress()
      })
      results = await Promise.all(
        groupResults.map(async (r, i) => {
          if (!toRepair.includes(i)) return r
          const mine = issues.filter((x) => x.groupIndex === i)
          const g = groups[i]
          const repaired = await step
            .do(`repair-${i}-${g.id}`, { retries: { limit: 1, delay: '2 seconds' }, timeout: '3 minutes' }, () =>
              timed(`repair.${g.name}`, () => writeGroup(i, repairBrief(analysis, groups, i, mine, groupResults)), (x) => `${x.steps.length} steps · was: ${mine.map((m) => m.kind).join(', ')}`),
            )
            .catch(() => null)
          if (!repaired) return r
          // Keep the repair only if it actually has fewer problems than the draft.
          const after = checkGroup(analysis, groups, i, repaired, groupResults)
          if (after.length >= mine.length && !r.failed) return r
          fixed.push(...mine.filter((m) => !after.some((a) => a.kind === m.kind)).map((m) => `Fixed: ${m.text}`))
          return { ...repaired, steps: repaired.steps.map((s) => ({ ...s, group: groups.length > 1 ? g.name : null })) }
        }),
      )
    }
    const { order, moves, conflicts } = orderGroups(groups, results)
    fixed.push(...moves)
    const remaining = [...checkPlan(analysis, groups, results).map((x) => x.text), ...conflicts]
    const review = { checked: results.reduce((n, r) => n + r.steps.length, 0), fixed, remaining, notes: results.flatMap((r, i) => r.notes.map((n) => `${groups[i].name}: ${n.text}`)) }
    await mark({
      name: 'reviewer',
      start: reviewStart,
      end: Date.now(),
      note: `${issues.length + moves.length} issue${issues.length + moves.length === 1 ? '' : 's'} found · ${fixed.length} fixed · ${remaining.length} left${remaining.length ? `: ${remaining.join(' ').slice(0, 300)}` : ''}`,
    })

    analysis = await step.do('finish-analysis', async () => {
      const merged: Analysis = { ...analysis, groups: order.map((i) => groups[i]), steps: order.flatMap((i) => results[i].steps), review }
      const hasFal = Boolean(this.env.FAL_KEY)
      const done: ScanProgress = { fal: null, research: null, agents: [] }
      await setFields({
        analysis: JSON.stringify(merged),
        progress: JSON.stringify(done),
        stage: hasFal ? 'modeling' : 'done',
        model_error: hasFal ? null : 'FAL_KEY is not set, so only the blockout model is available.',
      })
      await mark({ name: 'steps ready', start: createdAt, end: Date.now(), note: 'upload → steps on screen' })
      return merged
    })

    // The user's language, ready by the time they open the steps (runs alongside the 3D model).
    const finalGuide = analysis
    const translated = lang
      ? step
          .do(`translate-${lang}`, { retries: { limit: 1, delay: '3 seconds' }, timeout: '2 minutes' }, () =>
            timed(`translate.${lang}`, async () => void (await getOrTranslate(this.env, scanId, finalGuide, lang)), () => lang),
          )
          .catch((err) => console.warn('translation failed; the app will ask again', err))
      : null

    if (!this.env.FAL_KEY) return void (await translated)

    // 6. SAM 3D: parallel jobs (usually one per part). Each finished mesh is copied to R2 straight
    //    away with its pose, so a failed or slow part doesn't hold the others back.
    try {
      // Parts the photo can't show: look for a clear product photo and model just that part from it,
      // in parallel with the main jobs. Best effort; without one the part stays a block.
      const submitReferences = async (a: Analysis): Promise<Job3d[]> => {
        if (!this.env.CLONVO_API_KEY) return []
        const found = await Promise.all(
          referenceCandidates(a, MAX_REFERENCE_PARTS).map(async (part) => {
            const ref = await timed(
              `reference ${part.id}`,
              () =>
                findReferenceImage({
                  geminiKey: this.env.GEMINI_API_KEY,
                  clonvoKey: this.env.CLONVO_API_KEY,
                  model: this.env.IDENTIFY_MODEL || this.env.GEMINI_MODEL,
                  analysis: a,
                  part,
                  onTiming: markTool,
                  traceId: traceIdFor(scanId),
                }),
              (r) => (r ? `photo from ${new URL(r.hit.page_url).hostname}` : 'no clear photo, stays a block'),
            ).catch(() => null)
            if (!ref) return null
            const { job, partIds } = await submitSam3d({
              apiKey: this.env.FAL_KEY,
              imageDataUri: ref.dataUri,
              width: ref.width,
              height: ref.height,
              parts: [{ ...part, box2d: ref.box2d }],
              objectName: part.name,
            })
            return { job, partIds, submittedAt: Date.now(), reference: { imageUrl: ref.hit.image_url, pageUrl: ref.hit.page_url, title: ref.hit.title } }
          }),
        )
        return found.filter((j) => j !== null)
      }
      const [mainJobs, refJobs] = await Promise.all([
        step.do('submit-3d', { retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' }, timeout: '2 minutes' }, () => submitFal(analysis)),
        step
          .do('submit-reference-3d', { retries: { limit: 1, delay: '5 seconds' }, timeout: '2 minutes' }, () => submitReferences(analysis))
          .catch((err): Job3d[] => {
            console.warn('reference models skipped', err)
            return []
          }),
      ])
      const jobs: Job3d[] = [...mainJobs, ...refJobs]
      const files: (ModelFile & { key: string })[] = []
      const finished = new Set<number>()
      const failed = new Set<number>()
      let reported = -1

      for (let i = 0; i < MAX_POLLS && finished.size + failed.size < jobs.length; i++) {
        await step.sleep(`wait-${i}`, POLL_EVERY)
        const pending = jobs.map((_, j) => j).filter((j) => !finished.has(j) && !failed.has(j))
        const statuses = await step.do(`poll-${i}`, { retries: { limit: 3, delay: '3 seconds' } }, async () => {
          const res = await Promise.all(pending.map((j) => getFalStatus(this.env.FAL_KEY, jobs[j].job).catch(() => null)))
          return res.map((s, k) => ({ j: pending[k], s }))
        })
        const completed = statuses.filter((x) => x.s?.status === 'COMPLETED').map((x) => x.j)

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
                const ref = jobs[j].reference
                const key = `scans/${scanId}/${ref ? `ref-${jobs[j].partIds[0]}` : `part-${j}`}.glb`
                const obj = await this.env.FILES.put(key, res.body, { httpMetadata: { contentType: 'model/gltf-binary' } })
                const bytes = obj?.size ?? null
                // Whole job: submit → mesh saved (fal queue + GPU + our download).
                await mark({
                  name: `3D ${jobs[j].partIds.join('+')}`,
                  start: jobs[j].submittedAt ?? t,
                  end: Date.now(),
                  note: `${bytes ? (bytes / 1e6).toFixed(1) : '?'} MB, download ${((Date.now() - t) / 1000).toFixed(1)}s`,
                })
                return {
                  key,
                  url: '',
                  partIds: jobs[j].partIds,
                  layouts: layoutsOf(result),
                  bytes,
                  ...(ref ? { source: 'reference' as const, reference: ref } : {}),
                }
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

        // Live progress: parts done so far; the app can load them as they arrive. Written only when
        // it changes, so the app's polls get "not modified" in between.
        if (finished.size + failed.size === reported) continue
        reported = finished.size + failed.size
        await step.do(`progress-3d-${i}`, async () => {
          const p: ScanProgress = { fal: { done: finished.size, total: jobs.length } }
          await setFields({
            progress: JSON.stringify(p),
            model_files: files.length ? JSON.stringify(files) : null,
            model_bytes: files.reduce((n, f) => n + (f.bytes ?? 0), 0) || null,
          })
        })
      }

      await step.do('finish-3d', async () => {
        const mainFailed = [...failed].filter((j) => !jobs[j].reference).length
        if (!files.some((f) => !f.source)) throw new NonRetryableError(failed.size ? 'every 3D job failed' : '3D generation timed out after 10 minutes')
        await setFields({
          stage: 'done',
          model_error: mainFailed ? `${mainFailed} of ${mainJobs.length} parts couldn't be scanned in 3D; they show as blocks.` : null,
        })
        await mark({ name: 'model ready', start: createdAt, end: Date.now(), note: `${files.length}/${jobs.length} parts` })
      })
      await translated
      await sendTrace(true, 'done')
    } catch (err) {
      await step.do('mark-model-failed', async () => {
        await setFields({ stage: 'done', model_error: `3D model failed: ${String((err as Error)?.message ?? err)}` })
      })
      await translated
      await sendTrace(false, '3D model failed')
    }
  }
}
