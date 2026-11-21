import type { ReactNode } from 'react'
import type { Mode } from '../explode'
import type { Analysis, Step, Timing } from '../shared/types'
import Waterfall from './Waterfall'

interface Props {
  analysis: Analysis
  steps: Step[]
  mode: Mode
  stepIndex: number
  onMode: (m: Mode) => void
  onStep: (i: number) => void
  selectedId: string | null
  modelError: string | null
  /** Gemini is still streaming the analysis. */
  writing?: boolean
  photo: ReactNode
  /** Latency waterfall for this scan. */
  timings?: Timing[]
}

export default function StepsPanel({ analysis, steps, mode, stepIndex, onMode, onStep, selectedId, modelError, writing, photo, timings = [] }: Props) {
  const step = stepIndex >= 0 ? steps[stepIndex] : null
  const selected = selectedId ? analysis.parts.find((p) => p.id === selectedId) : null
  const partName = (id: string) => analysis.parts.find((p) => p.id === id)?.name ?? id
  const fasteners = analysis.parts.filter((p) => p.kind === 'fastener')
  const ref = analysis.reference
  const stepFasteners = step ? fasteners.filter((f) => step.partIds.includes(f.id)) : []
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
        <span className="step-count">
          {stepIndex < 0 ? (writing && steps.length === 0 ? 'Writing steps…' : 'Overview') : `Step ${stepIndex + 1} of ${steps.length}`}
        </span>
        <button className="btn primary" onClick={() => onStep(stepIndex + 1)} disabled={stepIndex >= last || steps.length === 0}>
          {stepIndex < 0 ? 'Start →' : 'Next →'}
        </button>
      </div>

      {step ? (
        <section className="card step-card">
          {step.group && <p className="eyebrow">{step.group}</p>}
          <h2>{step.title}</h2>
          <p className="instruction">{mode === 'disassemble' ? step.disassembly : step.assembly}</p>
          <p className="parts-line">
            <strong>Parts:</strong> {step.partIds.map(partName).join(', ')}
          </p>
          {stepFasteners.length > 0 && (
            <div className="chips">
              {stepFasteners.map((f) => (
                <span key={f.id} className="chip hardware">
                  🔩 {(f.quantity ?? 1) > 1 ? `${f.quantity}× ` : ''}
                  {f.spec ?? f.name}
                </span>
              ))}
            </div>
          )}
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
          {ref && ref.match !== 'none' && (
            <p className={`doc-match ${ref.match}`}>
              📘 {ref.match === 'exact' ? 'Matched the manual for' : 'Using a similar model’s docs:'} <strong>{ref.product}</strong>
            </p>
          )}
          <p className="size-line">
            📏 <strong>{analysis.dimensions.map((n) => +n.toFixed(1)).join(' × ')} cm</strong> (W × H × D){' '}
            {analysis.dimensionsSource === 'docs' ? '· from the manufacturer' : '· estimated from the photo'}
          </p>
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
          {fasteners.length > 0 && (
            <>
              <h3>Hardware</h3>
              <table className="hardware-table">
                <tbody>
                  {fasteners.map((f) => (
                    <tr key={f.id}>
                      <td className="qty">{f.quantity ?? 1}×</td>
                      <td>
                        {f.name}
                        {f.spec && <small>{f.spec}</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {ref && ref.notes.length > 0 && (
            <>
              <h3>From the documentation</h3>
              <ul className="list">
                {ref.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
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
          <h3>
            {(selected.quantity ?? 1) > 1 ? `${selected.quantity}× ` : ''}
            {selected.name}
          </h3>
          {selected.spec && <p className="spec">{selected.spec}</p>}
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
              {s.group && s.group !== steps[i - 1]?.group && <span className="eyebrow">{s.group}</span>}
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
        {analysis.sources && analysis.sources.length > 0 && (
          <>
            <h3>Manuals and guides used</h3>
            <ul className="list sources">
              {analysis.sources.map((src) => (
                <li key={src.url}>
                  <a href={src.url} target="_blank" rel="noreferrer noopener">
                    {src.title}
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
        {timings.length > 0 && (
          <>
            <h3>Where the time went</h3>
            <Waterfall timings={timings} />
          </>
        )}
      </details>

      {modelError && <p className="muted small">{modelError}</p>}
    </aside>
  )
}
