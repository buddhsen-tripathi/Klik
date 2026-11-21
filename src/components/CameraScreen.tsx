import { useEffect, useRef, useState } from 'react'
import { identify, toJpeg, type Shot } from '../api'
import { makeSignaturer, sigDiff, useCamera } from '../camera'
import { enqueueScan } from '../jobs'
import type { Identification } from '../shared/types'

const MAX_SHOTS = 6
const GOOD_SHOTS = 3
const TICK_MS = 300 // motion check rate (cheap: 32x24 pixels)
const STABLE_DIFF = 7 // below this the view counts as "held still"
const STABLE_MS = 600 // ...for this long
const CHANGED_DIFF = 16 // scene changed enough to identify again
const ROTATED_DIFF = 12 // object turned enough for a new auto shot
const IDENTIFY_GAP_MS = 1800
const AUTO_GAP_MS = 1200

/** Angles we ask for, and how the guide cube turns to show that face. */
const ANGLES = [
  { label: 'Front', face: 'front', cube: 'rotateY(0deg)' },
  { label: 'Left side', face: 'left', cube: 'rotateY(90deg)' },
  { label: 'Back', face: 'back', cube: 'rotateY(180deg)' },
  { label: 'Right side', face: 'right', cube: 'rotateY(-90deg)' },
  { label: 'Top', face: 'top', cube: 'rotateX(-90deg)' },
  { label: 'Any close-up', face: '', cube: 'rotateX(-35deg) rotateY(45deg)' },
]

interface Captured extends Shot {
  url: string
}

export default function CameraScreen({ onUseLibrary }: { onUseLibrary: () => void }) {
  const { videoRef, status } = useCamera()
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 })
  const [detection, setDetection] = useState<Identification | null>(null)
  const [stale, setStale] = useState(false)
  const [identifying, setIdentifying] = useState(false)
  const [shots, setShots] = useState<Captured[]>([])
  const [auto, setAuto] = useState(false)
  const [flash, setFlash] = useState(0)
  const [sent, setSent] = useState<string | null>(null)

  // Refs read by the loop so it doesn't re-render ~3x a second.
  const loop = useRef({
    prevSig: null as Uint8Array | null,
    stableSince: 0,
    lastIdSig: null as Uint8Array | null,
    lastIdAt: 0,
    inflight: null as AbortController | null,
    lastShotSig: null as Uint8Array | null,
    lastShotAt: 0,
    capturing: false,
  })
  const shotsRef = useRef(shots)
  shotsRef.current = shots
  const autoRef = useRef(auto)
  autoRef.current = auto

  // Track the stage size to map Gemini's boxes onto the cropped (object-fit: cover) video.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setStageSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const capture = async (sig: Uint8Array | null) => {
    const video = videoRef.current
    const l = loop.current
    if (!video?.videoWidth || l.capturing || shotsRef.current.length >= MAX_SHOTS) return
    l.capturing = true
    try {
      const shot = await toJpeg(video, 1600)
      l.lastShotSig = sig
      l.lastShotAt = performance.now()
      setShots((s) => [...s, { ...shot, url: URL.createObjectURL(shot.blob) }])
      setFlash((f) => f + 1)
      navigator.vibrate?.(25)
    } finally {
      l.capturing = false
    }
  }

  // Motion loop: identify when steady and something new is in view; auto-capture new angles.
  useEffect(() => {
    if (status !== 'live') return
    const signature = makeSignaturer()
    const timer = setInterval(() => {
      const video = videoRef.current
      if (!video || document.hidden) return
      const l = loop.current
      const sig = signature(video)
      if (!sig) return
      const now = performance.now()
      const motion = sigDiff(sig, l.prevSig)
      l.prevSig = sig
      if (motion > STABLE_DIFF) l.stableSince = now
      const steady = now - l.stableSince >= STABLE_MS
      const changedSinceId = sigDiff(sig, l.lastIdSig)
      setStale(l.lastIdSig !== null && changedSinceId > CHANGED_DIFF)

      if (steady && !l.inflight && changedSinceId > CHANGED_DIFF && now - l.lastIdAt > IDENTIFY_GAP_MS) {
        l.lastIdSig = sig
        l.lastIdAt = now
        const ctrl = new AbortController()
        l.inflight = ctrl
        setIdentifying(true)
        toJpeg(video, 512, 0.7)
          .then((frame) => identify(frame.blob, ctrl.signal))
          .then((res) => {
            setDetection(res)
            setStale(false)
          })
          .catch(() => {})
          .finally(() => {
            if (l.inflight === ctrl) l.inflight = null
            setIdentifying(false)
          })
      }

      if (
        autoRef.current &&
        steady &&
        shotsRef.current.length < MAX_SHOTS &&
        sigDiff(sig, l.lastShotSig) > ROTATED_DIFF &&
        now - l.lastShotAt > AUTO_GAP_MS
      ) {
        void capture(sig)
      }
    }, TICK_MS)
    return () => {
      clearInterval(timer)
      loop.current.inflight?.abort()
    }
  }, [status])

  // Free thumbnails when leaving the screen.
  useEffect(() => () => shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url)), [])

  const removeShot = (i: number) =>
    setShots((s) => {
      URL.revokeObjectURL(s[i].url)
      return s.filter((_, j) => j !== i)
    })

  const finish = () => {
    if (shots.length === 0) return
    const name = detection?.found ? detection.name : ''
    enqueueScan(
      shots.map(({ blob, width, height }) => ({ blob, width, height })),
      name,
    )
    shots.forEach((s) => URL.revokeObjectURL(s.url))
    setShots([])
    setAuto(false)
    loop.current.lastShotSig = null
    setSent(name || 'Your scan')
    setTimeout(() => setSent(null), 3500)
  }

  const next = ANGLES[Math.min(shots.length, ANGLES.length - 1)]
  const found = detection?.found && !stale ? detection : null
  const prompt =
    shots.length === 0
      ? found
        ? found.tip || `Tap the shutter to scan the ${found.name.toLowerCase()}`
        : 'Point at the thing you want to take apart'
      : shots.length >= MAX_SHOTS
        ? 'That’s plenty. Tap Done.'
        : auto
          ? `Slowly rotate it. I’ll grab the ${next.label.toLowerCase()} when you hold still.`
          : `Rotate the object (or walk around it) and shoot the ${next.label.toLowerCase()}`

  if (status === 'denied' || status === 'unsupported') {
    return (
      <main className="scan-page centered">
        <div className="card">
          <h2>{status === 'denied' ? 'Camera access was blocked' : 'Live camera isn’t available here'}</h2>
          <p className="muted">
            {status === 'denied'
              ? 'Allow camera access in your browser settings, or pick photos instead.'
              : 'Live camera needs HTTPS. You can still pick photos from your library.'}
          </p>
          <button className="btn primary" onClick={onUseLibrary}>
            Pick photos instead
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="camera">
      <div className="camera-stage" ref={stageRef}>
        <video ref={videoRef} playsInline muted autoPlay />
        {found?.box2d && <DetectionOverlay det={found} video={videoRef.current} stage={stageSize} />}
        <div key={flash} className={flash ? 'shutter-flash' : ''} />

        <div className="camera-top">
          <span className="brand light">
            <span className="brand-mark" aria-hidden>
              ⬡
            </span>
            Assemble on the Go
          </span>
          <button className="link-btn" onClick={onUseLibrary}>
            Upload photos
          </button>
        </div>

        <div className="camera-guide">
          <GuideCube transform={next.cube} got={ANGLES.slice(0, shots.length).map((a) => a.face)} />
          <p>
            {status !== 'live' ? 'Starting camera…' : prompt}
            {identifying && shots.length === 0 && !found && <span className="dots" aria-hidden />}
          </p>
        </div>

        {sent && <div className="toast">Processing “{sent}” in the background. Scan the next one!</div>}
      </div>

      <div className="camera-controls">
        <div className="shots">
          {shots.map((s, i) => (
            <button key={s.url} className="shot" onClick={() => removeShot(i)} title="Remove">
              <img src={s.url} alt={`Angle ${i + 1}`} />
              <span className="shot-x">×</span>
            </button>
          ))}
          {Array.from({ length: Math.max(0, GOOD_SHOTS - shots.length) }, (_, i) => (
            <span key={`slot-${i}`} className="shot slot" />
          ))}
        </div>
        <div className="camera-buttons">
          <button className={`toggle ${auto ? 'on' : ''}`} onClick={() => setAuto((a) => !a)} disabled={status !== 'live'}>
            Auto
          </button>
          <button
            className="shutter"
            aria-label="Take photo"
            onClick={() => capture(null)}
            disabled={status !== 'live' || shots.length >= MAX_SHOTS}
          />
          <button className={`done ${shots.length >= GOOD_SHOTS ? 'ready' : ''}`} onClick={finish} disabled={shots.length === 0}>
            Done{shots.length ? ` (${shots.length})` : ''}
          </button>
        </div>
      </div>
    </main>
  )
}

/** Box + floating "3D hover" tag over the identified item. */
function DetectionOverlay({ det, video, stage }: { det: Identification; video: HTMLVideoElement | null; stage: { w: number; h: number } }) {
  if (!video?.videoWidth || !stage.w || !det.box2d) return null
  // object-fit: cover crops the video; map 0-1000 frame coords onto the visible area.
  const scale = Math.max(stage.w / video.videoWidth, stage.h / video.videoHeight)
  const dw = video.videoWidth * scale
  const dh = video.videoHeight * scale
  const ox = (stage.w - dw) / 2
  const oy = (stage.h - dh) / 2
  const [ymin, xmin, ymax, xmax] = det.box2d
  const left = Math.max(8, ox + (xmin / 1000) * dw)
  const top = Math.max(8, oy + (ymin / 1000) * dh)
  const right = Math.min(stage.w - 8, ox + (xmax / 1000) * dw)
  const bottom = Math.min(stage.h - 8, oy + (ymax / 1000) * dh)

  return (
    <div className="detection" style={{ left, top, width: right - left, height: bottom - top }}>
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />
      <div className={`hover-tag ${top < 90 ? 'inside' : ''}`}>
        <span className="mini-cube" aria-hidden>
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </span>
        <span className="hover-text">
          <strong>{det.name}</strong>
          <small>{det.disassemblable ? 'Ready to scan in 3D' : 'Probably not built to come apart'}</small>
        </span>
      </div>
    </div>
  )
}

/** Small 3D cube that turns to show which side to photograph next. */
function GuideCube({ transform, got }: { transform: string; got: string[] }) {
  return (
    <div className="guide-cube" aria-hidden>
      <div className="cube" style={{ transform: `rotateX(-18deg) rotateY(-24deg) ${transform}` }}>
        {['front', 'right', 'back', 'left', 'top', 'bottom'].map((f) => (
          <span key={f} className={`face ${f} ${got.includes(f) ? 'got' : ''}`} />
        ))}
      </div>
    </div>
  )
}
