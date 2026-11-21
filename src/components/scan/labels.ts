import type { ScanView } from '../../shared/types'

/** All user-facing status wording for the scan page in one place. */
export const STAGE_LABEL: Record<ScanView['stage'], string> = {
  queued: 'Queued…',
  analyzing: 'Finding the parts…',
  modeling: 'Building the 3D model…',
  done: 'Ready',
  failed: 'Failed',
}


export const formatMB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
