import { useProgress } from '@react-three/drei'

/** Status card while the scanned model's files download and decode. */
export default function ModelLoading() {
  const { active, progress } = useProgress()
  if (!active) return null
  return (
    <div className="live-status" role="status">
      <span className="spinner small" aria-hidden />
      <div>
        <strong>Loading the 3D model…</strong>
        {progress > 0 && progress < 100 && <small>{Math.round(progress)}%</small>}
      </div>
      <div className="viewer-progress" />
    </div>
  )
}
