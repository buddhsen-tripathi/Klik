import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'
import type { Analysis, ScanProgress, Step } from '../shared/types'
import { researchObject, type Research } from './clonvo'
import { analyzePhotos, writeGroupSteps, type ThinkingLevel } from './gemini'
import { getFalResult, getFalStatus, submitSam3d, type FalJob } from './fal'

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

interface SubmittedJob {
  job: FalJob
  partIds: string[]
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

/**
 * One instance per scan. Each step.do() result is stored by Workflows, so if the
 * Worker restarts mid-way it resumes from the last finished step instead of
 * paying for Gemini or fal again.
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

    /** Submit SAM 3D once per scan. Reuses an earlier submission (e.g. the early one from the stream). */
    const submitFal = async (a: Analysis): Promise<SubmittedJob> => {
      const existing = await db.prepare('SELECT fal_job FROM scans WHERE id = ?').bind(scanId).first<{ fal_job: string | null }>()
      if (existing?.fal_job) return JSON.parse(existing.fal_job) as SubmittedJob
      // SAM 3D takes one image: the one Gemini picked, which its part boxes refer to.
      const rows = await photoRows()
      const row = rows[Math.min(a.bestPhotoIndex, rows.length - 1)]
      const submitted = await submitSam3d({
        apiKey: this.env.FAL_KEY,
        imageDataUri: `data:${row.photo_type};base64,${await readPhoto(row)}`,
        width: row.width,
        height: row.height,
        parts: a.parts,
        objectName: a.objectName,
      })
      await setFields({
        fal_job: JSON.stringify(submitted),
        fal_request_id: submitted.job.requestId,
        model_part_ids: JSON.stringify(submitted.partIds),
      })
      return submitted
    }

    const thinking = THINKING_LEVELS.find((l) => l === this.env.ANALYSIS_THINKING) ?? null

    // 1. Planner (main agent), streamed: name, parts, blockout, subassembly groups, and whether
    //    to look anything up. Research and the 3D job start mid-stream, as soon as they can.
    let planned: { analysis: Analysis; research: Research | null }
    try {
      planned = await step.do(
        'analyze',
        { retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' }, timeout: '4 minutes' },
        async () => {
          await setFields({ stage: 'analyzing', fal_job: null })
          const scan = await db.prepare('SELECT hint FROM scans WHERE id = ?').bind(scanId).first<{ hint: string | null }>()
          const rows = await photoRows()
          const images = await Promise.all(rows.map(async (r) => ({ base64: await readPhoto(r), mimeType: r.photo_type })))

          // Save the partial analysis + latest thought ~1x/s so the app can draw parts as they arrive.
          const progress: ScanProgress = { thought: null, partsFinal: false, fal: null, research: null, agents: [] }
          let thoughtBuf = ''
          let latest: Analysis | null = null
          let lastWrite = 0
          let writes: Promise<unknown> = Promise.resolve()
          let early: Promise<unknown> | null = null
          let researching: Promise<Research | null> | null = null
          const save = (force = false) => {
            const now = Date.now()
            if (!force && now - lastWrite < LIVE_WRITE_MS) return
            lastWrite = now
            const fields: Record<string, string> = { progress: JSON.stringify(progress) }
            if (latest) fields.analysis = JSON.stringify(latest)
            writes = writes.then(() => setFields(fields)).catch(() => {})
          }
          const startResearch = (query: string) => {
            if (researching || !this.env.CLONVO_API_KEY) return
            progress.research = { status: 'searching', query, sources: [] }
            save(true)
            researching = researchObject(this.env.CLONVO_API_KEY, query).then(
              (r) => {
                progress.research = { status: 'done', query, sources: r.sources }
                save(true)
                return r
              },
              (err) => {
                // Research is a bonus: the step writers fall back to the photo alone.
                console.warn('research failed', err)
                progress.research = { status: 'failed', query, sources: [] }
                save(true)
                return null
              },
            )
          }

          const { analysis, researchQuery } = await analyzePhotos({
            apiKey: this.env.GEMINI_API_KEY,
            model: this.env.GEMINI_MODEL,
            images,
            hint: scan?.hint ?? null,
            thinkingLevel: thinking,
            onThought: (chunk) => {
              thoughtBuf = (thoughtBuf + chunk).slice(-2000)
              progress.thought = thoughtHeadline(thoughtBuf)
              save()
            },
            onPartial: (partial, partsFinal, raw) => {
              latest = partial
              progress.partsFinal = partsFinal
              save()
              // The planner writes researchQuery right after the name, so the lookup overlaps the parts.
              if (typeof raw?.researchQuery === 'string' && raw.researchQuery.trim()) startResearch(raw.researchQuery.trim())
              // Start the 3D job as soon as the parts are final, while the planner is still grouping.
              if (partsFinal && !early && this.env.FAL_KEY && partial.parts.length > 0) {
                early = submitFal(partial).catch((err) => console.warn('early fal submit failed, will retry', err))
              }
            },
          })
          if (analysis.parts.length === 0) throw new NonRetryableError('Gemini could not find any parts in this photo')
          if (researchQuery) startResearch(researchQuery)
          // (cast: TS can't see the assignment inside the stream callbacks)
          const research = await (researching as Promise<Research | null> | null)
          await early
          await writes

          progress.thought = null
          progress.partsFinal = true
          progress.agents = (analysis.groups ?? []).map((g) => ({ id: g.id, name: g.name, status: 'running' as const }))
          analysis.sources = research?.sources ?? []
          await setFields({
            analysis: JSON.stringify(analysis),
            progress: JSON.stringify(progress),
            model_photo_index: analysis.bestPhotoIndex,
          })
          return { analysis, research }
        },
      )
    } catch (err) {
      await step.do('mark-failed', async () => {
        await setFields({ stage: 'failed', error: String((err as Error)?.message ?? err) })
      })
      return
    }

    // 2. Step-writer subagents, one per subassembly, all in parallel. Each is its own durable
    //    step, so a retry only re-runs the group that failed.
    let analysis = planned.analysis
    const groups = analysis.groups ?? []
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
          .do(`steps-${i}-${g.id}`, { retries: { limit: 2, delay: '3 seconds', backoff: 'exponential' }, timeout: '3 minutes' }, async () => {
            const row = await bestRow()
            const steps = await writeGroupSteps({
              apiKey: this.env.GEMINI_API_KEY,
              model: this.env.STEPS_MODEL || this.env.GEMINI_MODEL,
              thinkingLevel: thinking,
              image: { base64: await readPhoto(row), mimeType: row.photo_type },
              analysis,
              groupIndex: i,
              research: planned.research?.notes || null,
            })
            await markAgent(i, 'done')
            return steps
          })
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
      const progress: ScanProgress = { thought: null, partsFinal: true, fal: null, research: null, agents: [] }
      await setFields({
        analysis: JSON.stringify(merged),
        progress: JSON.stringify(progress),
        stage: hasFal ? 'modeling' : 'done',
        model_error: hasFal ? null : 'FAL_KEY is not set, so only the blockout model is available.',
      })
      return merged
    })

    if (!this.env.FAL_KEY) return

    // 2. fal SAM 3D: one mesh per visible part. Failures here keep the blockout.
    try {
      // Usually already submitted from the stream; this reuses that job.
      const submitted = await step.do(
        'submit-3d',
        { retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' }, timeout: '2 minutes' },
        () => submitFal(analysis),
      )
      const job: FalJob = submitted.job

      let done = false
      for (let i = 0; i < MAX_POLLS && !done; i++) {
        await step.sleep(`wait-${i}`, POLL_EVERY)
        const status = await step.do(`poll-${i}`, { retries: { limit: 3, delay: '3 seconds' } }, async () => {
          const s = await getFalStatus(this.env.FAL_KEY, job)
          const progress: ScanProgress = { thought: null, partsFinal: true, fal: s }
          await setFields({ progress: JSON.stringify(progress) })
          return s.status
        })
        done = status === 'COMPLETED'
      }
      if (!done) throw new Error('3D generation timed out after 10 minutes')

      // 3. Copy the combined scene GLB into R2 (fal file links are not permanent).
      //    It already has one node per part, so the per-part GLBs fal also returns aren't needed.
      await step.do('save-model', { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' }, timeout: '5 minutes' }, async () => {
        const result = await getFalResult(this.env.FAL_KEY, job)
        const url = result.model_glb?.url
        if (!url) throw new NonRetryableError('fal returned no GLB file')
        const res = await fetch(url)
        if (!res.ok || !res.body) throw new Error(`GLB download failed: ${res.status}`)
        const key = `scans/${scanId}/scene.glb`
        const obj = await this.env.FILES.put(key, res.body, { httpMetadata: { contentType: 'model/gltf-binary' } })
        await setFields({ model_key: key, model_bytes: obj?.size ?? null, stage: 'done' })
      })
    } catch (err) {
      await step.do('mark-model-failed', async () => {
        await setFields({ stage: 'done', model_error: `3D model failed: ${String((err as Error)?.message ?? err)}` })
      })
    }
  }
}
