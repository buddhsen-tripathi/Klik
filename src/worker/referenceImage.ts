import type { Analysis, Part } from '../shared/types'
import { imageSearch, type ImageHit, type ToolTiming } from './clonvo'
import { generateJson } from './gemini'
import { toBase64 } from './util'

/**
 * Reference photos for parts the user's photo can't show (the underside plate, hidden screws).
 * Found with Clonvo image search, then checked by Gemini: the image must clearly show that exact
 * part on the same product, and Gemini boxes the part so SAM 3D models just it. Anything doubtful
 * is rejected and the part stays a simple block. This never touches parts that were scanned.
 */

const CANDIDATES = 6
const MAX_BYTES = 4_000_000
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export interface ReferenceImage {
  dataUri: string
  width: number
  height: number
  /** Gemini box of the part in this image: [ymin, xmin, ymax, xmax], 0-1000. */
  box2d: [number, number, number, number]
  hit: ImageHit
}

/** Pixel size from the file header (JPEG, PNG, WebP), without decoding. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (b[0] === 0x89 && b[1] === 0x50) return { width: dv.getUint32(16), height: dv.getUint32(20) }
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length; ) {
      if (b[i] !== 0xff) return null
      const marker = b[i + 1]
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) }
      i += 2 + dv.getUint16(i + 2)
    }
    return null
  }
  if (String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') {
    const kind = String.fromCharCode(...b.subarray(12, 16))
    if (kind === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) }
    if (kind === 'VP8 ') return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff }
    if (kind === 'VP8L') {
      const bits = dv.getUint32(21, true)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
  }
  return null
}

async function download(hit: ImageHit) {
  try {
    const res = await fetch(hit.image_url, { signal: AbortSignal.timeout(6000), headers: { accept: 'image/jpeg,image/png,image/webp' } })
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim()
    if (!res.ok || !TYPES.has(type)) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.byteLength > MAX_BYTES) return null
    const size = imageSize(buf)
    if (!size || Math.min(size.width, size.height) < 256) return null // too small to model from
    return { hit, type, base64: toBase64(buf.buffer as ArrayBuffer), ...size }
  } catch {
    return null
  }
}

const PICK_SCHEMA = {
  type: 'object',
  properties: {
    best: { type: ['integer', 'null'], description: 'Index of the photo that best shows the part, or null if none qualifies.' },
    box_2d: { type: 'array', items: { type: 'integer' }, description: '[ymin, xmin, ymax, xmax] 0-1000 around the part in that photo.' },
    reason: { type: 'string' },
  },
  required: ['best', 'box_2d', 'reason'],
}

export async function findReferenceImage(opts: {
  geminiKey: string
  clonvoKey: string
  model: string
  analysis: Analysis
  part: Part
  onTiming?: (t: ToolTiming) => void
  traceId?: string
}): Promise<ReferenceImage | null> {
  const { analysis, part } = opts
  const product = analysis.reference?.match !== 'none' && analysis.reference?.product ? analysis.reference.product : analysis.objectName
  const hits = await imageSearch(
    opts.clonvoKey,
    `${product} ${part.name}`,
    `A real photo of the ${part.name} of a ${product}, with the ${part.name} clearly visible (ideally on its own or from an angle that shows its whole shape). Not drawings, diagrams, logos or a different model.`,
    CANDIDATES + 2,
    opts.onTiming,
    opts.traceId,
  )
  const images = (await Promise.all(hits.map(download))).filter((x) => x !== null).slice(0, CANDIDATES)
  if (!images.length) return null

  const pick = await generateJson({
    apiKey: opts.geminiKey,
    model: opts.model,
    images: images.map((i) => ({ base64: i.base64, mimeType: i.type })),
    mediaResolution: 'MEDIA_RESOLUTION_MEDIUM',
    thinkingLevel: 'LOW',
    schema: PICK_SCHEMA,
    text: `These are web photos found for "${product}". We need a 3D model of ONE part we can't see in the user's own photo:
PART: ${part.name}${part.spec ? ` [${part.spec}]` : ''}. Material: ${part.material || 'unknown'}. Rough size: ${part.size.join(' x ')} cm.

Pick the photo that most clearly shows THIS part, and box just that part. Be strict:
- It must be the same product (or an identical model), and the part must be clearly visible and mostly unobstructed.
- Reject drawings, diagrams, renders of a different model, collages, and photos where the part is tiny, cut off or hidden.
- Box only the part itself, not the whole product.
If no photo qualifies, answer best = null. A wrong part is worse than no part.`,
  }).catch(() => null)

  const best = Number.isInteger(pick?.best) ? images[pick.best] : null
  const box = Array.isArray(pick?.box_2d) && pick.box_2d.length === 4 ? (pick.box_2d.map(Number) as [number, number, number, number]) : null
  if (!best || !box || box[2] - box[0] < 20 || box[3] - box[1] < 20) return null
  return { dataUri: `data:${best.type};base64,${best.base64}`, width: best.width, height: best.height, box2d: box, hit: best.hit }
}

/** Hidden parts worth modelling from a reference photo: not in the user's photo, moved by a step, not tiny fasteners. */
export function referenceCandidates(analysis: Analysis, max: number): Part[] {
  const inSteps = new Set(analysis.steps.flatMap((s) => s.partIds))
  return analysis.parts
    .filter((p) => !p.box2d && inSteps.has(p.id) && p.kind !== 'fastener' && Math.max(...p.size) >= 1.5)
    .sort((a, b) => Math.max(...b.size) - Math.max(...a.size))
    .slice(0, max)
}
