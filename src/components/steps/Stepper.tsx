/** Back / "Step n of m" / Next. */
export default function Stepper({ stepIndex, count, writing, onStep }: { stepIndex: number; count: number; writing?: boolean; onStep: (i: number) => void }) {
  return (
    <div className="stepper">
      <button className="btn ghost" onClick={() => onStep(stepIndex - 1)} disabled={stepIndex < 0}>
        ← Back
      </button>
      <span className="step-count">
        {stepIndex < 0 ? (writing && count === 0 ? 'Writing steps…' : 'Overview') : `Step ${stepIndex + 1} of ${count}`}
      </span>
      <button className="btn primary" onClick={() => onStep(stepIndex + 1)} disabled={stepIndex >= count - 1 || count === 0}>
        {stepIndex < 0 ? 'Start →' : 'Next →'}
      </button>
    </div>
  )
}
