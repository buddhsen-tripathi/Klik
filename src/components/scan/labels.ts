import type { Reference, ScanView, Triage } from '../../shared/types'

/** All user-facing status wording for the scan page in one place. */
export const STAGE_LABEL: Record<ScanView['stage'], string> = {
  queued: 'Queued…',
  analyzing: 'Gemini is identifying the parts…',
  modeling: 'Building the 3D model…',
  done: 'Ready',
  failed: 'Failed',
}

export const TRIAGE_STATE: Record<Triage['state'], string> = { assembled: 'Assembled', loose_parts: 'Loose parts / kit', partly_assembled: 'Partly assembled' }
export const MATCH_LABEL: Record<Reference['match'], string> = { exact: 'Exact manual match', similar: 'Similar model’s manual', none: 'No matching manual' }

export const formatMB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
