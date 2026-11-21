import type { ReactNode } from 'react'
import type { Mode } from '../../explode'
import type { Analysis, Step, Timing } from '../../shared/types'
import { Disclosure } from '../ui/Section'
import Segmented from '../ui/Segmented'
import AiDetails from './AiDetails'
import Overview from './Overview'
import SelectedPart from './SelectedPart'
import StepCard from './StepCard'
import StepList from './StepList'
import Stepper from './Stepper'

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
  /** Shown under the stepper, e.g. "Check my progress" or the fix-plan banner. */
  assist?: ReactNode
}

const MODES: { value: Mode; label: string }[] = [
  { value: 'disassemble', label: 'Take apart' },
  { value: 'assemble', label: 'Put together' },
]

/** Right-hand (or bottom, on phones) panel: mode, stepper, the current step or overview, details. */
export default function StepsPanel({ analysis, steps, mode, stepIndex, onMode, onStep, selectedId, modelError, writing, photo, timings = [], assist }: Props) {
  const step = stepIndex >= 0 ? steps[stepIndex] : null
  const selected = selectedId ? analysis.parts.find((p) => p.id === selectedId) : null

  return (
    <aside className="panel">
      <div className="panel-head">
        <h1>{analysis.objectName}</h1>
        <Segmented value={mode} options={MODES} onChange={onMode} />
      </div>
      <Stepper stepIndex={stepIndex} count={steps.length} writing={writing} onStep={onStep} />
      {assist}
      {step ? <StepCard step={step} mode={mode} analysis={analysis} /> : <Overview analysis={analysis} />}
      {selected && <SelectedPart part={selected} />}
      <Disclosure summary="All steps">
        <StepList steps={steps} stepIndex={stepIndex} onStep={onStep} />
      </Disclosure>
      <Disclosure summary="What the AI saw">
        <AiDetails analysis={analysis} photo={photo} timings={timings} />
      </Disclosure>
      {modelError && <p className="muted small">{modelError}</p>}
    </aside>
  )
}
