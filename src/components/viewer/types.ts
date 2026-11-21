import type { PartState } from '../../explode'
import type { Analysis, ModelFile } from '../../shared/types'

export type Source = 'blockout' | 'scan'

export interface SizeCheck {
  /** Scan's size along its own principal axes in cm, longest first, when SAM 3D gave real-world placement. */
  measured: [number, number, number] | null
  /** Scan's longest side ÷ the documented/estimated longest side. */
  ratio: number | null
  /** true: shown at its own measured size; false: scaled to the dimensions. */
  usedScanSize: boolean
}

export interface ViewerProps {
  analysis: Analysis
  states: Map<string, PartState>
  source: Source
  /** Scanned meshes (one per parallel SAM 3D job), loaded as they arrive. */
  modelFiles: ModelFile[]
  /** Scan's measured size vs the documented/estimated dimensions. */
  onMeasured?: (check: SizeCheck | null) => void
  /** A scan file failed to load (the view fell back to boxes). */
  onScanError?: () => void
  /** Bump to retry loading the scan after a failure. */
  retryKey?: number
  /** Quarter turns around X, to fix scans that come back lying on their side. */
  orient: number
  /** Turntable: slowly orbit the model. The only mode that renders continuously. */
  spin?: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Zoom to this part (bump `n` to zoom again). */
  focus?: Focus | null
  /** The 3D model is still being built: show no model yet (no block preview). */
  waiting?: boolean
  /** Numbered pins on the current step's parts (same numbers as in the step text). */
  markers?: Marker[]
  onMarker?: (id: string) => void
}

export interface Marker {
  id: string
  n: number
}

export interface Focus {
  id: string
  n: number
}
