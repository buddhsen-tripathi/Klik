import { NonRetryableError } from 'cloudflare:workflows'
import { parsePartialJson } from './partial-json'
import type { Analysis, Group, Identification, Part, RemovalDirection, Step } from '../shared/types'

const API = 'https://generativelanguage.googleapis.com/v1beta/models'

const vec3 = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }
const DIRECTIONS: RemovalDirection[] = ['up', 'down', 'left', 'right', 'front', 'back']

const STEP_ITEM = {
  type: 'object',
  properties: {
    partIds: { type: 'array', items: { type: 'string' } },
    title: { type: 'string' },
    disassembly: { type: 'string', description: 'Imperative instruction for taking these parts off.' },
    assembly: { type: 'string', description: 'Imperative instruction for putting these parts back on.' },
    tools: { type: 'array', items: { type: 'string' } },
    caution: { type: ['string', 'null'] },
  },
  required: ['partIds', 'title', 'disassembly', 'assembly', 'tools', 'caution'],
}

// The planner (main agent). JSON Schema sent as generationConfig.responseJsonSchema.
// It no longer writes steps: those come from one step-writer agent per group.
const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    // Order matters: Gemini writes keys in this order while streaming. Name and best photo come
    // first so the UI and the early 3D submit can use them; parts come before steps.
    objectName: { type: 'string' },
    bestPhotoIndex: {
      type: 'integer',
      description: '0-based index of the photo that shows the most parts with the whole object in frame. All box2d values refer to this photo.',
    },
    researchQuery: {
      type: ['string', 'null'],
      description:
        'Web search query for a manual, teardown/repair guide or spec sheet, when one would help (branded or model-specific products, appliances, electronics, flat-pack furniture). null for simple generic objects.',
    },
    summary: { type: 'string', description: 'One short sentence (max 25 words) on what it is and how it is held together.' },
    dimensions: { ...vec3, description: 'Estimated overall [width, height, depth] in cm.' },
    difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
    estimatedMinutes: { type: 'integer' },
    tools: { type: 'array', items: { type: 'string' } },
    safety: { type: 'array', items: { type: 'string' } },
    parts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Short snake_case id, unique.' },
          name: { type: 'string' },
          material: { type: 'string' },
          visible: { type: 'boolean' },
          box2d: {
            type: ['array', 'null'],
            items: { type: 'integer' },
            minItems: 4,
            maxItems: 4,
            description: 'Tight box around this part in the photo: [ymin, xmin, ymax, xmax] normalised to 0-1000. null if not visible.',
          },
          shape: { type: 'string', enum: ['box', 'cylinder', 'sphere'] },
          size: { ...vec3, description: '[width X, height Y, depth Z] in cm. Cylinder: width = diameter, height = length along its axis.' },
          position: { ...vec3, description: 'Centre of the part in cm in the blockout frame.' },
          rotation: { ...vec3, description: 'Euler rotation in degrees [x, y, z]. A horizontal cylinder along X is [0, 0, 90].' },
          color: { type: 'string', description: 'Hex colour like #8a6d4b, matching the photo.' },
          removalDirection: { type: 'string', enum: DIRECTIONS },
        },
        required: ['id', 'name', 'material', 'visible', 'box2d', 'shape', 'size', 'position', 'rotation', 'color', 'removalDirection'],
      },
    },
    groups: {
      type: 'array',
      description: 'Subassemblies in DISASSEMBLY order (first group comes off first, base/frame group last). Every part id in exactly one group.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Short snake_case id.' },
          name: { type: 'string' },
          partIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'name', 'partIds'],
      },
    },
    assumptions: { type: 'array', items: { type: 'string' } },
  },
  required: ['objectName', 'bestPhotoIndex', 'researchQuery', 'summary', 'dimensions', 'difficulty', 'estimatedMinutes', 'tools', 'safety', 'parts', 'groups', 'assumptions'],
}

function buildPrompt(hint: string | null, photoCount: number): string {
  const photos =
    photoCount > 1
      ? `You get ${photoCount} photos of the SAME object from different angles (photo 0 first). Use all of them to work out the parts, including ones only visible from some angles.
Pick bestPhotoIndex = the photo that shows the most parts with the whole object in frame. Every box2d must refer to THAT photo, and "visible" means visible in that photo.`
      : 'You get one photo. bestPhotoIndex is 0.'
  return `You are a hands-on repair technician. Look at the photos and plan how to take the object apart and put it back together.
${hint ? `The user says this is: "${hint}".\n` : ''}${photos}

Return JSON matching the schema. Rules:

PARTS
- Break the object into the parts a person would actually separate by hand or with common tools (3 to 16 parts). Group tiny identical fasteners into one part (e.g. "4x M6 bolts").
- Include hidden parts you are confident exist (screws under caps, internal brackets) with visible=false and box2d=null, and say so in "assumptions".
- box2d: tight box around each part visible in photo bestPhotoIndex, [ymin, xmin, ymax, xmax] normalised 0-1000. Boxes may overlap.

BLOCKOUT (a rough 3D model built from simple shapes)
- Units are centimetres. +Y is up and the object stands on y = 0. Origin is the centre of its footprint.
- +X is the right side of the photo, +Z points towards the camera.
- Give every part a shape, size, centre position and rotation so the shapes together look like the object. Parts should touch, not float.
- Use realistic real-world sizes.

- removalDirection is the way a part moves when it comes off (screws come out along their axis, a lid lifts "up", a drawer slides "front").

GROUPS (you do NOT write the steps; a specialist writes them for each group)
- Simple objects (up to ~6 parts, or everything held by one joint): ONE group with every part.
- Complex objects: 2 to 5 subassemblies a person would deal with separately (e.g. "Wheels", "Seat assembly", "Frame"), in disassembly order, the base/frame last.
- Every part goes in exactly one group.

RESEARCH
- researchQuery: if you recognise a specific product or model, or the object is an appliance/electronics/flat-pack kit, give a precise search query for its manual or teardown guide (brand + model + "disassembly" or "assembly instructions"). Otherwise null.
- Put power, sharp-edge and spring warnings in "safety".`
}

export interface InlineImage {
  base64: string
  mimeType: string
}

/** One generateContent call with images + text, answered as JSON matching `schema`. */
async function generateJson(opts: {
  apiKey: string
  model: string
  images: InlineImage[]
  text: string
  schema: object
  mediaResolution: 'MEDIA_RESOLUTION_LOW' | 'MEDIA_RESOLUTION_MEDIUM' | 'MEDIA_RESOLUTION_HIGH'
}): Promise<any> {
  const res = await fetch(`${API}/${opts.model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            ...opts.images.flatMap((img, i) => [
              ...(opts.images.length > 1 ? [{ text: `Photo ${i}:` }] : []),
              { inlineData: { mimeType: img.mimeType, data: img.base64 } },
            ]),
            { text: opts.text },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: opts.schema,
        mediaResolution: opts.mediaResolution,
      },
    }),
  })
  if (!res.ok) throw await geminiError(res)
  const body = (await res.json()) as GeminiChunk
  const candidate = body.candidates?.[0]
  const text = candidate?.content?.parts?.filter((p) => !p.thought && p.text).map((p) => p.text).join('')
  if (!text) {
    const reason = body.promptFeedback?.blockReason ?? candidate?.finishReason ?? 'empty response'
    throw new Error(`Gemini returned nothing (${reason})`)
  }
  return JSON.parse(text)
}

export type ThinkingLevel = 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH'

type GeminiChunk = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
}

async function geminiError(res: Response): Promise<Error> {
  const raw = await res.text()
  let message = raw.slice(0, 300)
  try {
    message = JSON.parse(raw)?.error?.message ?? message
  } catch {}
  const msg = `Gemini ${res.status}: ${message}`
  // Bad key / bad request won't fix themselves; only retry rate limits and server errors.
  return res.status < 500 && res.status !== 429 ? new NonRetryableError(msg) : new Error(msg)
}

/**
 * streamGenerateContent over SSE. Calls onText with the full answer text so far, and
 * onThought with each thought-summary chunk. Returns the final answer text.
 */
async function streamText(opts: {
  apiKey: string
  model: string
  images: InlineImage[]
  text: string
  schema: object
  thinkingLevel: ThinkingLevel | null
  onText: (soFar: string) => void
  onThought: (chunk: string) => void
}): Promise<string> {
  const body = (withThinking: boolean) =>
    JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            ...opts.images.flatMap((img, i) => [
              ...(opts.images.length > 1 ? [{ text: `Photo ${i}:` }] : []),
              { inlineData: { mimeType: img.mimeType, data: img.base64 } },
            ]),
            { text: opts.text },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: opts.schema,
        // Several photos at HIGH is a lot of tokens; MEDIUM is plenty for 3+ angles.
        mediaResolution: opts.images.length >= 3 ? 'MEDIA_RESOLUTION_MEDIUM' : 'MEDIA_RESOLUTION_HIGH',
        ...(withThinking && opts.thinkingLevel ? { thinkingConfig: { includeThoughts: true, thinkingLevel: opts.thinkingLevel } } : {}),
      },
    })
  const call = (withThinking: boolean) =>
    fetch(`${API}/${opts.model}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
      body: body(withThinking),
    })

  let res = await call(true)
  // Some models reject thinking settings; fall back to a plain request once.
  if (res.status === 400 && opts.thinkingLevel) {
    const err = await geminiError(res.clone())
    if (/think/i.test(err.message)) res = await call(false)
    else throw err
  }
  if (!res.ok || !res.body) throw await geminiError(res)

  let answer = ''
  let finish: string | undefined
  let blocked: string | undefined
  let buffer = ''
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    let sep: number
    while ((sep = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const event = buffer.slice(0, sep)
      buffer = buffer.slice(sep).replace(/^\r?\n\r?\n/, '')
      const data = event
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('')
      if (!data) continue
      const chunk = JSON.parse(data) as GeminiChunk
      blocked ??= chunk.promptFeedback?.blockReason
      const cand = chunk.candidates?.[0]
      finish = cand?.finishReason ?? finish
      let grew = false
      for (const part of cand?.content?.parts ?? []) {
        if (!part.text) continue
        if (part.thought) opts.onThought(part.text)
        else {
          answer += part.text
          grew = true
        }
      }
      if (grew) opts.onText(answer)
    }
  }
  if (!answer) throw new Error(`Gemini returned nothing (${blocked ?? finish ?? 'empty response'})`)
  return answer
}

/**
 * Full analysis of all photos of one object, streamed. onPartial gets a cleaned-up
 * Analysis with only fully written parts and steps, plus whether the parts list is final.
 */
export async function analyzePhotos(opts: {
  apiKey: string
  model: string
  images: InlineImage[]
  hint: string | null
  thinkingLevel: ThinkingLevel | null
  onPartial?: (partial: Analysis, partsFinal: boolean, raw: any) => void
  onThought?: (chunk: string) => void
}): Promise<{ analysis: Analysis; researchQuery: string | null }> {
  const answer = await streamText({
    apiKey: opts.apiKey,
    model: opts.model,
    images: opts.images,
    text: buildPrompt(opts.hint, opts.images.length),
    schema: ANALYSIS_SCHEMA,
    thinkingLevel: opts.thinkingLevel,
    onThought: (c) => opts.onThought?.(c),
    onText: (soFar) => {
      if (!opts.onPartial) return
      const raw = parsePartialJson(soFar)
      if (!raw || typeof raw !== 'object') return
      // Only keep parts whose last schema field has arrived, so nothing half-defined is drawn.
      const parts = Array.isArray(raw.parts) ? raw.parts.filter((p: any) => p && 'removalDirection' in p) : []
      // Parts are final once Gemini has moved on to the groups.
      const partsFinal = 'groups' in raw
      opts.onPartial(normalizeAnalysis({ ...raw, parts, groups: [] }, opts.images.length), partsFinal, raw)
    },
  })
  const raw = JSON.parse(answer)
  return { analysis: normalizeAnalysis(raw, opts.images.length), researchQuery: typeof raw.researchQuery === 'string' && raw.researchQuery.trim() ? raw.researchQuery.trim() : null }
}

// ---------- step-writer subagent: one per group ----------

const GROUP_STEPS_SCHEMA = {
  type: 'object',
  properties: {
    steps: { type: 'array', description: 'DISASSEMBLY order for this group.', items: STEP_ITEM },
  },
  required: ['steps'],
}

/**
 * Write the steps for one subassembly. Sees the best photo, the full parts list for context,
 * and the web research, but only has to reason about its own group's parts.
 */
export async function writeGroupSteps(opts: {
  apiKey: string
  model: string
  thinkingLevel: ThinkingLevel | null
  image: InlineImage
  analysis: Analysis
  groupIndex: number
  research: string | null
}): Promise<Step[]> {
  const { analysis, groupIndex } = opts
  const groups = analysis.groups ?? []
  const group = groups[groupIndex]
  const mine = new Set(group.partIds)
  const describe = (p: Part) =>
    `- ${p.id}: ${p.name} (${p.material}${p.visible ? '' : ', hidden'}; comes off ${p.removalDirection})`
  const whole = groups.length === 1
  const before = groups.slice(0, groupIndex).map((g) => g.name)
  const after = groups.slice(groupIndex + 1).map((g) => g.name)

  const text = `You are a repair technician writing step-by-step instructions for ${whole ? 'this object' : 'ONE subassembly of this object'}.
Object: ${analysis.objectName}. ${analysis.summary}

${whole ? 'PARTS' : `YOUR GROUP: "${group.name}". Its parts`}:
${analysis.parts.filter((p) => mine.has(p.id)).map(describe).join('\n')}
${
  whole
    ? ''
    : `
Other parts (context only, NOT yours):
${analysis.parts.filter((p) => !mine.has(p.id)).map(describe).join('\n')}

Already removed before your group: ${before.length ? before.join(', ') : 'nothing'}.
Still attached after your group: ${after.length ? after.join(', ') : 'nothing (yours is the base)'}.
`
}
${opts.research ? `REFERENCE MATERIAL from the web (may be for a similar model; prefer it over guessing when it matches):\n${opts.research}\n` : ''}
Write the steps in DISASSEMBLY order${whole ? '' : `: first detach "${group.name}" from what is still attached (unless it is the base), then take it apart`}.
Rules:
- partIds may only use these ids: ${group.partIds.join(', ')}. Each of them in exactly one step, except the one base part that stays put.
- 1 to 3 parts per step. Name the exact tool (e.g. "Phillips #2 screwdriver", "5 mm Allen key").
- "assembly" is the reverse action for the same parts.
- Put power, sharp-edge and spring warnings in "caution".`

  const answer = await streamText({
    apiKey: opts.apiKey,
    model: opts.model,
    images: [opts.image],
    text,
    schema: GROUP_STEPS_SCHEMA,
    thinkingLevel: opts.thinkingLevel,
    onText: () => {},
    onThought: () => {},
  })
  const raw = JSON.parse(answer)
  return normalizeSteps(raw?.steps, new Set(group.partIds)).map((s) => ({ ...s, group: whole ? null : group.name }))
}

const IDENTIFY_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean', description: 'true if one main physical object fills a good part of the frame.' },
    name: { type: 'string', description: 'Specific name, e.g. "Office chair", "Desk fan", "IKEA LACK side table". Empty if not found.' },
    box2d: {
      type: ['array', 'null'],
      items: { type: 'integer' },
      minItems: 4,
      maxItems: 4,
      description: 'Box around the main object: [ymin, xmin, ymax, xmax] normalised 0-1000. null if not found.',
    },
    disassemblable: { type: 'boolean', description: 'Could a person realistically take this apart with hand tools?' },
    tip: { type: 'string', description: 'One short framing tip for scanning it (max 8 words), e.g. "Step back to fit the whole chair".' },
  },
  required: ['found', 'name', 'box2d', 'disassemblable', 'tip'],
}

/** Fast, cheap check of one live camera frame. */
export async function identifyFrame(opts: { apiKey: string; model: string; image: InlineImage }): Promise<Identification> {
  const raw = await generateJson({
    apiKey: opts.apiKey,
    model: opts.model,
    images: [opts.image],
    text: 'This is a live camera frame from someone who wants to scan an object to take it apart or assemble it. Identify the main object.',
    schema: IDENTIFY_SCHEMA,
    mediaResolution: 'MEDIA_RESOLUTION_MEDIUM',
  })
  const box2d = normalizeBox(raw?.box2d)
  const found = raw?.found === true && box2d !== null && str(raw?.name).trim() !== ''
  return {
    found,
    name: found ? str(raw.name).trim().slice(0, 60) : '',
    box2d: found ? box2d : null,
    disassemblable: raw?.disassemblable !== false,
    tip: str(raw?.tip).slice(0, 80),
  }
}

// ---------- clean-up: never trust model output blindly ----------

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback)
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])
const vec = (v: unknown, fallback: [number, number, number]): [number, number, number] =>
  Array.isArray(v) && v.length === 3 ? [num(v[0], fallback[0]), num(v[1], fallback[1]), num(v[2], fallback[2])] : fallback

function normalizeBox(v: unknown): Part['box2d'] {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === 'number')) return null
  const [a, b, c, d] = (v as number[]).map((n) => Math.min(1000, Math.max(0, Math.round(n))))
  const box: [number, number, number, number] = [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)]
  // Drop boxes too small to be useful as a segmentation prompt.
  return box[2] - box[0] < 5 || box[3] - box[1] < 5 ? null : box
}

export function normalizeSteps(raw: unknown, ids: Set<string>): Step[] {
  return (Array.isArray(raw) ? raw : [])
    .map((s: any) => ({
      partIds: strList(s?.partIds).filter((id) => ids.has(id)),
      title: str(s?.title, 'Step'),
      disassembly: str(s?.disassembly),
      assembly: str(s?.assembly),
      tools: strList(s?.tools),
      caution: typeof s?.caution === 'string' && s.caution.trim() ? s.caution : null,
      group: typeof s?.group === 'string' ? s.group : null,
    }))
    .filter((s: Step) => s.partIds.length > 0)
}

/** Each part in exactly one group; leftovers go in the last group; no empty groups. */
function normalizeGroups(raw: unknown, parts: Part[]): Group[] {
  const ids = new Set(parts.map((p) => p.id))
  const taken = new Set<string>()
  const usedIds = new Set<string>()
  const groups: Group[] = []
  for (const [i, g] of (Array.isArray(raw) ? raw : []).entries()) {
    const partIds = strList((g as any)?.partIds).filter((id) => ids.has(id) && !taken.has(id))
    if (!partIds.length) continue
    partIds.forEach((id) => taken.add(id))
    let id = str((g as any)?.id).toLowerCase().replace(/[^a-z0-9_]+/g, '_') || `group_${i + 1}`
    while (usedIds.has(id)) id = `${id}_${i + 1}`
    usedIds.add(id)
    groups.push({ id, name: str((g as any)?.name, `Group ${i + 1}`), partIds })
  }
  const leftovers = parts.map((p) => p.id).filter((id) => !taken.has(id))
  if (leftovers.length) {
    if (groups.length) groups[groups.length - 1].partIds.push(...leftovers)
    else groups.push({ id: 'all', name: 'All parts', partIds: leftovers })
  }
  return groups
}

export function normalizeAnalysis(raw: any, photoCount = 1): Analysis {
  const seen = new Set<string>()
  const parts: Part[] = (Array.isArray(raw?.parts) ? raw.parts : []).map((p: any, i: number) => {
    let id = str(p?.id).trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_') || `part_${i + 1}`
    while (seen.has(id)) id = `${id}_${i + 1}`
    seen.add(id)
    const box2d = normalizeBox(p?.box2d)
    const size = vec(p?.size, [10, 10, 10]).map((n) => Math.max(0.2, Math.abs(n))) as [number, number, number]
    return {
      id,
      name: str(p?.name, id),
      material: str(p?.material, 'unknown'),
      visible: box2d !== null && p?.visible !== false,
      box2d,
      shape: ['box', 'cylinder', 'sphere'].includes(p?.shape) ? p.shape : 'box',
      size,
      position: vec(p?.position, [0, size[1] / 2, 0]),
      rotation: vec(p?.rotation, [0, 0, 0]),
      color: /^#[0-9a-f]{6}$/i.test(str(p?.color)) ? p.color : '#9aa4b2',
      removalDirection: DIRECTIONS.includes(p?.removalDirection) ? p.removalDirection : 'up',
    }
  })

  const ids = new Set(parts.map((p) => p.id))
  const steps = normalizeSteps(raw?.steps, ids)
  const groups = normalizeGroups(raw?.groups, parts)

  const difficulty = ['easy', 'medium', 'hard'].includes(raw?.difficulty) ? raw.difficulty : 'medium'
  return {
    objectName: str(raw?.objectName, 'Unknown object'),
    summary: str(raw?.summary),
    dimensions: vec(raw?.dimensions, [30, 30, 30]),
    difficulty,
    estimatedMinutes: Math.max(1, Math.round(num(raw?.estimatedMinutes, 15))),
    tools: strList(raw?.tools),
    safety: strList(raw?.safety),
    parts,
    steps,
    groups,
    sources: Array.isArray(raw?.sources) ? raw.sources : [],
    assumptions: strList(raw?.assumptions),
    bestPhotoIndex: Math.min(photoCount - 1, Math.max(0, Math.round(num(raw?.bestPhotoIndex, 0)))),
  }
}
