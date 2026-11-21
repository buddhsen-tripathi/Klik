import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { clearRecovery } from '../../api'
import { orderedSteps, partStates, planStates, type Mode } from '../../explode'
import { planSteps } from '../../shared/plan'
import type { Analysis, Recovery, ScanView } from '../../shared/types'
import { describeState, type AgentActions, type AgentSnapshot } from '../agent/agentTools'
import { useVoiceAgent } from '../agent/useVoiceAgent'
import VoiceAgent from '../agent/VoiceAgent'
import ProgressAssist from '../recovery/ProgressAssist'
import StepsPanel from '../steps/StepsPanel'
import Viewer3D, { type SizeCheck, type Source } from '../viewer/Viewer3D'
import LiveStatus from './LiveStatus'
import PhotoWithBoxes from './PhotoWithBoxes'
import SizeCheckChip from './SizeCheckChip'
import ViewerToolbar from './ViewerToolbar'

// Camera code only loads when someone turns on hands-free mode or checks their progress.
const LiveCheck = lazy(() => import('../camera/LiveCheck'))
const ProgressCheckSheet = lazy(() => import('../recovery/ProgressCheckSheet'))

/** The guide: 3D view + steps, the fix plan after a progress check, and the voice helper. */
export default function Workbench({ scan, analysis, onScan }: { scan: ScanView; analysis: Analysis; onScan: (s: ScanView) => void }) {
  // Photographed loose parts / a kit → start in "Put together" (the user can switch).
  const [mode, setMode] = useState<Mode>(() => (analysis.triage?.state === 'loose_parts' ? 'assemble' : 'disassemble'))
  const [stepIndex, setStepIndex] = useState(-1)
  // The scanned GLBs can be tens of MB, so they're only loaded when the user asks.
  const [source, setSource] = useState<Source>('blockout')
  const [orient, setOrient] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [spin, setSpin] = useState(false)
  const [watching, setWatching] = useState(false)
  const [sizeCheck, setSizeCheck] = useState<SizeCheck | null>(null)
  const [checking, setChecking] = useState<{ note: string } | null>(null)

  // A progress check made in this mode turns the guide into: fixes first, then the rest from where they are.
  const recovery = scan.recovery?.mode === mode ? scan.recovery : null
  const ordered = useMemo(() => orderedSteps(analysis, mode), [analysis, mode])
  const steps = useMemo(() => (recovery ? planSteps(ordered, recovery) : ordered), [ordered, recovery])
  const states = useMemo(
    () => (recovery ? planStates(analysis, mode, ordered.slice(0, recovery.resumeAt), steps, stepIndex) : partStates(analysis, mode, stepIndex)),
    [analysis, mode, stepIndex, recovery, ordered, steps],
  )
  const canWatch = steps.length > 0 && scan.stage !== 'analyzing'
  const hasScan = scan.modelFiles.length > 0

  const changeMode = (m: Mode) => {
    setMode(m)
    setStepIndex(-1)
  }
  const clearPlan = () => {
    void clearRecovery(scan.id)
    onScan({ ...scan, recovery: null })
    setStepIndex(-1)
  }

  // ---- voice helper ----
  const snapshot = (): AgentSnapshot => ({ analysis, steps, stepIndex, mode, recovery, hasScan, watching })
  const actions: AgentActions = {
    goToStep: setStepIndex,
    setMode: changeMode,
    selectPart: setSelectedId,
    setView: (v) => setSource(v === 'scan' && hasScan ? 'scan' : 'blockout'),
    setSpin,
    setWatching: (on) => {
      setWatching(on && canWatch)
      if (on && stepIndex < 0) setStepIndex(0)
    },
    openProgressCheck: (note) => setChecking({ note: note ?? '' }),
    startPlan: () => setStepIndex(0),
    clearPlan,
    newScan: () => (location.hash = '#/'),
    end: () => agent.stop(),
  }
  const agent = useVoiceAgent(snapshot, actions)

  // Keep the helper in sync when the user taps around (silent context, it doesn't speak).
  const snapRef = useRef(snapshot)
  snapRef.current = snapshot
  useEffect(() => {
    if (!agent.active) return
    const t = setTimeout(() => agent.notify(describeState(snapRef.current())), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, mode, recovery?.createdAt, watching, agent.active])

  const onRecovery = (r: Recovery) => {
    setChecking(null)
    onScan({ ...scan, recovery: r })
    if (r.mode !== mode) setMode(r.mode)
    setStepIndex(-1)
    const mistakes = r.mistakes.map((m) => `${m.stepIndex != null ? `step ${m.stepIndex + 1}: ` : ''}${m.problem} (fix: ${m.fix})`).join('; ')
    agent.notify(
      `[App] Progress check result: ${r.summary} ${mistakes ? `Mistakes: ${mistakes}.` : 'No mistakes found.'} Plan: ${r.fixSteps.length} fix step(s), then the guide from step ${r.resumeAt + 1}. Tell the user briefly and offer to start the fix plan.`,
      true,
    )
  }

  return (
    <main className="workbench">
      <section className="viewer">
        <Viewer3D
          analysis={analysis}
          states={states}
          source={source}
          modelFiles={scan.modelFiles}
          onMeasured={setSizeCheck}
          orient={orient}
          spin={spin}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        {source === 'scan' && hasScan && scan.stage === 'done' && sizeCheck && <SizeCheckChip check={sizeCheck} analysis={analysis} />}
        <ViewerToolbar
          scan={scan}
          source={source}
          onSource={setSource}
          onFlip={() => setOrient((o) => (o + 1) % 4)}
          spin={spin}
          onSpin={() => setSpin((v) => !v)}
          canWatch={canWatch}
          watching={watching}
          onWatch={() => {
            setWatching((w) => !w)
            if (stepIndex < 0) setStepIndex(0)
          }}
        />
        {watching && canWatch && (
          <Suspense fallback={null}>
            <LiveCheck
              scanId={scan.id}
              plan={Boolean(recovery)}
              mode={mode}
              stepIndex={stepIndex}
              stepCount={steps.length}
              onAdvance={() => setStepIndex((i) => Math.min(i + 1, steps.length - 1))}
              onClose={() => setWatching(false)}
            />
          </Suspense>
        )}
        {!watching && (scan.stage === 'analyzing' || scan.stage === 'modeling') && <LiveStatus scan={scan} />}
      </section>

      <StepsPanel
        analysis={analysis}
        steps={steps}
        mode={mode}
        stepIndex={stepIndex}
        onMode={changeMode}
        onStep={setStepIndex}
        selectedId={selectedId}
        modelError={scan.modelError}
        writing={scan.stage === 'analyzing'}
        photo={<PhotoWithBoxes scan={scan} compact />}
        timings={scan.timings}
        assist={
          canWatch && (
            <ProgressAssist
              recovery={recovery}
              stepIndex={stepIndex}
              onCheck={() => setChecking({ note: '' })}
              onStart={() => setStepIndex(0)}
              onClear={clearPlan}
            />
          )
        }
      />

      {checking && (
        <Suspense fallback={null}>
          <ProgressCheckSheet scanId={scan.id} mode={mode} initialNote={checking.note} onDone={onRecovery} onClose={() => setChecking(null)} />
        </Suspense>
      )}
      {canWatch && <VoiceAgent agent={agent} />}
    </main>
  )
}
