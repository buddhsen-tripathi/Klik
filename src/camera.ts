import { useEffect, useRef, useState } from 'react'

/** 'prompt': we haven't asked yet; show an "Allow camera" button (iOS asks reliably only from a tap). */
export type CameraStatus = 'prompt' | 'starting' | 'live' | 'denied' | 'unsupported' | 'paused'
export type Facing = 'environment' | 'user'

/** Live camera access needs a secure context (HTTPS or localhost). */
export const cameraSupported = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext

export const isIOS = () =>
  typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
/** Instagram, WhatsApp, Facebook etc. in-app browsers on iOS have no camera API. */
export const isInAppBrowser = () => typeof navigator !== 'undefined' && /FBAN|FBAV|Instagram|WhatsApp|Line\/|Snapchat|LinkedInApp|GSA\//.test(navigator.userAgent)

const GRANTED_KEY = 'camera-granted'
const rememberGrant = (ok: boolean) => {
  try {
    if (ok) localStorage.setItem(GRANTED_KEY, '1')
    else localStorage.removeItem(GRANTED_KEY)
  } catch {
    // Private mode: we'll just ask again next time.
  }
}
const grantedBefore = () => {
  try {
    return localStorage.getItem(GRANTED_KEY) === '1'
  } catch {
    return false
  }
}

const constraints = (facing: Facing): MediaStreamConstraints => ({
  audio: false,
  video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
})

/**
 * Rear camera stream attached to a <video>. The stream is stopped whenever the tab is
 * hidden (and restarted when it's back) so the camera and battery aren't held open.
 */
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [allowed, setAllowed] = useState(grantedBefore)
  const [status, setStatus] = useState<CameraStatus>(!cameraSupported() ? 'unsupported' : allowed ? 'starting' : 'prompt')
  const [facing, setFacing] = useState<Facing>('environment')
  const [canFlip, setCanFlip] = useState(false)
  // Stream opened straight from the "Allow camera" tap, handed to the effect below.
  const pending = useRef<MediaStream | null>(null)

  // Already granted (e.g. on Android/Chrome, or iOS with "Allow" set for this site)? Then skip the button.
  useEffect(() => {
    if (allowed || !cameraSupported() || !navigator.permissions?.query) return
    navigator.permissions
      .query({ name: 'camera' as PermissionName })
      .then((p) => {
        if (p.state === 'granted') setAllowed(true)
        else if (p.state === 'denied') setStatus('denied')
      })
      .catch(() => {})
  }, [allowed])

  /** Call from a tap: iOS Safari only shows its permission sheet reliably inside a user gesture. */
  const request = async () => {
    if (!cameraSupported()) return
    setStatus('starting')
    try {
      pending.current = await navigator.mediaDevices.getUserMedia(constraints(facing))
      rememberGrant(true)
      setAllowed(true)
    } catch (err) {
      rememberGrant(false)
      setStatus((err as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'unsupported')
    }
  }

  useEffect(() => {
    if (!cameraSupported() || !allowed) return
    let stream: MediaStream | null = null
    let cancelled = false

    const stop = () => {
      stream?.getTracks().forEach((t) => t.stop())
      stream = null
    }
    const start = async () => {
      if (stream || document.hidden) return
      setStatus('starting')
      try {
        const s = pending.current ?? (await navigator.mediaDevices.getUserMedia(constraints(facing)))
        pending.current = null
        if (cancelled || document.hidden) return s.getTracks().forEach((t) => t.stop())
        stream = s
        const v = videoRef.current
        if (v) {
          v.srcObject = s
          await v.play().catch(() => {})
        }
        setStatus('live')
        // Device labels/count are only reliable after permission is granted.
        navigator.mediaDevices
          .enumerateDevices()
          .then((d) => setCanFlip(d.filter((x) => x.kind === 'videoinput').length > 1))
          .catch(() => {})
      } catch (err) {
        const denied = (err as DOMException)?.name === 'NotAllowedError'
        if (denied) rememberGrant(false)
        setStatus(denied ? 'denied' : 'unsupported')
      }
    }
    const onVisibility = () => {
      if (document.hidden) {
        stop()
        setStatus('paused')
      } else void start()
    }

    void start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  }, [facing, allowed])

  const flip = () => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))
  return { videoRef, status, facing, canFlip, flip, request }
}

// ---------- cheap motion / change detection ----------

const SIG_W = 32
const SIG_H = 24

/** 32x24 grayscale thumbnail of the current frame: enough to tell "steady" from "moving". */
export function makeSignaturer() {
  const canvas = document.createElement('canvas')
  canvas.width = SIG_W
  canvas.height = SIG_H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  return (video: HTMLVideoElement): Uint8Array | null => {
    if (!video.videoWidth) return null
    ctx.drawImage(video, 0, 0, SIG_W, SIG_H)
    const { data } = ctx.getImageData(0, 0, SIG_W, SIG_H)
    const out = new Uint8Array(SIG_W * SIG_H)
    for (let i = 0; i < out.length; i++) out[i] = (data[i * 4] * 3 + data[i * 4 + 1] * 6 + data[i * 4 + 2]) / 10
    return out
  }
}

/** Mean absolute difference between two signatures, 0-255. */
export function sigDiff(a: Uint8Array | null, b: Uint8Array | null): number {
  if (!a || !b) return 255
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / a.length
}
