import './LiveCheck.css'
import { useEffect, useRef, useState } from 'react'
import { checkStep, toJpeg } from '../../api'
import { useCamera } from '../../camera'
import type { Mode } from '../../explode'
import { Box, Maximize2 } from 'lucide-react'
import { useT } from '../../i18n/useT'
import CameraPermission from './CameraPermission'

const CHECK_EVERY_MS = 1200
const DONE_AT = 0.75 // P(step done) needed...
const HITS_NEEDED = 2 // ...on this many frames in a row, so one lucky frame doesn't skip a step
const COOLDOWN_MS = 2500 // after advancing, let the user move on before judging the next step

/**
 * Hands-free mode: the camera fills the 3D view (shrink it to a corner to look at the model), and that asks the Decisions API every ~1.2 s whether
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
  onFrame,
  stopLabel,
}: {
  scanId: string
  /** Following the fix plan from a progress check (step numbers refer to it). */
  plan?: boolean
  mode: Mode
  stepIndex: number
  stepCount: number
  onAdvance: () => void
  onClose: () => void
  /** Every frame that gets checked (live coach streams these to the voice agent). */
  onFrame?: (jpeg: Blob) => void
  stopLabel?: string
}) {
  const t = useT()
  const { videoRef, status, request } = useCamera()
  // Big by default: the user aims the phone at their hands. "Show 3D" tucks it into a corner.
  const [big, setBig] = useState(true)
  const [result, setResult] = useState<{ done: number; inView: number } | null>(null)
  const [finished, setFinished] = useState(false)
  const loop = useRef({ busy: false, hits: 0, quietUntil: 0 })
  const latest = useRef({ stepIndex, stepCount, onAdvance, onFrame })
  latest.current = { stepIndex, stepCount, onAdvance, onFrame }

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
        latest.current.onFrame?.(shot.blob)
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
  const n = stepIndex + 1
  let label: string
  if (finished) label = t('allDone')
  else if (status === 'denied') label = t('cameraBlocked')
  else if (status !== 'live') label = t('startingCamera')
  else if (stepIndex < 0) label = t('pressStart')
  else if (!result) label = t('watchingStep', { n })
  else if (result.inView < 0.5) label = t('pointCamera')
  else label = pct >= 75 ? t('looksDone', { n }) : t('notDoneYet', { n })

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
    <div className={`live-check${big ? ' big' : ''}`} role="status">
      <video ref={videoRef} playsInline muted autoPlay onClick={big ? undefined : () => setBig(true)} />
      {!big && (
        <button className="live-check-expand" onClick={() => setBig(true)} aria-label={t('showCamera')}>
          <Maximize2 aria-hidden />
        </button>
      )}
      <div className="live-check-info">
        <strong>{label}</strong>
        {!finished && result && result.inView >= 0.5 && (
          <div className="meter" aria-label={`${pct}% likely done`}>
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
        <div className="live-check-actions">
          {big && (
            <button className="link-btn icon-text" onClick={() => setBig(false)}>
              <Box aria-hidden /> {t('show3d')}
            </button>
          )}
          <button className="link-btn" onClick={onClose}>
            {stopLabel ?? t('endCoach')}
          </button>
        </div>
      </div>
    </div>
  )
}
