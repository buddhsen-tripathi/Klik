import type { Analysis, Part } from '../shared/types'
import { submitFalJob, waitFalJob, type FalJob } from './fal'

/**
 * High-quality model of ONE part, visible or hidden:
 *  1. Nano Banana Pro redraws just that part from the user's photos: complete (hidden sides filled
 *     in), isolated, on white. Hidden parts (underside plates, inner frames) are drawn from what the
 *     product is, which SAM 3D can't do at all.
 *  2. Trellis 2 turns that clean image into a textured mesh.
 * About 15-20 s + 30-50 s; parts run in parallel. Fasteners are drawn in the app instead (exact specs).
 */
const ISOLATE = 'fal-ai/nano-banana-pro/edit'
const MESH = 'fal-ai/trellis-2'

export function isolatePrompt(analysis: Analysis, part: Part): string {
  const one = (part.quantity ?? 1) > 1 ? `ONE single piece (the object has ${part.quantity} identical ones)` : 'the part'
  const where = part.visible
    ? 'It is visible in the photo; match it exactly.'
    : 'It is hidden in the photo (inside or underneath); draw it as it really is for this exact product.'
  return [
    `These photos show: ${analysis.objectName}.`,
    `Make a clean product photo of ${one}: "${part.name}"${part.spec ? ` (${part.spec})` : ''}, made of ${part.material}, removed from the object.`,
    where,
    'Show the complete part with every side filled in, nothing else attached, three-quarter view, centred and filling most of the frame,',
    'on a plain pure white background with soft even studio light and no cast shadows. No other parts, no hands, no text or labels.',
    'Keep its true colours, materials, proportions, holes and mounting features.',
  ].join(' ')
}

/** Stage 1: submit the clean part image (stage boundaries let a durable step reuse a submitted job). */
export const submitIsolate = (apiKey: string, analysis: Analysis, part: Part, photos: string[]): Promise<FalJob> =>
  submitFalJob(apiKey, ISOLATE, { prompt: isolatePrompt(analysis, part), image_urls: photos.slice(0, 3), aspect_ratio: '1:1', resolution: '1K' })

/** Stage 2: wait for the image, then submit the mesh. */
export async function imageThenMesh(apiKey: string, isolate: FalJob): Promise<{ imageUrl: string; mesh: FalJob }> {
  const iso = await waitFalJob<{ images?: { url: string }[] }>(apiKey, isolate, 120_000)
  const imageUrl = iso.images?.[0]?.url
  if (!imageUrl) throw new Error('no isolated part image')
  // Light enough to stream to a phone: ~60k faces, 1K texture.
  const mesh = await submitFalJob(apiKey, MESH, { image_url: imageUrl, resolution: 1024, decimation_target: 60000, texture_size: 1024 })
  return { imageUrl, mesh }
}

/** Stage 3: wait for the mesh. */
export async function meshUrl(apiKey: string, mesh: FalJob): Promise<string> {
  const out = await waitFalJob<{ model_glb?: { url: string } }>(apiKey, mesh, 240_000)
  if (!out.model_glb?.url) throw new Error('no part mesh')
  return out.model_glb.url
}

export async function modelPart(opts: { apiKey: string; analysis: Analysis; part: Part; photos: string[] }): Promise<{ glbUrl: string; imageUrl: string; imageSecs: number; meshSecs: number }> {
  const t0 = Date.now()
  const iso = await waitFalJob<{ images?: { url: string }[] }>(
    opts.apiKey,
    await submitFalJob(opts.apiKey, ISOLATE, { prompt: isolatePrompt(opts.analysis, opts.part), image_urls: opts.photos.slice(0, 3), aspect_ratio: '1:1', resolution: '1K' }),
    90_000,
  )
  const imageUrl = iso.images?.[0]?.url
  if (!imageUrl) throw new Error('no isolated part image')
  const t1 = Date.now()
  const mesh = await waitFalJob<{ model_glb?: { url: string } }>(
    opts.apiKey,
    // Light enough to stream to a phone: ~60k vertices, 1K texture.
    await submitFalJob(opts.apiKey, MESH, { image_url: imageUrl, resolution: 1024, decimation_target: 60000, texture_size: 1024 }),
    180_000,
  )
  const glbUrl = mesh.model_glb?.url
  if (!glbUrl) throw new Error('no part mesh')
  return { glbUrl, imageUrl, imageSecs: Math.round((t1 - t0) / 1000), meshSecs: Math.round((Date.now() - t1) / 1000) }
}

/** Parts worth a high-quality model: every component (fasteners are drawn from their spec in the app). */
export const hqCandidates = (analysis: Analysis, max: number): Part[] =>
  analysis.parts
    .filter((p) => p.kind !== 'fastener')
    .sort((a, b) => Number(b.visible) - Number(a.visible))
    .slice(0, max)
