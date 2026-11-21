import type { Recovery } from '../../shared/types'
import RecoveryBanner from './RecoveryBanner'
import RecoveryCard from './RecoveryCard'
import './Recovery.css'

/** Under the stepper: "Check my progress", or the result / fix-plan banner once there is one. */
export default function ProgressAssist(props: {
  recovery: Recovery | null
  stepIndex: number
  onCheck: () => void
  onStart: () => void
  onClear: () => void
}) {
  const { recovery, stepIndex } = props
  if (recovery && stepIndex < 0) return <RecoveryCard recovery={recovery} onStart={props.onStart} onClear={props.onClear} onRecheck={props.onCheck} />
  if (recovery) return <RecoveryBanner recovery={recovery} onClear={props.onClear} />
  return (
    <button className="btn ghost check-progress-btn" onClick={props.onCheck} title="Photograph your build: see what's done, what's off, and continue from there">
      🔍 Check my progress
    </button>
  )
}
