import { useT } from '../../i18n/useT'
/** "Step 2 of 6" with a segmented bar; tap a segment to jump to that step. */
export default function StepProgress({ stepIndex, count, onStep, fixes = 0 }: { stepIndex: number; count: number; onStep: (i: number) => void; fixes?: number }) {
  const t = useT()
  if (count === 0) return null
  return (
    <div className="step-progress">
      <div className="step-progress-label">
        <span>{stepIndex < 0 ? t('overview') : t('stepOf', { n: stepIndex + 1, count })}</span>
        {stepIndex >= 0 && (
          <button className="link-btn" onClick={() => onStep(-1)}>
            {t('overview')}
          </button>
        )}
      </div>
      <ol className="step-progress-bar" aria-label="Steps">
        {Array.from({ length: count }, (_, i) => (
          <li key={i} className={`${i < stepIndex ? 'done' : i === stepIndex ? 'current' : ''}${i < fixes ? ' fix' : ''}`}>
            <button onClick={() => onStep(i)} aria-label={`Step ${i + 1}`} aria-current={i === stepIndex ? 'step' : undefined}>
              <span />
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
