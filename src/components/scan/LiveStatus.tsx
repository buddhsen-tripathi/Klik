import type { ScanView } from '../../shared/types'

/** One short status line over the 3D view while the scan is still being worked on. */
export default function LiveStatus({ scan }: { scan: ScanView }) {
  const p = scan.progress
  const parts = scan.analysis?.parts.length ?? 0
  let title: string
  let detail: string | null = null
  if (scan.stage === 'analyzing') {
    title = p?.phase === 'reviewing' ? 'Checking the steps…' : p?.agents?.length ? 'Writing the steps…' : 'Finding the parts…'
    if (parts) detail = `${parts} part${parts > 1 ? 's' : ''}`
  } else {
    const fal = p?.fal
    title = 'Building the 3D model…'
    if (fal?.total && fal.total > 1) detail = `${fal.done ?? 0} of ${fal.total} parts`
  }
  return (
    <div className="live-status" role="status">
      <span className="spinner small" aria-hidden />
      <div>
        <strong>{title}</strong>
        {detail && <small>{detail}</small>}
      </div>
      <div className="viewer-progress" />
    </div>
  )
}
