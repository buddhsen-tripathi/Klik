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
}

export interface Step {
  /** Parts taken off (disassembly) or put on (assembly) in this step. */
  partIds: string[]
  title: string
  disassembly: string
  assembly: string
  tools: string[]
  caution: string | null
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
}

export type ScanStage = 'queued' | 'analyzing' | 'modeling' | 'done' | 'failed'

/** What GET /api/scans/:id returns. */
export interface ScanView {
  id: string
  createdAt: number
  stage: ScanStage
  photoUrl: string
  width: number
  height: number
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
}
