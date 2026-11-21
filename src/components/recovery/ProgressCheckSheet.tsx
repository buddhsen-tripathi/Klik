import { useState } from 'react'
import { checkProgress, prepareFile } from '../../api'
import type { Mode } from '../../explode'
import type { Recovery } from '../../shared/types'
import './Recovery.css'

/**
 * "Check my progress": photo of the build as it is now (+ optional note) → where you are,
 * what's off, and a fix plan. Uses the native camera (file input), which works on iOS
 * without extra permission prompts.
 */
export default function ProgressCheckSheet({
  scanId,
  mode,
  initialNote = '',
  onDone,
  onClose,
}: {
  scanId: string
  mode: Mode
  initialNote?: string
  onDone: (r: Recovery) => void
  onClose: () => void
}) {
  const [note, setNote] = useState(initialNote)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pick = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setBusy(true)
    setPreview(URL.createObjectURL(file))
    try {
      const shot = await prepareFile(file)
      onDone(await checkProgress(scanId, shot.blob, mode, note.trim() || null))
    } catch (err) {
      setError((err as Error).message || 'Could not check the photo')
      setBusy(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={busy ? undefined : onClose}>
      <div className="sheet card" role="dialog" aria-label="Check my progress" onClick={(e) => e.stopPropagation()}>
        <h2>Check my progress</h2>
        <p className="muted">Take a photo of your build as it is now. I’ll spot what’s done, anything that’s off, and where to pick up.</p>
        {preview && <img className="sheet-preview" src={preview} alt="Your build" />}
        {busy ? (
          <div className="progress">
            <div className="spinner" aria-hidden />
            <span>Checking your build…</span>
          </div>
        ) : (
          <>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything you think went wrong? (optional) e.g. “one screw left over”"
              rows={2}
            />
            {error && <p className="error small">{error}</p>}
            <label className="btn primary">
              📷 Take a photo
              <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files?.[0])} />
            </label>
            <label className="btn ghost">
              Choose from library
              <input type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
            </label>
            <button className="link-btn" onClick={onClose}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  )
}
