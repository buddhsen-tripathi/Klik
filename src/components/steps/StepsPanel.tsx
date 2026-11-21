import type { ReactNode } from 'react'
import type { Mode } from '../../explode'
import type { Analysis, Step, ModelFile } from '../../shared/types'
import { Disclosure } from '../ui/Section'
import Segmented from '../ui/Segmented'
import AiDetails from './AiDetails'
import Overview from './Overview'
import SelectedPart from './SelectedPart'
import StepCard from './StepCard'
import StepList from './StepList'
import SheetTop from './SheetTop'
import StepProgress from './StepProgress'
import SwipeSteps from './SwipeSteps'
import Stepper from './Stepper'
import { useT } from '../../i18n/useT'

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
  /** Shown under the stepper, e.g. "Check my progress" or the fix-plan banner. */
  assist?: ReactNode
  /** Hidden parts modelled from a reference photo, for credit. */
  references?: Map<string, NonNullable<ModelFile['reference']>>
  /** Helper buttons for the bottom dock (voice, live coach). */
  dockExtra?: ReactNode
  /** Fix steps at the start of the list (after a progress check), marked in the progress bar. */
  fixes?: number
  /** Tap a part or screw: show it in 3D. */
  onFocusPart?: (id: string) => void
  /** Changes when a part is focused, so the phone sheet drops down to show the 3D view. */
  focusKey?: unknown
  /** The guide is being translated into the app's language (English shows meanwhile). */
  translating?: boolean
}


/** Right-hand (or bottom, on phones) panel: mode, stepper, the current step or overview, details. */
export default function StepsPanel({ analysis, steps, mode, stepIndex, onMode, onStep, selectedId, modelError, writing, photo, assist, references, dockExtra, fixes = 0, onFocusPart, focusKey, translating }: Props) {
  const t = useT()
  const modes: { value: Mode; label: string }[] = [
    { value: 'disassemble', label: t('takeApart') },
    { value: 'assemble', label: t('putTogether') },
  ]
  const step = stepIndex >= 0 ? steps[stepIndex] : null
  const selected = selectedId ? analysis.parts.find((p) => p.id === selectedId) : null

  return (
    <aside className="panel">
      <div className="panel-head">
        <h1>{analysis.objectName}</h1>
        <Segmented value={mode} options={modes} onChange={onMode} />
      </div>
      <SheetTop collapseKey={focusKey}>
        <StepProgress stepIndex={stepIndex} count={steps.length} onStep={onStep} fixes={fixes} />
        {translating && <p className="muted small translating">{t('translating')}</p>}
      </SheetTop>
      {assist && <div className="panel-assist">{assist}</div>}
      <SwipeSteps stepIndex={stepIndex} count={steps.length} onStep={onStep}>
        {step ? <StepCard step={step} mode={mode} analysis={analysis} onFocusPart={onFocusPart} /> : <Overview analysis={analysis} />}
        {selected && <SelectedPart part={selected} objectName={analysis.objectName} reference={references?.get(selected.id)} />}
      </SwipeSteps>
      <Disclosure summary={t('allSteps')}>
        <StepList steps={steps} stepIndex={stepIndex} onStep={onStep} />
      </Disclosure>
      <Disclosure summary={t('whatAiSaw')}>
        <AiDetails analysis={analysis} photo={photo} />
      </Disclosure>
      {modelError && <p className="muted small">{modelError}</p>}
      <Stepper stepIndex={stepIndex} count={steps.length} writing={writing} onStep={onStep} extra={dockExtra} />
    </aside>
  )
}
