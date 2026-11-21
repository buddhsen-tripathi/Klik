import type { Part } from '../shared/types'

// SAM 3D Objects: one image + one box per part -> a combined scene GLB with one node per part.
// Schema: https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/sam-3/3d-objects
const SAM3D_ENDPOINT = 'fal-ai/sam-3/3d-objects'

export interface FalJob {
  requestId: string
  statusUrl: string
  responseUrl: string
}

interface FalFile {
  url: string
  content_type?: string | null
}

export interface Sam3dResult {
  model_glb?: FalFile | null
}

async function falFetch(apiKey: string, url: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Key ${apiKey}`, 'content-type': 'application/json', ...init.headers },
  })
  if (!res.ok) throw new Error(`fal ${res.status} on ${new URL(url).pathname}: ${(await res.text()).slice(0, 500)}`)
  return res.json() as Promise<any>
}

/**
 * Submit a SAM 3D job. Each visible part becomes one box prompt (in pixels) with its own object_id,
 * so SAM 3D reconstructs it as a separate object. `partIds` is in box order, which should match
 * the node order in the combined scene GLB.
 */
export async function submitSam3d(opts: {
  apiKey: string
  imageDataUri: string
  width: number
  height: number
  parts: Part[]
  objectName: string
}): Promise<{ job: FalJob; partIds: string[] }> {
  const boxed = opts.parts.filter((p) => p.box2d)
  const box_prompts = boxed.map((p, i) => {
    const [ymin, xmin, ymax, xmax] = p.box2d!
    return {
      object_id: i + 1,
      x_min: Math.round((xmin / 1000) * opts.width),
      y_min: Math.round((ymin / 1000) * opts.height),
      x_max: Math.round((xmax / 1000) * opts.width),
      y_max: Math.round((ymax / 1000) * opts.height),
    }
  })

  const input = {
    image_url: opts.imageDataUri,
    export_textured_glb: true,
    // With boxes, don't let the endpoint's default text prompt ("car") interfere.
    // Without boxes, fall back to segmenting the whole object by name.
    ...(box_prompts.length > 0 ? { box_prompts, prompt: null } : { prompt: opts.objectName }),
  }

  const data = await falFetch(opts.apiKey, `https://queue.fal.run/${SAM3D_ENDPOINT}`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return {
    job: { requestId: data.request_id, statusUrl: data.status_url, responseUrl: data.response_url },
    partIds: boxed.map((p) => p.id),
  }
}

export interface FalStatus {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED'
  queuePosition: number | null
  /** Latest log line from the model, if any. */
  log: string | null
}

export async function getFalStatus(apiKey: string, job: FalJob): Promise<FalStatus> {
  const url = new URL(job.statusUrl)
  url.searchParams.set('logs', '1')
  const data = await falFetch(apiKey, url.toString())
  const logs = Array.isArray(data.logs) ? data.logs : []
  const last = logs.length ? String(logs[logs.length - 1]?.message ?? '').trim() : ''
  return {
    status: data.status,
    queuePosition: typeof data.queue_position === 'number' ? data.queue_position : null,
    log: last ? last.slice(0, 120) : null,
  }
}

export async function getFalResult(apiKey: string, job: FalJob): Promise<Sam3dResult> {
  return falFetch(apiKey, job.responseUrl)
}
