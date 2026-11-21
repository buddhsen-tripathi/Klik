import { useEffect, useRef, useState } from 'react'
import { getScan } from '../../api'
import type { ScanView } from '../../shared/types'
import Progress from '../ui/Progress'
import { STAGE_LABEL } from './labels'
import Pipeline from './Pipeline'
import PhotoWithBoxes from './PhotoWithBoxes'
import { stableScan } from './stableScan'
import Workbench from './Workbench'

const POLL_MS = 2500
const POLL_STREAMING_MS = 1000 // while Gemini streams parts, poll fast so they appear live

/** Loads and polls one scan; shows progress until there's an analysis, then the workbench. */
export default function ScanPage({ id }: { id: string }) {
  const [scan, setScan] = useState<ScanView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const last = useRef('')

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
        // Unchanged (usually a 304 from the ETag): nothing to re-render.
        const text = JSON.stringify(s)
        if (text !== last.current) {
          last.current = text
          setScan((prev) => stableScan(prev, s))
        }
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

  const analysis = scan?.analysis ?? null

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
      <main className="scan-page scanning">
        <div className="scan-photo">
          <PhotoWithBoxes scan={scan} />
          <span className="scan-beam" aria-hidden />
        </div>
        {scan.stage === 'analyzing' && scan.progress?.phase ? (
          <Pipeline scan={scan} />
        ) : (
          <Progress label={STAGE_LABEL[scan.stage]} />
        )}
      </main>
    )
  }

  return <Workbench scan={scan} analysis={analysis} onScan={setScan} />
}
