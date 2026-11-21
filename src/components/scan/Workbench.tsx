import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { checkProgress, clearRecovery } from '../../api'
import { orderedSteps, partStates, planStates, type Mode } from '../../explode'
import { planSteps } from '../../shared/plan'
import type { Analysis, Recovery, ScanView } from '../../shared/types'
import { describeState, type AgentActions, type AgentSnapshot } from '../agent/agentTools'
import { useVoiceAgent } from '../agent/useVoiceAgent'
import VoiceAgent from '../agent/VoiceAgent'
import ProgressAssist from '../recovery/ProgressAssist'
import StepsPanel from '../steps/StepsPanel'
import Viewer3D, { type SizeCheck, type Source } from '../viewer/Viewer3D'
import { markerIds } from '../../shared/parts'
import ModelLoading from '../viewer/ModelLoading'
import ShopSheet from '../shop/ShopSheet'
import { useGuide } from '../../i18n/useGuide'
import { closeShop } from '../shop/shopStore'
import LiveStatus from './LiveStatus'
import PhotoWithBoxes from './PhotoWithBoxes'
import ScanFailedChip from './ScanFailedChip'
import SizeCheckChip from './SizeCheckChip'
import ViewerToolbar from './ViewerToolbar'
import ModeArrows from './ModeArrows'
import AssistButtons from './AssistButtons'

// Camera code only loads when someone turns on the live coach or checks a photo.
const LiveCheck = lazy(() => import('../camera/LiveCheck'))
const ProgressCheckSheet = lazy(() => import('../recovery/ProgressCheckSheet'))

/** Scans up to this size show straight away; bigger ones wait for a tap. */
const AUTO_LOAD_BYTES = 25e6
const saveData = () => Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData)

/** The guide: 3D view + steps, the fix plan after a progress check, and the voice helper. */
export default function Workbench({ scan, analysis, onScan }: { scan: ScanView; analysis: Analysis; onScan: (s: ScanView) => void }) {
  // Words in the user's language for the panel and the voice helper; the 3D view keeps the original
  // analysis (same parts and geometry), so switching language never rebuilds the model.
  const { guide, translating } = useGuide(scan.id, analysis, scan.stage !== 'analyzing')
  // Photographed loose parts / a kit → start in "Put together" (the user can switch).
  const [mode, setMode] = useState<Mode>(() => (analysis.triage?.state === 'loose_parts' ? 'assemble' : 'disassemble'))
  const [stepIndex, setStepIndex] = useState(-1)
  const [orient, setOrient] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // "Show me this part": zoom the 3D view to it. Belongs to the step it was asked on.
  const [focusReq, setFocusReq] = useState<{ id: string; n: number; step: number } | null>(null)
  const [spin, setSpin] = useState(false)
  // Live coach: camera on, frames go to the voice agent, steps advance when the camera sees them done.
  const [coach, setCoach] = useState(false)
  const lastFrame = useRef<Blob | null>(null)
  const [scanFailed, setScanFailed] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const [sizeCheck, setSizeCheck] = useState<SizeCheck | null>(null)
  const [checking, setChecking] = useState<{ note: string } | null>(null)

  // A progress check made in this mode turns the guide into: fixes first, then the rest from where they are.
  const recovery = scan.recovery?.mode === mode ? scan.recovery : null
  const ordered = useMemo(() => orderedSteps(guide, mode), [guide, mode])
  const steps = useMemo(() => (recovery ? planSteps(ordered, recovery) : ordered), [ordered, recovery])
  const states = useMemo(
    () => (recovery ? planStates(analysis, mode, ordered.slice(0, recovery.resumeAt), steps, stepIndex) : partStates(analysis, mode, stepIndex)),
    [analysis, mode, stepIndex, recovery, ordered, steps],
  )
  const references = useMemo(
    () => new Map(scan.modelFiles.flatMap((f) => (f.source === 'reference' && f.reference ? [[f.partIds[0], f.reference] as const] : []))),
    [scan.modelFiles],
  )
  const canWatch = steps.length > 0 && scan.stage !== 'analyzing'
  const hasScan = scan.modelFiles.length > 0
  // Wait for the finished 3D model instead of showing a block preview while it's built.
  // Parts stream in while modelling: only wait for the first one.
  const waiting = scan.stage === 'analyzing' || (scan.stage === 'modeling' && scan.modelFiles.length === 0)
  // Show the real scan (texture and shape) as soon as it exists, unless it's huge or the user picked boxes.
  const [sourceChoice, setSource] = useState<Source | null>(null)
  const autoScan = hasScan && (scan.modelBytes ?? 0) <= AUTO_LOAD_BYTES && !saveData()
  const source: Source = sourceChoice ?? (autoScan ? 'scan' : 'blockout')

  const focus = focusReq?.step === stepIndex ? focusReq : null
  // Numbered pins for the current step, in the same order as the numbers in its text.
  const current = stepIndex >= 0 ? steps[stepIndex] : null
  const markers = useMemo(() => {
    if (!current) return []
    const text = mode === 'disassemble' ? current.disassembly : current.assembly
    return markerIds(text, current.partIds, (id) => analysis.parts.some((p) => p.id === id)).map((id, i) => ({ id, n: i + 1 }))
  }, [current, mode, analysis.parts])
  const focusPart = (id: string | null) => {
    setSelectedId(id)
    if (id) setFocusReq((f) => ({ id, n: (f?.n ?? 0) + 1, step: stepIndex }))
  }

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
  const snapshot = (): AgentSnapshot => ({ scanId: scan.id, analysis: guide, steps, stepIndex, mode, recovery, hasScan, coach })
  const actions: AgentActions = {
    goToStep: setStepIndex,
    setMode: changeMode,
    selectPart: focusPart,
    setView: (v) => setSource(v === 'scan' && hasScan ? 'scan' : 'blockout'),
    setSpin,
    setCoach: (on) => {
      setCoach(on && canWatch)
      if (on && stepIndex < 0) setStepIndex(0)
    },
    openProgressCheck: (note) => setChecking({ note: note ?? '' }),
    replanFromCamera: async (note) => {
      if (!lastFrame.current) return null
      const r = await checkProgress(scan.id, lastFrame.current, mode, note)
      applyRecovery(r)
      return r
    },
    startPlan: () => setStepIndex(0),
    clearPlan,
    newScan: () => (location.hash = '#/'),
    reviseStep: (index, step) => onScan({ ...scan, analysis: { ...analysis, steps: analysis.steps.map((s, k) => (k === index ? step : s)) } }),
    end: () => endAgent(),
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
  }, [stepIndex, mode, recovery?.createdAt, coach, agent.active])

  /** From a tap (iOS needs one for the mic, speaker and camera). */
  const startCoach = () => {
    setCoach(true)
    if (stepIndex < 0) setStepIndex(0)
    const hello = 'Live coach just started: the camera is on and you can see their frames. In a few words, say you are watching and what the current step is.'
    if (agent.active) agent.notify(`[App] ${hello}`, true)
    else void agent.start(hello)
  }
  const stopCoach = () => {
    setCoach(false)
    agent.notify('[App] Live coach off: the camera is closed.')
  }
  const endAgent = () => {
    agent.stop()
    setCoach(false)
  }

  // Camera saw the step done: move on, and have the coach say what's next.
  const advance = () => {
    const i = snapRef.current().stepIndex
    if (i >= steps.length - 1) return
    setStepIndex(i + 1)
    const next = steps[i + 1]
    if (coach && agent.active && next)
      agent.notify(`[App] The camera saw step ${i + 1} done; the app moved to step ${i + 2}: ${next.title}. Tell them what to do now in a sentence.`, true)
  }

  const applyRecovery = (r: Recovery) => {
    onScan({ ...scan, recovery: r })
    if (r.mode !== mode) setMode(r.mode)
    setStepIndex(-1)
  }
  const onRecovery = (r: Recovery) => {
    setChecking(null)
    applyRecovery(r)
    const mistakes = r.mistakes.map((m) => `${m.stepIndex != null ? `step ${m.stepIndex + 1}: ` : ''}${m.problem} (fix: ${m.fix})`).join('; ')
    agent.notify(
      `[App] Progress check result: ${r.summary} ${mistakes ? `Mistakes: ${mistakes}.` : 'No mistakes found.'} Plan: ${r.fixSteps.length} fix step(s), then the guide from step ${r.resumeAt + 1}. Tell the user briefly and offer to start the fix plan.`,
      true,
    )
  }

  // The product sheet belongs to this page.
  useEffect(() => closeShop, [])

  return (
    <main className="workbench">
      <section className="viewer">
        <Viewer3D
          analysis={analysis}
          states={states}
          source={source}
          modelFiles={scan.modelFiles}
          onMeasured={setSizeCheck}
          onScanError={() => setScanFailed(true)}
          retryKey={retryKey}
          orient={orient}
          spin={spin}
          selectedId={selectedId}
          onSelect={setSelectedId}
          focus={focus}
          waiting={waiting}
          markers={markers}
          onMarker={(id) => focusPart(id)}
        />
        {!waiting && source === 'scan' && hasScan && !scanFailed && <ModelLoading />}
        {source === 'scan' && scanFailed ? (
          <ScanFailedChip
            onRetry={() => {
              setScanFailed(false)
              setRetryKey((k) => k + 1)
            }}
          />
        ) : (
          source === 'scan' && hasScan && scan.stage === 'done' && sizeCheck && <SizeCheckChip check={sizeCheck} analysis={analysis} />
        )}
        {!waiting && <ViewerToolbar
          scan={scan}
          source={source}
          onSource={setSource}
          onFlip={() => setOrient((o) => (o + 1) % 4)}
          spin={spin}
          onSpin={() => setSpin((v) => !v)}
        />}
        {!waiting && !coach && <ModeArrows mode={mode} onMode={changeMode} />}
        {coach && canWatch && (
          <Suspense fallback={null}>
            <LiveCheck
              scanId={scan.id}
              plan={Boolean(recovery)}
              mode={mode}
              stepIndex={stepIndex}
              stepCount={steps.length}
              onAdvance={advance}
              onClose={stopCoach}
              onFrame={(jpeg) => {
                lastFrame.current = jpeg
                if (agent.active) void agent.sendFrame(jpeg)
              }}
            />
          </Suspense>
        )}
        {!coach && (scan.stage === 'analyzing' || scan.stage === 'modeling') && <LiveStatus scan={scan} />}
      </section>

      <StepsPanel
        analysis={guide}
        translating={translating}
        steps={steps}
        mode={mode}
        stepIndex={stepIndex}
        onStep={setStepIndex}
        selectedId={selectedId}
        modelError={scan.modelError}
        writing={scan.stage === 'analyzing'}
        photo={<PhotoWithBoxes scan={scan} compact />}
        references={references}
        fixes={recovery?.fixSteps.length ?? 0}
        onFocusPart={focusPart}
        // Drop the phone sheet when a part is focused or the live coach starts (the camera needs the room).
        focusKey={coach ? `coach:${focusReq?.n ?? 0}` : focusReq?.n}
        dockExtra={
          canWatch && (
            <AssistButtons
              agent={agent}
              coach={coach}
              onCoach={() => (coach ? stopCoach() : startCoach())}
              onAsk={() => (agent.active ? endAgent() : void agent.start())}
            />
          )
        }
        assist={
          canWatch && (
            <ProgressAssist
              recovery={recovery}
              stepIndex={stepIndex}
              coach={coach}
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
      {canWatch && <VoiceAgent agent={agent} coach={coach} onEnd={endAgent} />}
      <ShopSheet />
    </main>
  )
}
