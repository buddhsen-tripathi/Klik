import type { Analysis, Part } from '../shared/types'
import { submitFalJob, waitFalJob, type FalJob } from './fal'

/**
 * High-quality model of ONE part, visible or hidden:
 *  1. Nano Banana Pro (Gemini API) redraws just that part from the user's photos: complete (hidden sides filled
 *     in), isolated, on white. Hidden parts (underside plates, inner frames) are drawn from what the
 *     product is, which SAM 3D can't do at all.
 *  2. Trellis 2 turns that clean image into a textured mesh.
 * About 15-20 s + 30-50 s; parts run in parallel. Fasteners are drawn in the app instead (exact specs).
 */
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

/**
 * Stage 1: the clean part image, from Nano Banana Pro on the Gemini API (same key as the rest of the
 * app, no fal credits). Returns the PNG bytes as base64.
 */
export async function isolateImage(opts: { apiKey: string; model: string; analysis: Analysis; part: Part; photos: { base64: string; mimeType: string }[] }): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
    body: JSON.stringify({
      contents: [{ parts: [...opts.photos.slice(0, 3).map((p) => ({ inlineData: { mimeType: p.mimeType, data: p.base64 } })), { text: isolatePrompt(opts.analysis, opts.part) }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: '1K' } },
    }),
    signal: AbortSignal.timeout(120_000),
  })
  const body = (await res.json().catch(() => null)) as any
  if (!res.ok) throw new Error(`part image ${res.status}: ${body?.error?.message ?? 'failed'}`)
  const img = body?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData
  if (!img?.data) throw new Error('no isolated part image')
  return { base64: img.data, mimeType: img.mimeType ?? 'image/png' }
}

/** Stage 2: submit the mesh for a clean part image (a data URI works as fal input). */
export const submitMesh = (apiKey: string, image: { base64: string; mimeType: string }): Promise<FalJob> =>
  // Light enough to stream to a phone: ~60k faces, 1K texture.
  submitFalJob(apiKey, MESH, { image_url: `data:${image.mimeType};base64,${image.base64}`, resolution: 1024, decimation_target: 60000, texture_size: 1024 })

/** Stage 3: wait for the mesh. */
export async function meshUrl(apiKey: string, mesh: FalJob): Promise<string> {
  const out = await waitFalJob<{ model_glb?: { url: string } }>(apiKey, mesh, 240_000)
  if (!out.model_glb?.url) throw new Error('no part mesh')
  return out.model_glb.url
}

/** Parts worth a high-quality model: every component (fasteners are drawn from their spec in the app). */
export const hqCandidates = (analysis: Analysis, max: number): Part[] =>
  analysis.parts
    .filter((p) => p.kind !== 'fastener')
    .sort((a, b) => Number(b.visible) - Number(a.visible))
    .slice(0, max)
