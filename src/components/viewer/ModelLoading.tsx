import { useProgress } from '@react-three/drei'
import { useT } from '../../i18n/useT'

/** Status card while the scanned model's files download and decode. */
export default function ModelLoading() {
  const t = useT()
  const { active, progress } = useProgress()
  if (!active) return null
  return (
    <div className="live-status" role="status">
      <span className="spinner small" aria-hidden />
      <div>
        <strong>{t('loadingModel')}</strong>
        {progress > 0 && progress < 100 && <small>{Math.round(progress)}%</small>}
      </div>
      <div className="viewer-progress" />
    </div>
  )
}
