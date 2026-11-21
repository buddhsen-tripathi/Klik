import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'
import type { Analysis } from '../shared/types'
import { analyzePhoto } from './gemini'
import { getFalResult, getFalStatus, submitSam3d, type FalJob } from './fal'

export interface ScanParams {
  scanId: string
}

interface ScanRow {
  photo_key: string
  photo_type: string
  width: number
  height: number
  hint: string | null
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

const POLL_EVERY = '10 seconds'
const MAX_POLLS = 60 // about 10 minutes

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

    const loadPhoto = async () => {
      const row = await db.prepare('SELECT photo_key, photo_type, width, height, hint FROM scans WHERE id = ?').bind(scanId).first<ScanRow>()
      if (!row) throw new NonRetryableError(`scan ${scanId} not found`)
      const obj = await this.env.FILES.get(row.photo_key)
      if (!obj) throw new NonRetryableError(`photo missing for scan ${scanId}`)
      const base64 = toBase64(await obj.arrayBuffer())
      return { row, base64 }
    }

    // 1. Gemini: parts, boxes, blockout and steps.
    let analysis: Analysis
    try {
      analysis = await step.do(
        'analyze',
        { retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' }, timeout: '4 minutes' },
        async () => {
          await setFields({ stage: 'analyzing' })
          const { row, base64 } = await loadPhoto()
          const result = await analyzePhoto({
            apiKey: this.env.GEMINI_API_KEY,
            model: this.env.GEMINI_MODEL,
            imageBase64: base64,
            mimeType: row.photo_type,
            hint: row.hint,
          })
          if (result.parts.length === 0) throw new NonRetryableError('Gemini could not find any parts in this photo')
          const hasFal = Boolean(this.env.FAL_KEY)
          await setFields({
            analysis: JSON.stringify(result),
            stage: hasFal ? 'modeling' : 'done',
            model_error: hasFal ? null : 'FAL_KEY is not set, so only the blockout model is available.',
          })
          return result
        },
      )
    } catch (err) {
      await step.do('mark-failed', async () => {
        await setFields({ stage: 'failed', error: String((err as Error)?.message ?? err) })
      })
      return
    }

    if (!this.env.FAL_KEY) return

    // 2. fal SAM 3D: one mesh per visible part. Failures here keep the blockout.
    try {
      const submitted = await step.do(
        'submit-3d',
        { retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' }, timeout: '2 minutes' },
        async () => {
          const { row, base64 } = await loadPhoto()
          const { job, partIds } = await submitSam3d({
            apiKey: this.env.FAL_KEY,
            imageDataUri: `data:${row.photo_type};base64,${base64}`,
            width: row.width,
            height: row.height,
            parts: analysis.parts,
            objectName: analysis.objectName,
          })
          await setFields({ fal_request_id: job.requestId, model_part_ids: JSON.stringify(partIds) })
          return { job, partIds }
        },
      )
      const job: FalJob = submitted.job

      let done = false
      for (let i = 0; i < MAX_POLLS && !done; i++) {
        await step.sleep(`wait-${i}`, POLL_EVERY)
        const status = await step.do(`poll-${i}`, { retries: { limit: 3, delay: '3 seconds' } }, () =>
          getFalStatus(this.env.FAL_KEY, job),
        )
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
