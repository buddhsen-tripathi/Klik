import { NonRetryableError } from 'cloudflare:workflows'
import { parsePartialJson } from './partial-json'
import type { Analysis, Group, Identification, ObjectIdentity, Part, Reference, RemovalDirection, Source, Step, Triage, Handoff } from '../shared/types'
import { partLabel } from '../shared/parts'

const API = 'https://generativelanguage.googleapis.com/v1beta/models'

const vec3 = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }
const DIRECTIONS: RemovalDirection[] = ['up', 'down', 'left', 'right', 'front', 'back']

export const STEP_ITEM = {
  type: 'object',
  properties: {
    partIds: { type: 'array', items: { type: 'string' } },
    title: { type: 'string', description: 'At most 5 words, plain text, no {tokens}. E.g. "Unscrew the chassis screws".' },
    disassembly: {
      type: 'string',
      description:
        'ONE physical action (one verb), at most 18 words. Mention parts ONLY as {part_id} tokens: the app shows each as a numbered marker on the 3D model. E.g. "Unscrew the 4 M3 screws {chassis_screws} with a Phillips #1 driver." or "Lift {body} straight up off {chassis}."',
    },
    assembly: {
      type: 'string',
      description: 'The reverse single action for the same parts, same {part_id} token style, with any alignment note. E.g. "Align {body} over {chassis} so the tabs meet, then lower it."',
    },
    disassembly_details: {
      type: 'array',
      items: { type: 'string' },
      description:
        '1-4 short facts a good manual adds to this action, each under 20 words, same {part_id} tokens: exactly where (which side, which holes), how (direction, angle, how much force), what to watch for, and how to tell it is done (it clicks, it lifts freely, the screw is fully out).',
    },
    assembly_details: {
      type: 'array',
      items: { type: 'string' },
      description: 'Same for putting it back: orientation and alignment marks, order of tightening (e.g. crosswise), torque or "snug, do not overtighten", and how to tell it is seated.',
    },
    tools: { type: 'array', items: { type: 'string' } },
    caution: { type: ['string', 'null'] },
  },
  required: ['partIds', 'title', 'disassembly', 'assembly', 'disassembly_details', 'assembly_details', 'tools', 'caution'],
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
    summary: { type: 'string', description: 'One short sentence (max 25 words) on what it is and how it is held together.' },
    dimensions: { ...vec3, description: 'Overall [width, height, depth] in cm.' },
    dimensionsSource: { type: 'string', enum: ['docs', 'estimate'], description: '"docs" only if taken from the reference sheet.' },
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
          kind: { type: 'string', enum: ['component', 'fastener'] },
          spec: {
            type: ['string', 'null'],
            description: 'Exact spec, e.g. "M4 x 12 mm Phillips pan head", "Ø8 x 30 mm dowel", "15 mm cam lock". null if unknown.',
          },
          quantity: { type: 'integer', description: 'How many identical pieces this part stands for.' },
          // Keep removalDirection last: the stream treats a part as complete once it arrives.
          removalDirection: { type: 'string', enum: DIRECTIONS },
        },
        required: ['id', 'name', 'material', 'visible', 'box2d', 'shape', 'size', 'position', 'rotation', 'color', 'kind', 'spec', 'quantity', 'removalDirection'],
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
    assumptions: { type: 'array', items: { type: 'string' }, description: 'Short guesses the user should double-check, in plain words. Refer to photos as "photo 1", "photo 2" (counting from 1), never by index.' },
  },
  required: ['objectName', 'bestPhotoIndex', 'summary', 'dimensions', 'dimensionsSource', 'difficulty', 'estimatedMinutes', 'tools', 'safety', 'parts', 'groups', 'assumptions'],
}

function referenceText(ref: Reference): string {
  const lines = [
    `Documents describe: ${ref.product} (match with the photographed object: ${ref.match.toUpperCase()})`,
    ref.dimensions ? `Official overall size (W x H x D): ${ref.dimensions.map((n) => +n.toFixed(1)).join(' x ')} cm` : 'Official overall size: not found',
    ref.hardware.length
      ? `Hardware:\n${ref.hardware.map((h) => `- ${h.quantity ?? '?'}x ${h.name}: ${h.spec}${h.usedFor ? ` (used for: ${h.usedFor})` : ''}`).join('\n')}`
      : 'Hardware: not listed',
    ref.components.length ? `Components: ${ref.components.join('; ')}` : '',
    ref.officialSteps.length
      ? `Official ${ref.officialOrder ?? 'step'} order:\n${ref.officialSteps.map((x, i) => `${i + 1}. ${x}`).join('\n')}`
      : '',
    ref.tools.length ? `Tools named in the documents: ${ref.tools.join(', ')}` : '',
    ref.notes.length ? `Notes:\n${ref.notes.map((n) => `- ${n}`).join('\n')}` : '',
  ]
  return lines.filter(Boolean).join('\n')
}

function triageText(t: Triage | null): string {
  if (!t) return ''
  const state = {
    assembled: 'The photos show the object assembled.',
    loose_parts: 'The photos show LOOSE PARTS / an unassembled kit: work out the finished object they make, place every part where it ends up in the blockout, and plan from that.',
    partly_assembled: 'The photos show the object partly assembled: plan the finished object, including the loose parts where they will go.',
  }[t.state]
  const groups = {
    simple: 'Quick check says it is SIMPLE: use exactly ONE group.',
    moderate: 'Quick check says it is MODERATE: 1 to 3 groups.',
    complex: 'Quick check says it is COMPLEX: 2 to 5 groups.',
  }[t.complexity]
  return `${state}\n${groups}\n`
}

function buildPrompt(hint: string | null, photoCount: number, ref: Reference | null, triage: Triage | null = null, specFacts: string | null = null): string {
  const photos =
    photoCount > 1
      ? `You get ${photoCount} photos of the SAME object from different angles (photo 0 first). Use all of them to work out the parts, including ones only visible from some angles.
Pick bestPhotoIndex = the photo that shows the most parts with the whole object in frame. Every box2d must refer to THAT photo, and "visible" means visible in that photo.`
      : 'You get one photo. bestPhotoIndex is 0.'
  return `You are a hands-on repair technician. Look at the photos and plan how to take the object apart and put it back together.
${hint ? `The user says this is: "${hint}".\n` : ''}${photos}
${triageText(triage)}

Return JSON matching the schema. Rules:

PARTS
- Break the object into the parts a person would actually separate by hand or with common tools (3 to 20 parts).
- FASTENERS: one part per fastener TYPE, with kind="fastener", its exact "spec" and "quantity" (e.g. "8x M6 x 30 mm hex bolts" and "4x M4 x 12 mm Phillips screws" are two parts). Never lump different screws, bolts, dowels or cam locks together. Identical ones are one part with a quantity.
- Everything else is kind="component" (quantity > 1 only for identical pieces, e.g. 4 wheels).
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

- Put power, sharp-edge and spring warnings in "safety".
${
  ref && ref.match !== 'none'
    ? `
REFERENCE SHEET (condensed from the manual / repair guides found on the web)
${referenceText(ref)}

How to use it:
- ${ref.match === 'exact' ? 'It is this exact product: use the official dimensions (dimensionsSource="docs") and scale the blockout to them.' : 'It is a SIMILAR product: use it as guidance but trust the photos for sizes (dimensionsSource="estimate" unless the size clearly matches).'}
- Take fastener specs and quantities from the hardware list${ref.match === 'exact' ? '' : ' where they plausibly apply'}; name components the way the documents do.
- The photos win over the documents for what is actually there; mention conflicts in "assumptions".`
    : specFacts
      ? `
SPEC FACTS (a cited web answer about this product's dimensions and fasteners)
${specFacts}
How to use it:
- If it clearly describes THIS product (same brand/model, or obviously the same thing), use its dimensions (dimensionsSource="docs") and its fastener types, sizes and counts (one part per fastener type).
- If it is about a different model or the full-size original of a toy, use it only as a hint (dimensionsSource="estimate").
- The photos win over the text for what is actually there; mention conflicts in "assumptions".`
      : `
No documentation was found: estimate sizes (dimensionsSource="estimate") and give fastener specs only when you can tell from the photos (else spec=null).`
}`
}

export interface InlineImage {
  base64: string
  mimeType: string
}

/** One generateContent call with images + text, answered as JSON matching `schema`. */
export async function generateJson(opts: {
  apiKey: string
  model: string
  images: InlineImage[]
  text: string
  schema: object
  mediaResolution: 'MEDIA_RESOLUTION_LOW' | 'MEDIA_RESOLUTION_MEDIUM' | 'MEDIA_RESOLUTION_HIGH'
  thinkingLevel?: ThinkingLevel
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
        ...(opts.thinkingLevel ? { thinkingConfig: { thinkingLevel: opts.thinkingLevel } } : {}),
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
  // Models differ in which thinking levels they take (Hydrogen has no MINIMAL): step down to LOW,
  // then to the model default.
  if (res.status === 400 && opts.thinkingLevel) {
    const err = await geminiError(res.clone())
    if (!/think/i.test(err.message)) throw err
    if (opts.thinkingLevel !== 'LOW') {
      opts = { ...opts, thinkingLevel: 'LOW' }
      res = await call(true)
    }
    if (res.status === 400) res = await call(false)
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
  reference: Reference | null
  triage?: Triage | null
  /** Fast cited answer (dimensions + fasteners), used while the full reference is still being built. */
  specFacts?: string | null
  thinkingLevel: ThinkingLevel | null
  onPartial?: (partial: Analysis, partsFinal: boolean) => void
  onThought?: (chunk: string) => void
}): Promise<Analysis> {
  const answer = await streamText({
    apiKey: opts.apiKey,
    model: opts.model,
    images: opts.images,
    text: buildPrompt(opts.hint, opts.images.length, opts.reference, opts.triage ?? null, opts.specFacts ?? null),
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
      opts.onPartial(normalizeAnalysis({ ...raw, parts, groups: [] }, opts.images.length), partsFinal)
    },
  })
  return normalizeAnalysis(JSON.parse(answer), opts.images.length)
}

// ---------- research pipeline: identify -> (Clonvo search) -> reference sheet ----------

const IDENTITY_SCHEMA = {
  type: 'object',
  properties: {
    objectName: {
      type: 'string',
      description:
        'Most specific name you can justify, e.g. "IKEA KALLAX 2x2 shelf unit", "Bosch PSB 1800 LI-2 drill", "1:18 diecast model of a Porsche 356 Speedster".',
    },
    scale: {
      type: 'string',
      enum: ['real', 'toy_or_scale_model'],
      description: 'Is this the real full-size thing, or a toy / miniature / scale model of it?',
    },
    brand: { type: ['string', 'null'], description: 'Brand if visible or recognisable, else null.' },
    model: { type: ['string', 'null'], description: 'Model / product line if visible or recognisable, else null.' },
    category: { type: 'string', description: 'Generic category, e.g. "flat-pack bookcase", "cordless drill", "ballpoint pen".' },
    queries: {
      type: 'array',
      items: { type: 'string' },
      minItems: 2,
      maxItems: 3,
      description:
        '2-3 web searches: (1) the official manual / assembly instructions PDF, (2) a teardown or repair guide or parts diagram listing screws, (3) optionally a spec sheet with dimensions. Use brand + model when known, else the category.',
    },
    specQuestion: {
      type: 'string',
      description: 'One question for a cited web answer: exact dimensions plus the screws/fasteners (type, size, count) used in this product.',
    },
  },
  required: ['objectName', 'scale', 'brand', 'model', 'category', 'queries', 'specQuestion'],
}

/** Fast first pass: exactly what is this, and what should we search for? */
export async function identifyObject(opts: {
  apiKey: string
  model: string
  images: InlineImage[]
  hint: string | null
}): Promise<ObjectIdentity> {
  const answer = await streamText({
    apiKey: opts.apiKey,
    model: opts.model,
    images: opts.images,
    text: `Identify the object in ${opts.images.length > 1 ? 'these photos (same object, different angles)' : 'this photo'} as precisely as you can: read logos, labels, model numbers and stickers.
${opts.hint ? `The user pointed their camera at it and it was tagged "${opts.hint}"; trust that for what KIND of thing it is (e.g. a toy vs the real thing).\n` : ''}Watch the scale: a toy car, a model kit or a miniature is NOT the real vehicle/building. Name it as what it physically is, and search for THAT (e.g. the diecast model's own disassembly), not the full-size original.
Then write web searches that would find its manual, a teardown/repair guide listing its screws, and its exact dimensions.`,
    schema: IDENTITY_SCHEMA,
    thinkingLevel: 'LOW',
    onText: () => {},
    onThought: () => {},
  })
  const raw = JSON.parse(answer)
  let name = str(raw?.objectName, opts.hint ?? 'object')
  if (raw?.scale === 'toy_or_scale_model' && !/toy|model|miniature|diecast|scale|replica|kit/i.test(name)) name = `${name} (toy / scale model)`
  const queries = strList(raw?.queries).map((q) => q.trim()).filter(Boolean).slice(0, 3)
  return {
    objectName: name,
    brand: str(raw?.brand).trim() || null,
    model: str(raw?.model).trim() || null,
    category: str(raw?.category, name),
    queries: queries.length ? queries : [`${name} assembly instructions manual`, `${name} disassembly screws`],
    specQuestion: str(raw?.specQuestion).trim() || `What are the exact dimensions of the ${name}, and which screws or fasteners (type, size, count) does it use?`,
  }
}

const REFERENCE_SCHEMA = {
  type: 'object',
  properties: {
    match: {
      type: 'string',
      enum: ['exact', 'similar', 'none'],
      description: 'exact = documents are for this very product/model; similar = same kind of product, different model; none = nothing useful.',
    },
    product: { type: 'string', description: 'The product the documents describe.' },
    dimensions: { type: ['array', 'null'], items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Official [width, height, depth] in cm, converted from the documents. null if not stated.' },
    hardware: {
      type: 'array',
      description: 'Every distinct fastener / hardware type in the documents. One entry per type; never merge different sizes.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'e.g. "Hex bolt", "Cam lock", "Wooden dowel", "Phillips pan-head screw".' },
          spec: { type: 'string', description: 'Size/type exactly as documented, e.g. "M6 x 30 mm", "Ø8 x 30 mm", "#8 x 3/4 in". "unknown" if not given.' },
          quantity: { type: ['integer', 'null'] },
          usedFor: { type: 'string', description: 'Which parts it joins.' },
        },
        required: ['name', 'spec', 'quantity', 'usedFor'],
      },
    },
    components: { type: 'array', items: { type: 'string' }, description: 'Named components / panels from the parts list.' },
    officialOrder: { type: ['string', 'null'], enum: ['assembly', 'disassembly', null], description: 'Which direction officialSteps are written in.' },
    officialSteps: { type: 'array', items: { type: 'string' }, description: 'The documented sequence, one short line per step, max 20.' },
    tools: { type: 'array', items: { type: 'string' }, description: 'Tools the documents name, with sizes.' },
    notes: { type: 'array', items: { type: 'string' }, description: 'Torque values, orientation warnings, hidden clips, things easy to get wrong. Max 8.' },
  },
  required: ['match', 'product', 'dimensions', 'hardware', 'components', 'officialOrder', 'officialSteps', 'tools', 'notes'],
}

/**
 * Condense raw web pages into a small reference sheet, so the planner and step writers get
 * facts (dimensions, every fastener type, official order) instead of 30k characters of pages.
 */
export async function buildReference(opts: {
  apiKey: string
  model: string
  thinkingLevel: ThinkingLevel | null
  identity: ObjectIdentity
  image: InlineImage
  notes: string
  sources: Source[]
}): Promise<Reference> {
  const id = opts.identity
  const answer = await streamText({
    apiKey: opts.apiKey,
    model: opts.model,
    images: [opts.image],
    text: `The photo shows: ${id.objectName}${id.brand ? ` (brand: ${id.brand})` : ''}${id.model ? ` (model: ${id.model})` : ''}, a ${id.category}.
Below are web search results (manuals, guides, spec pages), numbered by source. Extract a reference sheet for taking this object apart and putting it back together.
- Only state facts the pages support; convert inches/mm to cm for dimensions but keep fastener specs exactly as documented.
- Judge "match" honestly against the photo: different model = "similar".
- Every distinct screw/bolt/dowel/cam-lock size is its own hardware entry.

SEARCH RESULTS
${opts.notes}`,
    schema: REFERENCE_SCHEMA,
    thinkingLevel: opts.thinkingLevel,
    onText: () => {},
    onThought: () => {},
  })
  return normalizeReference(JSON.parse(answer), opts.sources)
}

function normalizeReference(raw: any, sources: Source[]): Reference {
  const dims = Array.isArray(raw?.dimensions) && raw.dimensions.length === 3 && raw.dimensions.every((n: unknown) => typeof n === 'number' && n > 0)
  return {
    match: ['exact', 'similar', 'none'].includes(raw?.match) ? raw.match : 'none',
    product: str(raw?.product),
    dimensions: dims ? (raw.dimensions as [number, number, number]) : null,
    hardware: (Array.isArray(raw?.hardware) ? raw.hardware : [])
      .map((h: any) => ({
        name: str(h?.name).trim(),
        spec: str(h?.spec, 'unknown').trim(),
        quantity: typeof h?.quantity === 'number' && h.quantity > 0 ? Math.round(h.quantity) : null,
        usedFor: str(h?.usedFor).trim(),
      }))
      .filter((h: Reference['hardware'][number]) => h.name)
      .slice(0, 20),
    components: strList(raw?.components).slice(0, 30),
    officialSteps: strList(raw?.officialSteps).slice(0, 20),
    officialOrder: raw?.officialOrder === 'assembly' || raw?.officialOrder === 'disassembly' ? raw.officialOrder : null,
    tools: strList(raw?.tools).slice(0, 12),
    notes: strList(raw?.notes).slice(0, 8),
    sources,
  }
}

// ---------- step-writer subagent: one per group ----------

const GROUP_STEPS_SCHEMA = {
  type: 'object',
  properties: {
    steps: { type: 'array', description: 'DISASSEMBLY order for this group.', items: STEP_ITEM },
    handoff: {
      type: 'array',
      description: 'Notes for the other step writers and the reviewer about what your steps assume. Empty if nothing.',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['needs_first', 'note'] },
          partIds: { type: 'array', items: { type: 'string' }, description: 'needs_first: part ids from OTHER groups that must already be off before your first step.' },
          text: { type: 'string', description: 'One short sentence.' },
        },
        required: ['kind', 'partIds', 'text'],
      },
    },
  },
  required: ['steps', 'handoff'],
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
  reference: Reference | null
  /** Reviewer feedback when this writer is re-run to repair its group. */
  repair?: string
}): Promise<{ steps: Step[]; notes: Handoff[] }> {
  const { analysis, groupIndex } = opts
  const groups = analysis.groups ?? []
  const group = groups[groupIndex]
  const mine = new Set(group.partIds)
  const describe = (p: Part) =>
    `- ${p.id}: ${partLabel(p)} (${p.kind === 'fastener' ? 'fastener, ' : ''}${p.material}${p.visible ? '' : ', hidden'}; comes off ${p.removalDirection})`
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
${
  opts.reference && opts.reference.match !== 'none'
    ? `REFERENCE SHEET from the manual / guides (${opts.reference.match} match; follow it where it matches the photo):\n${referenceText(opts.reference)}\n`
    : 'No documentation was found for this object; work from the photo.\n'
}
Write the steps in DISASSEMBLY order${whole ? '' : `: first detach "${group.name}" from what is still attached (unless it is the base), then take it apart`}.
Rules:
- partIds may only use these ids: ${group.partIds.join(', ')}. Each of them in exactly one step, except the one base part that stays put.
- Each step is ONE action someone does with their hands: unscrew one set of identical fasteners, lift off one part, unclip, slide out, align. Never two actions in one step ("unscrew X and lift Y" is two steps).
- So a fastener part gets its own step (unscrew it), and the part it held comes off in the next step. Usually 1 part per step, at most 2 when they come off together in the same motion.
- Mention parts in the instructions only as {part_id} tokens, never by name ("Lift {hood} off {body}"). You may mention a part from another step or group as a reference point.
- An unscrew step gives the fastener count and spec (e.g. "the 4 M4 x 12 mm screws {legs_bolts}") and the tool that fits it (e.g. "Phillips #2 screwdriver", "4 mm Allen key").
- Only state exact sizes that appear in a part's [spec] or in the reference sheet. If a size is not known, describe it plainly and hedge the tool ("the 4 small Phillips screws, likely a #1 driver"); never invent thread sizes or lengths.
- If the documents give an official order, follow it: an official ASSEMBLY order is reversed for disassembly.
- "assembly" is the reverse action for the same parts, with any torque / alignment / orientation note from the documents.
- The action line stays short; the detail goes in disassembly_details / assembly_details, at least as detailed as a good manual: use every relevant fact from the reference sheet (torque, orientation, tightening order, clip locations), and say how to tell the step is done.
- Put power, sharp-edge and spring warnings in "caution".
- handoff: other writers work on the other groups at the same time and can't see you. Leave a "needs_first" note with the part ids from OTHER groups that must be off before your first step, and a "note" for fasteners shared with another group or anything you leave in place.${opts.repair ? `

${opts.repair}` : ''}`

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
  const allIds = new Set(analysis.parts.map((p) => p.id))
  const notes: Handoff[] = (Array.isArray(raw?.handoff) ? raw.handoff : [])
    .filter((n: any) => typeof n?.text === 'string' && n.text.trim())
    .map((n: any) => ({ kind: n.kind === 'needs_first' ? 'needs_first' : 'note', partIds: strList(n.partIds).filter((id) => allIds.has(id) && !mine.has(id)), text: n.text.trim().slice(0, 300) }))
    .slice(0, 6)
  return { steps: normalizeSteps(raw?.steps, mine).map((s) => ({ ...s, group: whole ? null : group.name })), notes }
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
    // Lowest level Hydrogen accepts: keeps the live tag at ~2 s.
    thinkingLevel: 'LOW',
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
      details: { disassembly: strList(s?.disassembly_details).slice(0, 5), assembly: strList(s?.assembly_details).slice(0, 5) },
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
      kind: p?.kind === 'fastener' ? 'fastener' : 'component',
      spec: typeof p?.spec === 'string' && p.spec.trim() && p.spec.trim().toLowerCase() !== 'unknown' ? p.spec.trim() : null,
      quantity: Math.max(1, Math.round(num(p?.quantity, 1))),
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
    dimensionsSource: raw?.dimensionsSource === 'docs' ? 'docs' : 'estimate',
    difficulty,
    estimatedMinutes: Math.max(1, Math.round(num(raw?.estimatedMinutes, 15))),
    tools: strList(raw?.tools),
    safety: strList(raw?.safety),
    parts,
    steps,
    groups,
    sources: Array.isArray(raw?.sources) ? raw.sources : [],
    reference: raw?.reference ?? null,
    triage: raw?.triage ?? null,
    assumptions: strList(raw?.assumptions),
    bestPhotoIndex: Math.min(photoCount - 1, Math.max(0, Math.round(num(raw?.bestPhotoIndex, 0)))),
  }
}
