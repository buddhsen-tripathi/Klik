import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { getScan } from '../../api'
import { orderedSteps, partStates, type Mode } from '../../explode'
import type { ScanView } from '../../shared/types'
import StepsPanel from '../steps/StepsPanel'
import Progress from '../ui/Progress'
import { STAGE_LABEL } from './labels'
import LiveStatus from './LiveStatus'
import Pipeline from './Pipeline'
import PhotoWithBoxes from './PhotoWithBoxes'
import SizeCheckChip from './SizeCheckChip'
import ViewerToolbar from './ViewerToolbar'
import Viewer3D, { type SizeCheck, type Source } from '../viewer/Viewer3D'

// Camera code only loads when someone turns on hands-free mode.
const LiveCheck = lazy(() => import('../camera/LiveCheck'))

const POLL_MS = 2500
const POLL_STREAMING_MS = 1000 // while Gemini streams parts, poll fast so they appear live

export default function ScanPage({ id }: { id: string }) {
  const [scan, setScan] = useState<ScanView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('disassemble')
  const [stepIndex, setStepIndex] = useState(-1)
  const [source, setSource] = useState<Source>('blockout')
  const [orient, setOrient] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [spin, setSpin] = useState(false)
  const [watching, setWatching] = useState(false)
  const [modeChosen, setModeChosen] = useState(false)
  const [sizeCheck, setSizeCheck] = useState<SizeCheck | null>(null)

  // Poll until the workflow is finished.
  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      // Don't poll from a background tab; check again when it's visible.
      if (document.hidden) {
        timer = setTimeout(tick, POLL_MS)
        return
      }
      try {
        const s = await getScan(id)
        if (stop) return
        setScan(s)
        setLoadError(null)
        if (s.stage !== 'done' && s.stage !== 'failed') timer = setTimeout(tick, s.stage === 'analyzing' ? POLL_STREAMING_MS : POLL_MS)
      } catch (err) {
        if (stop) return
        setLoadError((err as Error).message)
        timer = setTimeout(tick, POLL_MS * 2)
      }
    }
    tick()
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [id])

  // The scanned GLB can be tens of MB, so it is never loaded automatically:
  // the user taps "Load 3D scan" and sees the size first.
  const analysis = scan?.analysis ?? null

  // Photographed loose parts / a kit → start in "Put together" (once; the user can switch).
  useEffect(() => {
    if (modeChosen || !analysis?.triage) return
    setModeChosen(true)
    if (analysis.triage.state === 'loose_parts') setMode('assemble')
  }, [analysis?.triage, modeChosen])
  const states = useMemo(() => (analysis ? partStates(analysis, mode, stepIndex) : new Map()), [analysis, mode, stepIndex])

  if (loadError && !scan) return <main className="scan-page centered error">{loadError}</main>
  if (!scan) return <main className="scan-page centered muted">Loading…</main>

  if (scan.stage === 'failed') {
    return (
      <main className="scan-page centered">
        <div className="card">
          <h2>That scan didn't work</h2>
          <p className="error">{scan.error}</p>
          <a className="btn primary" href="#/">
            Try another photo
          </a>
        </div>
      </main>
    )
  }

  if (!analysis) {
    return (
      <main className="scan-page">
        <PhotoWithBoxes scan={scan} />
        {scan.stage === 'analyzing' && scan.progress?.phase ? (
          <Pipeline scan={scan} />
        ) : (
          <Progress label={scan.progress?.thought ? `${scan.progress.thought}…` : STAGE_LABEL[scan.stage]} />
        )}
      </main>
    )
  }

  const steps = orderedSteps(analysis, mode)
  const changeMode = (m: Mode) => {
    setMode(m)
    setModeChosen(true)
    setStepIndex(-1)
  }
  const canWatch = steps.length > 0 && scan.stage !== 'analyzing'
  const hasScan = scan.modelFiles.length > 0

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
      />
    </main>
  )
}
