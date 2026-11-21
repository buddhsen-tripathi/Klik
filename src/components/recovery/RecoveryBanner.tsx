import { Wrench } from 'lucide-react'
import type { Recovery } from '../../shared/types'
import './Recovery.css'

/** Compact reminder while following a fix plan. */
export default function RecoveryBanner({ recovery, onClear }: { recovery: Recovery; onClear: () => void }) {
  const fixes = recovery.fixSteps.length
  return (
    <div className="recovery-banner" role="note">
      <span>
        <Wrench aria-hidden /> Fix plan: {fixes ? `${fixes} fix${fixes > 1 ? 'es' : ''}, then ` : ''}guide from step {recovery.resumeAt + 1}
      </span>
      <button className="link-btn" onClick={onClear}>
        Full guide
      </button>
    </div>
  )
}
