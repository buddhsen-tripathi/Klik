/** "Step 2 of 6" with a segmented bar; tap a segment to jump to that step. */
export default function StepProgress({ stepIndex, count, onStep, fixes = 0 }: { stepIndex: number; count: number; onStep: (i: number) => void; fixes?: number }) {
  if (count === 0) return null
  return (
    <div className="step-progress">
      <div className="step-progress-label">
        <span>{stepIndex < 0 ? 'Overview' : `Step ${stepIndex + 1} of ${count}`}</span>
        {stepIndex >= 0 && (
          <button className="link-btn" onClick={() => onStep(-1)}>
            Overview
          </button>
        )}
      </div>
      <ol className="step-progress-bar" aria-label="Steps">
        {Array.from({ length: count }, (_, i) => (
          <li key={i} className={`${i < stepIndex ? 'done' : i === stepIndex ? 'current' : ''}${i < fixes ? ' fix' : ''}`}>
            <button onClick={() => onStep(i)} aria-label={`Step ${i + 1}`} aria-current={i === stepIndex ? 'step' : undefined} />
          </li>
        ))}
      </ol>
    </div>
  )
}
