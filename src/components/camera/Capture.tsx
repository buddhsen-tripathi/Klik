import { useEffect, useRef, useState } from 'react'
import { listScans, prepareFile } from '../../api'
import { cameraSupported } from '../../camera'
import { enqueueScan } from '../../jobs'
import type { ScanSummary } from '../../shared/types'

const MAX_PHOTOS = 6

/** Fallback when there's no live camera (plain HTTP, desktop, or permission denied): pick photos. */
export default function Capture({ onUseCamera }: { onUseCamera: () => void }) {
  const libraryInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [hint, setHint] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [recent, setRecent] = useState<ScanSummary[]>([])

  useEffect(() => {
    listScans().then(setRecent).catch(() => setRecent([]))
  }, [])

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f))
    setPreviews(urls)
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [files])

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? [])
    if (picked.length) {
      setFiles((f) => [...f, ...picked].slice(0, MAX_PHOTOS))
      setError(null)
      setSent(false)
    }
    e.target.value = ''
  }

  const start = async () => {
    if (!files.length) return
    setBusy(true)
    setError(null)
    try {
      const shots = await Promise.all(files.map(prepareFile))
      enqueueScan(shots, hint)
      setFiles([])
      setHint('')
      setSent(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="capture">
      <section className="hero">
        <h1>Point, shoot, take it apart.</h1>
        <p>Add 1–6 photos of the same object from different angles. You'll get a 3D model and step-by-step instructions.</p>
      </section>

      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={onPick} />
      <input ref={libraryInput} type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple hidden onChange={onPick} />

      <section className="card pick-card">
        {previews.length > 0 && (
          <div className="preview-grid">
            {previews.map((url, i) => (
              <button key={url} className="shot" onClick={() => setFiles((f) => f.filter((_, j) => j !== i))} title="Remove">
                <img src={url} alt={`Angle ${i + 1}`} />
                <span className="shot-x">×</span>
              </button>
            ))}
          </div>
        )}
        <div className="row">
          <button className="btn ghost grow" onClick={() => cameraInput.current?.click()} disabled={files.length >= MAX_PHOTOS}>
            Take photo
          </button>
          <button className="btn ghost grow" onClick={() => libraryInput.current?.click()} disabled={files.length >= MAX_PHOTOS}>
            Choose photos
          </button>
        </div>
        {files.length > 0 && (
          <>
            <label className="field">
              <span>What is it? (optional)</span>
              <input type="text" placeholder="e.g. IKEA bedside table" value={hint} maxLength={200} onChange={(e) => setHint(e.target.value)} />
            </label>
            <button className="btn primary big" onClick={start} disabled={busy}>
              {busy ? 'Preparing…' : `Build 3D model from ${files.length} photo${files.length > 1 ? 's' : ''}`}
            </button>
          </>
        )}
        {sent && <p className="muted">Processing in the background. Add another object whenever you like.</p>}
        {error && <p className="error">{error}</p>}
        {cameraSupported() && (
          <button className="link-btn dark" onClick={onUseCamera}>
            Use live camera instead
          </button>
        )}
      </section>

      {recent.length > 0 && (
        <section className="recent">
          <h2>Recent scans</h2>
          <ul>
            {recent.map((s) => (
              <li key={s.id}>
                <a href={`#/scan/${s.id}`}>
                  {s.photoUrl && <img src={s.photoUrl} alt="" loading="lazy" />}
                  <span>{s.objectName ?? (s.stage === 'failed' ? 'Failed scan' : 'Processing…')}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
