import './LiveCheck.css'
import { useEffect, useRef, useState } from 'react'
import { checkStep, toJpeg } from '../../api'
import { useCamera } from '../../camera'
import type { Mode } from '../../explode'
import CameraPermission from './CameraPermission'

const CHECK_EVERY_MS = 1200
const DONE_AT = 0.75 // P(step done) needed...
const HITS_NEEDED = 2 // ...on this many frames in a row, so one lucky frame doesn't skip a step
const COOLDOWN_MS = 2500 // after advancing, let the user move on before judging the next step

/**
 * Hands-free mode: a small camera preview that asks the Decisions API every ~1.2 s whether
 * the current step is done, and advances when it is. The camera stops as soon as this unmounts.
 */
export default function LiveCheck({
  scanId,
  plan,
  mode,
  stepIndex,
  stepCount,
  onAdvance,
  onClose,
}: {
  scanId: string
  /** Following the fix plan from a progress check (step numbers refer to it). */
  plan?: boolean
  mode: Mode
  stepIndex: number
  stepCount: number
  onAdvance: () => void
  onClose: () => void
}) {
  const { videoRef, status, request } = useCamera()
  const [result, setResult] = useState<{ done: number; inView: number } | null>(null)
  const [finished, setFinished] = useState(false)
  const loop = useRef({ busy: false, hits: 0, quietUntil: 0 })
  const latest = useRef({ stepIndex, stepCount, onAdvance })
  latest.current = { stepIndex, stepCount, onAdvance }

  // New step: start counting again.
  useEffect(() => {
    loop.current.hits = 0
    setResult(null)
  }, [stepIndex, mode])

  useEffect(() => {
    if (status !== 'live' || finished) return
    const ctrl = new AbortController()
    const timer = setInterval(async () => {
      const v = videoRef.current
      const l = loop.current
      if (l.busy || !v?.videoWidth || document.hidden || Date.now() < l.quietUntil) return
      const { stepIndex: i, stepCount: n } = latest.current
      if (i < 0 || i >= n) return
      l.busy = true
      try {
        const shot = await toJpeg(v, 640, 0.7)
        const r = await checkStep(scanId, shot.blob, i, mode, ctrl.signal, plan)
        if (latest.current.stepIndex !== i) return // user moved on meanwhile
        setResult(r)
        l.hits = r.inView >= 0.5 && r.done >= DONE_AT ? l.hits + 1 : 0
        if (l.hits >= HITS_NEEDED) {
          l.hits = 0
          l.quietUntil = Date.now() + COOLDOWN_MS
          navigator.vibrate?.(60)
          if (i >= n - 1) setFinished(true)
          else latest.current.onAdvance()
        }
      } catch {
        // Network hiccup or aborted: try again next tick.
      } finally {
        l.busy = false
      }
    }, CHECK_EVERY_MS)
    return () => {
      clearInterval(timer)
      ctrl.abort()
    }
  }, [status, finished, scanId, mode, videoRef, plan])

  const pct = result ? Math.round(result.done * 100) : 0
  let label: string
  if (finished) label = 'All steps done 🎉'
  else if (status === 'denied') label = 'Camera blocked'
  else if (status !== 'live') label = 'Starting camera…'
  else if (stepIndex < 0) label = 'Press Start'
  else if (!result) label = `Watching step ${stepIndex + 1}…`
  else if (result.inView < 0.5) label = 'Point the camera at the object'
  else label = `Step ${stepIndex + 1}: ${pct >= 75 ? 'looks done' : 'not done yet'}`

  if (status === 'prompt' || status === 'denied' || status === 'unsupported')
    return (
      <div className="live-check-permission">
        <CameraPermission status={status} onAllow={request} compact />
        <button className="link-btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    )

  return (
    <div className="live-check" role="status">
      <video ref={videoRef} playsInline muted autoPlay />
      <div className="live-check-info">
        <strong>{label}</strong>
        {!finished && result && result.inView >= 0.5 && (
          <div className="meter" aria-label={`${pct}% likely done`}>
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
        <button className="link-btn" onClick={onClose}>
          Stop watching
        </button>
      </div>
    </div>
  )
}
