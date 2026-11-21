import type { ReactNode } from 'react'
import type { Mode } from '../explode'
import type { Analysis, Step } from '../shared/types'

interface Props {
  analysis: Analysis
  steps: Step[]
  mode: Mode
  stepIndex: number
  onMode: (m: Mode) => void
  onStep: (i: number) => void
  selectedId: string | null
  modelError: string | null
  photo: ReactNode
}

export default function StepsPanel({ analysis, steps, mode, stepIndex, onMode, onStep, selectedId, modelError, photo }: Props) {
  const step = stepIndex >= 0 ? steps[stepIndex] : null
  const selected = selectedId ? analysis.parts.find((p) => p.id === selectedId) : null
  const partName = (id: string) => analysis.parts.find((p) => p.id === id)?.name ?? id
  const last = steps.length - 1

  return (
    <aside className="panel">
      <div className="panel-head">
        <h1>{analysis.objectName}</h1>
        <div className="segmented">
          <button className={mode === 'disassemble' ? 'on' : ''} onClick={() => onMode('disassemble')}>
            Take apart
          </button>
          <button className={mode === 'assemble' ? 'on' : ''} onClick={() => onMode('assemble')}>
            Put together
          </button>
        </div>
      </div>

      <div className="stepper">
        <button className="btn ghost" onClick={() => onStep(stepIndex - 1)} disabled={stepIndex < 0}>
          ← Back
        </button>
        <span className="step-count">{stepIndex < 0 ? 'Overview' : `Step ${stepIndex + 1} of ${steps.length}`}</span>
        <button className="btn primary" onClick={() => onStep(stepIndex + 1)} disabled={stepIndex >= last}>
          {stepIndex < 0 ? 'Start →' : 'Next →'}
        </button>
      </div>

      {step ? (
        <section className="card step-card">
          <h2>{step.title}</h2>
          <p className="instruction">{mode === 'disassemble' ? step.disassembly : step.assembly}</p>
          <p className="parts-line">
            <strong>Parts:</strong> {step.partIds.map(partName).join(', ')}
          </p>
          {step.tools.length > 0 && (
            <div className="chips">
              {step.tools.map((t) => (
                <span key={t} className="chip">
                  🔧 {t}
                </span>
              ))}
            </div>
          )}
          {step.caution && <p className="caution">⚠️ {step.caution}</p>}
        </section>
      ) : (
        <section className="card overview">
          <p>{analysis.summary}</p>
          <dl className="facts">
            <div>
              <dt>Difficulty</dt>
              <dd>{analysis.difficulty}</dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>~{analysis.estimatedMinutes} min</dd>
            </div>
            <div>
              <dt>Parts</dt>
              <dd>{analysis.parts.length}</dd>
            </div>
          </dl>
          {analysis.tools.length > 0 && (
            <>
              <h3>Tools</h3>
              <div className="chips">
                {analysis.tools.map((t) => (
                  <span key={t} className="chip">
                    🔧 {t}
                  </span>
                ))}
              </div>
            </>
          )}
          {analysis.safety.length > 0 && (
            <>
              <h3>Safety</h3>
              <ul className="list">
                {analysis.safety.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {selected && (
        <section className="card selected-part">
          <h3>{selected.name}</h3>
          <p className="muted">
            {selected.material}
            {selected.visible ? '' : ' · hidden part (inferred, not seen in the photo)'}
          </p>
        </section>
      )}

      <details className="card">
        <summary>All steps</summary>
        <ol className="step-list">
          {steps.map((s, i) => (
            <li key={i} className={i === stepIndex ? 'current' : ''}>
              <button onClick={() => onStep(i)}>{s.title}</button>
            </li>
          ))}
        </ol>
      </details>

      <details className="card">
        <summary>What the AI saw</summary>
        {photo}
        {analysis.assumptions.length > 0 && (
          <>
            <h3>Guesses to double-check</h3>
            <ul className="list">
              {analysis.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </>
        )}
      </details>

      {modelError && <p className="muted small">{modelError}</p>}
    </aside>
  )
}
