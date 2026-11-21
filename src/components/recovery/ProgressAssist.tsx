import type { Recovery } from '../../shared/types'
import RecoveryBanner from './RecoveryBanner'
import RecoveryCard from './RecoveryCard'
import './Recovery.css'

/** Under the stepper: start the live coach (or check a photo), or the result / fix-plan banner once there is one. */
export default function ProgressAssist(props: {
  recovery: Recovery | null
  stepIndex: number
  coach: boolean
  onCoach: () => void
  onCheck: () => void
  onStart: () => void
  onClear: () => void
}) {
  const { recovery, stepIndex } = props
  if (recovery && stepIndex < 0) return <RecoveryCard recovery={recovery} onStart={props.onStart} onClear={props.onClear} onRecheck={props.onCheck} />
  if (recovery) return <RecoveryBanner recovery={recovery} onClear={props.onClear} />
  if (props.coach) return null
  return (
    <div className="assist-row">
      <button className="btn ghost check-progress-btn" onClick={props.onCoach} title="The camera watches while you work: spoken instructions, warnings when something's off">
        🎥 Live coach
      </button>
      <button className="link-btn" onClick={props.onCheck}>
        or check a photo
      </button>
    </div>
  )
}
