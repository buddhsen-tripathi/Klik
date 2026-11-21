import { useEffect, useMemo, useState } from 'react'
import { getScan } from '../api'
import { orderedSteps, partStates, type Mode } from '../explode'
import type { ScanView } from '../shared/types'
import StepsPanel from './StepsPanel'
import Viewer3D, { type Source } from './Viewer3D'

const POLL_MS = 2500
const POLL_STREAMING_MS = 1000 // while Gemini streams parts, poll fast so they appear live
const STAGE_LABEL: Record<ScanView['stage'], string> = {
  queued: 'Queued…',
  analyzing: 'Gemini is identifying the parts…',
  modeling: 'Building the 3D model…',
  done: 'Ready',
  failed: 'Failed',
}

export default function ScanPage({ id }: { id: string }) {
  const [scan, setScan] = useState<ScanView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('disassemble')
  const [stepIndex, setStepIndex] = useState(-1)
  const [source, setSource] = useState<Source>('blockout')
  const [orient, setOrient] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [spin, setSpin] = useState(false)

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
        <Progress label={scan.progress?.thought ? `${scan.progress.thought}…` : STAGE_LABEL[scan.stage]} />
      </main>
    )
  }

  const steps = orderedSteps(analysis, mode)
  const changeMode = (m: Mode) => {
    setMode(m)
    setStepIndex(-1)
  }

  return (
    <main className="workbench">
      <section className="viewer">
        <Viewer3D
          analysis={analysis}
          states={states}
          source={source}
          modelUrl={scan.modelUrl}
          modelPartIds={scan.modelPartIds}
          orient={orient}
          spin={spin}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <div className="viewer-bar">
          {scan.modelUrl && source === 'scan' ? (
            <div className="segmented small">
              <button className="on">3D scan</button>
              <button onClick={() => setSource('blockout')}>Blockout</button>
            </div>
          ) : scan.modelUrl ? (
            <button className="btn primary small" onClick={() => setSource('scan')}>
              Load 3D scan{scan.modelBytes ? ` · ${formatMB(scan.modelBytes)}` : ''}
            </button>
          ) : (
            <span className="chip">{scan.stage === 'modeling' ? 'Blockout · 3D scan building…' : 'Blockout'}</span>
          )}
          <div className="row">
            {source === 'scan' && scan.modelUrl && (
              <button className="btn ghost small" onClick={() => setOrient((o) => (o + 1) % 4)} title="Rotate the scan if it came back sideways">
                Flip scan
              </button>
            )}
            <button className={`btn small ${spin ? 'primary' : 'ghost'}`} onClick={() => setSpin((v) => !v)} aria-pressed={spin}>
              {spin ? 'Stop spin' : 'Spin'}
            </button>
          </div>
        </div>
        {(scan.stage === 'analyzing' || scan.stage === 'modeling') && <LiveStatus scan={scan} />}
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
      />
    </main>
  )
}

const formatMB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`

/** What's happening right now, over the 3D view: Gemini's thinking, then fal's progress. */
function LiveStatus({ scan }: { scan: ScanView }) {
  const p = scan.progress
  const parts = scan.analysis?.parts.length ?? 0
  let title: string
  let detail: string | null = null
  let extra: string | null = null
  if (scan.stage === 'analyzing') {
    const agents = p?.agents ?? []
    if (agents.length) {
      const done = agents.filter((a) => a.status !== 'running').length
      title = agents.length > 1 ? `${agents.length} agents writing steps (${done}/${agents.length})` : 'Writing the steps…'
      detail =
        agents.length > 1
          ? agents.map((a) => `${a.name} ${a.status === 'done' ? '✓' : a.status === 'failed' ? '✕' : '…'}`).join(' · ')
          : `${parts} parts`
    } else {
      title = p?.thought ?? (parts ? 'Building the block model…' : 'Looking at your photos…')
      detail = parts ? `${parts} part${parts > 1 ? 's' : ''} found${p?.partsFinal ? ' · splitting into subassemblies' : ''}` : null
    }
    const r = p?.research
    if (r?.status === 'searching') extra = `🔎 Looking up “${r.query}”`
    else if (r?.status === 'done') extra = `🔎 ${r.sources.length} source${r.sources.length === 1 ? '' : 's'} found for “${r.query}”`
  } else {
    const fal = p?.fal
    if (fal?.status === 'IN_QUEUE') title = `3D scan queued${fal.queuePosition != null ? ` (#${fal.queuePosition + 1})` : ''}`
    else if (fal?.status === 'IN_PROGRESS') title = 'Sculpting the 3D scan…'
    else title = 'Starting the 3D scan…'
    detail = fal?.log ?? 'The block model is ready to use meanwhile.'
  }
  return (
    <div className="live-status" role="status">
      <span className="spinner small" aria-hidden />
      <div>
        <strong>{title}</strong>
        {detail && <small>{detail}</small>}
        {extra && <small>{extra}</small>}
      </div>
      <div className="viewer-progress" />
    </div>
  )
}

function Progress({ label }: { label: string }) {
  return (
    <div className="progress">
      <div className="spinner" aria-hidden />
      <span>{label}</span>
    </div>
  )
}

/** The photo with Gemini's part boxes drawn on top: shows the AI's "reasoning" while 3D builds. */
function PhotoWithBoxes({ scan, compact }: { scan: ScanView; compact?: boolean }) {
  // Boxes refer to the photo Gemini picked for the 3D model.
  const photo = scan.photos[scan.modelPhotoIndex] ?? scan.photos[0]
  const parts = scan.analysis?.parts.filter((p) => p.box2d) ?? []
  if (!photo) return null
  return (
    <>
      <figure className={`photo-boxes ${compact ? 'compact' : ''}`} style={{ aspectRatio: `${photo.width} / ${photo.height}` }}>
        <img src={photo.url} alt="Your photo" />
        {parts.map((p) => {
        const [ymin, xmin, ymax, xmax] = p.box2d!
        return (
          <div
            key={p.id}
            className="box"
            style={{ top: `${ymin / 10}%`, left: `${xmin / 10}%`, height: `${(ymax - ymin) / 10}%`, width: `${(xmax - xmin) / 10}%` }}
          >
            <span>{p.name}</span>
          </div>
        )
      })}
      </figure>
      {scan.photos.length > 1 && (
        <div className="angle-strip">
          {scan.photos.map((p, i) => (
            <img key={p.url} src={p.url} alt={`Angle ${i + 1}`} loading="lazy" className={i === scan.modelPhotoIndex ? 'picked' : ''} />
          ))}
        </div>
      )}
    </>
  )
}
