import type { ScanView } from '../../shared/types'
import { useT } from '../../i18n/useT'

/** One short status line over the 3D view while the scan is still being worked on. */
export default function LiveStatus({ scan }: { scan: ScanView }) {
  const t = useT()
  const p = scan.progress
  const parts = scan.analysis?.parts.length ?? 0
  let title: string
  let detail: string | null = null
  if (scan.stage === 'analyzing') {
    title = p?.phase === 'reviewing' ? t('checkingSteps') : p?.agents?.length ? t('writingSteps') : t('findingParts')
    if (parts) detail = t('partCount', { n: parts })
  } else {
    const fal = p?.fal
    title = t('buildingModel')
    if (fal?.total && fal.total > 1) detail = t('partsOf', { n: fal.done ?? 0, count: fal.total })
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
