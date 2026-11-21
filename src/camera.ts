import { useEffect, useRef, useState } from 'react'

export type CameraStatus = 'starting' | 'live' | 'denied' | 'unsupported' | 'paused'

/** Live camera access needs a secure context (HTTPS or localhost). */
export const cameraSupported = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext

/**
 * Rear camera stream attached to a <video>. The stream is stopped whenever the tab is
 * hidden (and restarted when it's back) so the camera and battery aren't held open.
 */
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<CameraStatus>(cameraSupported() ? 'starting' : 'unsupported')

  useEffect(() => {
    if (!cameraSupported()) return
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
        const s = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        })
        if (cancelled || document.hidden) return s.getTracks().forEach((t) => t.stop())
        stream = s
        const v = videoRef.current
        if (v) {
          v.srcObject = s
          await v.play().catch(() => {})
        }
        setStatus('live')
      } catch (err) {
        setStatus((err as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'unsupported')
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
  }, [])

  return { videoRef, status }
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
