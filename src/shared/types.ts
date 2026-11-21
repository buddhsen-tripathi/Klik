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
  /** Subassembly this step belongs to, when the object was split between agents. */
  group?: string | null
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
}

export type ScanStage = 'queued' | 'analyzing' | 'modeling' | 'done' | 'failed'

/** What GET /api/scans/:id returns. */
export interface ScanView {
  id: string
  createdAt: number
  stage: ScanStage
  /** All angles the user took, in capture order. */
  photos: ScanPhoto[]
  /** Photo used for the 3D model and the part boxes. */
  modelPhotoIndex: number
  hint: string | null
  analysis: Analysis | null
  /** Combined scene GLB from SAM 3D (all parts placed together, one node per part). */
  modelUrl: string | null
  /** Size of the GLB, so the app can load it only when the user asks. */
  modelBytes: number | null
  /** Part ids in the order they were sent to SAM 3D as box prompts (= node order in the GLB). */
  modelPartIds: string[]
  error: string | null
  /** 3D generation failed or was skipped; the blockout still works. */
  modelError: string | null
  /** Live status while the scan runs. */
  progress: ScanProgress | null
}

export interface AgentProgress {
  id: string
  name: string
  status: 'running' | 'done' | 'failed'
}

export interface ScanProgress {
  /** Latest heading from Gemini's thought summary, e.g. "Identifying the fasteners". */
  thought: string | null
  /** Parts list is complete (Gemini is now writing steps). */
  partsFinal: boolean
  fal: { status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED'; queuePosition: number | null; log: string | null } | null
  /** Pipeline phase while analyzing. */
  phase?: 'identifying' | 'researching' | 'planning' | 'writing'
  /** What we think it is, from the identify pass. */
  identity?: { objectName: string; brand: string | null; model: string | null } | null
  triage?: Triage | null
  /** Web lookup for manuals/specs (Clonvo). */
  research?: {
    status: 'searching' | 'reading' | 'done' | 'failed' | 'skipped' | 'not_needed'
    queries: string[]
    sources: Source[]
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
  createdAt: number
  stage: ScanStage
  photoUrl: string | null
  objectName: string | null
  hint: string | null
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
