import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import type { ReactNode } from 'react'

/** Bottom dock: helper buttons on the left, Back + a big Next in thumb reach. */
export default function Stepper({
  stepIndex,
  count,
  writing,
  onStep,
  extra,
}: {
  stepIndex: number
  count: number
  writing?: boolean
  onStep: (i: number) => void
  extra?: ReactNode
}) {
  const last = stepIndex >= count - 1
  return (
    <div className="dock">
      {extra && <div className="dock-extra">{extra}</div>}
      <button className="btn ghost dock-back" onClick={() => onStep(stepIndex - 1)} disabled={stepIndex < 0} aria-label="Back">
        <ArrowLeft aria-hidden />
      </button>
      <button className="btn primary dock-next" onClick={() => onStep(stepIndex + 1)} disabled={last || count === 0}>
        {count === 0 ? (
          writing ? 'Writing steps…' : 'No steps'
        ) : last ? (
          <>
            <Check aria-hidden /> Done
          </>
        ) : (
          <>
            {stepIndex < 0 ? 'Start' : 'Next'} <ArrowRight aria-hidden />
          </>
        )}
      </button>
    </div>
  )
}
