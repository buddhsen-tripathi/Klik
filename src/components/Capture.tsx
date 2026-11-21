import { useEffect, useRef, useState } from 'react'
import { createScan, listScans, type ScanSummary } from '../api'
import { navigate } from '../nav'

export default function Capture() {
  const cameraInput = useRef<HTMLInputElement>(null)
  const libraryInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [hint, setHint] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recent, setRecent] = useState<ScanSummary[]>([])

  useEffect(() => {
    listScans().then(setRecent).catch(() => setRecent([]))
  }, [])

  useEffect(() => {
    if (!file) return setPreview(null)
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) {
      setFile(f)
      setError(null)
    }
    e.target.value = ''
  }

  const start = async () => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const id = await createScan(file, hint)
      navigate(`/scan/${id}`)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <main className="capture">
      <section className="hero">
        <h1>Point, shoot, take it apart.</h1>
        <p>Photograph furniture, a gadget or a machine. You'll get a 3D model and step-by-step instructions to take it apart or put it together.</p>
      </section>

      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={onPick} />
      <input ref={libraryInput} type="file" accept="image/jpeg,image/png,image/webp,image/heic" hidden onChange={onPick} />

      {preview ? (
        <section className="card preview-card">
          <img src={preview} alt="Selected object" className="preview" />
          <label className="field">
            <span>What is it? (optional)</span>
            <input
              type="text"
              placeholder="e.g. IKEA bedside table, desk fan"
              value={hint}
              maxLength={200}
              onChange={(e) => setHint(e.target.value)}
            />
          </label>
          <div className="row">
            <button className="btn ghost" onClick={() => setFile(null)} disabled={busy}>
              Retake
            </button>
            <button className="btn primary grow" onClick={start} disabled={busy}>
              {busy ? 'Uploading…' : 'Build 3D model'}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </section>
      ) : (
        <section className="card pick-card">
          <button className="btn primary big" onClick={() => cameraInput.current?.click()}>
            Take a photo
          </button>
          <button className="btn ghost" onClick={() => libraryInput.current?.click()}>
            Choose from library
          </button>
          <p className="tip">Tip: shoot the whole object at a slight angle, on a plain background, in even light.</p>
        </section>
      )}

      {recent.length > 0 && (
        <section className="recent">
          <h2>Recent scans</h2>
          <ul>
            {recent.map((s) => (
              <li key={s.id}>
                <a href={`#/scan/${s.id}`}>
                  <img src={s.photoUrl} alt="" loading="lazy" />
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
