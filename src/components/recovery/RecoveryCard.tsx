import type { Recovery } from '../../shared/types'
import './Recovery.css'

const ICON: Record<Recovery['stepStatus'][number]['status'], string> = { done: '✓', not_done: '', wrong: '!', unsure: '?' }
const LABEL: Record<Recovery['stepStatus'][number]['status'], string> = { done: 'done', not_done: 'to do', wrong: 'needs fixing', unsure: 'can’t tell' }

/** Result of a progress check: what's done, what's off, and the plan from here. */
export default function RecoveryCard({ recovery, onStart, onClear, onRecheck }: { recovery: Recovery; onStart: () => void; onClear: () => void; onRecheck: () => void }) {
  const fixes = recovery.fixSteps.length
  const total = recovery.stepStatus.length
  const finished = recovery.resumeAt >= total && fixes === 0
  return (
    <section className="card recovery-card">
      <div className="recovery-head">
        {recovery.photoUrl && <img src={recovery.photoUrl} alt="Your build" />}
        <p>{recovery.summary}</p>
      </div>
      <ol className="status-strip" aria-label="Step status">
        {recovery.stepStatus.map((s) => (
          <li key={s.index} className={`st-${s.status}${s.index === recovery.resumeAt ? ' resume' : ''}`} title={`Step ${s.index + 1}: ${LABEL[s.status]}${s.note ? `, ${s.note}` : ''}`}>
            <span>{s.index + 1}</span>
            {ICON[s.status]}
          </li>
        ))}
      </ol>
      {recovery.mistakes.length > 0 && (
        <ul className="mistakes">
          {recovery.mistakes.map((m, i) => (
            <li key={i}>
              <strong>
                {m.stepIndex != null ? `Step ${m.stepIndex + 1}: ` : ''}
                {m.problem}
              </strong>
              {m.fix && <span>→ {m.fix}</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="recovery-actions">
        {!finished && (
          <button className="btn primary" onClick={onStart}>
            {fixes ? `Fix ${fixes === 1 ? 'it' : `${fixes} things`}, then step ${recovery.resumeAt + 1} →` : `Continue at step ${recovery.resumeAt + 1} →`}
          </button>
        )}
        <div className="row">
          <button className="btn ghost small" onClick={onRecheck}>
            Check again
          </button>
          <button className="btn ghost small" onClick={onClear}>
            Back to full guide
          </button>
        </div>
      </div>
    </section>
  )
}
