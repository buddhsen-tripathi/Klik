import type { Step } from '../../shared/types'

/** Every step, grouped by subassembly; tap to jump. */
export default function StepList({ steps, stepIndex, onStep }: { steps: Step[]; stepIndex: number; onStep: (i: number) => void }) {
  return (
    <ol className="step-list">
      {steps.map((s, i) => (
        <li key={i} className={i === stepIndex ? 'current' : ''}>
          {s.group && s.group !== steps[i - 1]?.group && <span className="eyebrow">{s.group}</span>}
          <button onClick={() => onStep(i)}>{s.title}</button>
        </li>
      ))}
    </ol>
  )
}
