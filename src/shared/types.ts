// Types shared by the Worker and the React app.

/** Direction a part moves when it is taken off. Axes match the blockout frame below. */
export type RemovalDirection = 'up' | 'down' | 'left' | 'right' | 'front' | 'back'

/**
 * One part of the object.
 *
 * Blockout frame (used by `shape`, `size`, `position`):
 *   units = centimetres, +Y up, object stands on y = 0,
 *   origin = centre of the object's footprint,
 *   +X = right side of the photo, +Z = towards the camera.
 */
export interface Part {
  id: string
  name: string
  material: string
  /** Visible in the photo. Hidden parts are inferred by Gemini and have no box. */
  visible: boolean
  /** Gemini box in the photo: [ymin, xmin, ymax, xmax], each 0-1000. Null if not visible. */
  box2d: [number, number, number, number] | null
  shape: 'box' | 'cylinder' | 'sphere'
  /** [width X, height Y, depth Z] in cm. For a cylinder: width = diameter, height = length along Y. */
  size: [number, number, number]
  /** Centre of the part in cm. */
  position: [number, number, number]
  /** Euler rotation in degrees [x, y, z]. */
  rotation: [number, number, number]
  color: string
  removalDirection: RemovalDirection
  /** Fasteners are listed in the hardware table and shown as chips on steps. Missing on old scans. */
  kind?: 'component' | 'fastener'
  /** Exact spec when known, e.g. "M4 × 12 mm Phillips pan head" or "Ø8 × 30 mm wooden dowel". */
  spec?: string | null
  /** How many identical pieces this part stands for (4 for "4x M6 bolts"). */
  quantity?: number
}

/** What the web research found, condensed for the planner and the step writers. */
export interface Reference {
  /** How well the documents match the photographed object. */
  match: 'exact' | 'similar' | 'none'
  /** The product the documents describe. */
  product: string
  /** Official overall size [width, height, depth] in cm, if the documents give it. */
  dimensions: [number, number, number] | null
  hardware: { name: string; spec: string; quantity: number | null; usedFor: string }[]
  /** Named components from the manual / parts list. */
  components: string[]
  /** Official assembly order (or teardown order for repair guides), short lines. */
  officialSteps: string[]
  officialOrder: 'assembly' | 'disassembly' | null
  tools: string[]
  notes: string[]
  sources: Source[]
}

/** Quick routing decisions (Gemini Decisions API) made alongside the identify pass. */
export interface Triage {
  /** Probability an official manual / repair guide exists online. */
  hasDocs: number
  state: 'assembled' | 'loose_parts' | 'partly_assembled'
  stateConfidence: number
  complexity: 'simple' | 'moderate' | 'complex'
  complexityConfidence: number
}

/** First pass: exactly what is this, and what to search for. */
export interface ObjectIdentity {
  objectName: string
  brand: string | null
  model: string | null
  category: string
  queries: string[]
  specQuestion: string
}

export interface Step {
  /** Parts taken off (disassembly) or put on (assembly) in this step. */
  partIds: string[]
  title: string
  disassembly: string
  assembly: string
  tools: string[]
  caution: string | null
  /** Manual-level detail for the action, per direction: where exactly, orientation, force or torque, and how to tell it's done. Same {part_id} tokens. Missing on older scans. */
  details?: { disassembly: string[]; assembly: string[] } | null
  /** Subassembly this step belongs to, when the object was split between agents. */
  group?: string | null
  /** Rewritten after people ran into problems on it (live coach, "this step is wrong", photo checks). */
  revision?: { at: number; reasons: string[]; count: number } | null
}

/** Note a step writer leaves for the others and the reviewer. */
export interface Handoff {
  /** needs_first: these parts (from other groups) must already be off. note: anything else to know. */
  kind: 'needs_first' | 'note'
  partIds: string[]
  text: string
}

/** What the reviewer checked and fixed after the parallel step writers. */
export interface PlanReview {
  checked: number
  fixed: string[]
  remaining: string[]
  notes: string[]
}

export interface Group {
  id: string
  name: string
  partIds: string[]
}

export interface Source {
  title: string
  url: string
}

export interface Analysis {
  objectName: string
  summary: string
  /** Overall size in cm [width, height, depth]. */
  dimensions: [number, number, number]
  difficulty: 'easy' | 'medium' | 'hard'
  estimatedMinutes: number
  tools: string[]
  safety: string[]
  parts: Part[]
  /** Disassembly order. Assembly is the same list reversed. */
  steps: Step[]
  /** Things Gemini had to guess (hidden fasteners, internals). Shown to the user. */
  assumptions: string[]
  /** Subassemblies in disassembly order; each one gets its own step-writing agent. Missing on old scans. */
  groups?: Group[]
  /** Manuals / guides found on the web and given to the step writers. */
  sources?: Source[]
  /** Reference sheet from the web research, when there was one. */
  reference?: Reference | null
  /** Where the overall dimensions came from. */
  dimensionsSource?: 'docs' | 'estimate'
  /** Routing decisions; state picks the default mode (loose parts → put together). */
  triage?: Triage | null
  /** Photo (0-based) Gemini picked for the 3D model. Every part's box2d refers to this photo. */
  bestPhotoIndex: number
  /** Reviewer's report on the merged plan. */
  review?: PlanReview | null
}

export type ScanStage = 'queued' | 'analyzing' | 'modeling' | 'done' | 'failed'

/** What GET /api/scans/:id returns. */
export interface ScanView {
  id: string
  stage: ScanStage
  /** All angles the user took, in capture order. */
  photos: ScanPhoto[]
  /** Photo used for the 3D model and the part boxes. */
  modelPhotoIndex: number
  analysis: Analysis | null
  /** Size of the GLB, so the app can load it only when the user asks. */
  modelBytes: number | null
  error: string | null
  /** 3D generation failed or was skipped; the blockout still works. */
  modelError: string | null
  /** Live status while the scan runs. */
  progress: ScanProgress | null
  /** Scanned meshes: one file per parallel SAM 3D job (or the single combined file on old scans). */
  modelFiles: ModelFile[]
  /** Latest "check my progress" result, if any. */
  recovery: Recovery | null
}

/** SAM 3D pose of one object: Z-up object space → PyTorch3D camera space (quaternion w,x,y,z). */
export interface Layout {
  scale: number
  rotation: [number, number, number, number]
  translation: [number, number, number]
}

export interface ModelFile {
  url: string
  /** Parts in this file, in node order. */
  partIds: string[]
  /** One pose per part; empty on old combined scans (no placement known). */
  layouts: Layout[]
  bytes: number | null
  /**
   * 'reference': a part the user's photo can't show (underside, hidden screws), modelled from a
   * product photo found online. Only ever used for parts with no scan; scale it uniformly to the
   * part's size and keep its own shape.
   */
  source?: 'photo' | 'reference'
  reference?: { imageUrl: string; pageUrl: string; title: string }
}

export interface Timing {
  name: string
  start: number
  end: number
  /** Clonvo generation id: look it up with GET https://api.clonvo.com/v1/generation?id=… */
  generationId?: string | null
  /** OpenTelemetry span id (Clonvo tool calls nest their gateway span under it). */
  spanId?: string
  note?: string
}

export interface AgentProgress {
  id: string
  name: string
}

export interface ScanProgress {
  /** 3D: how many of the parallel per-part jobs have finished. */
  fal: { done: number; total: number } | null
  /** Pipeline phase while analyzing. */
  phase?: 'identifying' | 'researching' | 'planning' | 'writing' | 'reviewing'
  /** What we think it is, from the identify pass. */
  identity?: { objectName: string; brand: string | null; model: string | null } | null
  /** Web lookup for manuals/specs (Clonvo). */
  research?: {
    status: 'searching' | 'reading' | 'done' | 'failed' | 'skipped' | 'not_needed'
    match?: Reference['match']
  } | null
  /** Step-writing subagents, one per subassembly. */
  agents?: AgentProgress[]
}

export interface ScanPhoto {
  url: string
  width: number
  height: number
}

/** Short status used by the background tray (GET /api/scans?ids=...). */
export interface ScanSummary {
  id: string
  stage: ScanStage
  photoUrl: string | null
  objectName: string | null
}

/** POST /api/identify: what's in the live camera frame. */
export interface Identification {
  found: boolean
  name: string
  /** [ymin, xmin, ymax, xmax], 0-1000, relative to the frame that was sent. */
  box2d: [number, number, number, number] | null
  /** Can a person realistically take this apart? */
  disassemblable: boolean
  /** One short framing tip, e.g. "Step back so the whole chair fits". */
  tip: string
}

/** "Check my progress": where the user actually is, what went wrong, and how to carry on. */
export interface Recovery {
  createdAt: number
  mode: 'disassemble' | 'assemble'
  /** One or two sentences, shown and spoken. */
  summary: string
  /** One entry per step, in the order the user follows them in this mode. */
  stepStatus: { index: number; status: 'done' | 'not_done' | 'wrong' | 'unsure'; note: string | null }[]
  mistakes: { stepIndex: number | null; problem: string; fix: string }[]
  /** Steps to put things right first (e.g. take the wheel off and refit it the other way). */
  fixSteps: Step[]
  /** Index (in mode order) of the first step still to do after the fixes; = steps.length when finished. */
  resumeAt: number
  photoUrl: string | null
  note: string | null
}

/** GET /api/shop: one product from Shop (shop.dev). Price in the currency's minor units. */
export interface ShopProduct {
  title: string
  price: { amount: number; currency: string } | null
  seller: string | null
  /** Product page to buy it (kept exactly as Shop returned it). */
  url: string
  image: string | null
  available: boolean
  rating: { value: number; count: number | null } | null
  /** For checkout: the exact variant and the seller's storefront domain (null: product page only). */
  variantId?: string | null
  shop?: string | null
}
