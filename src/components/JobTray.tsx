import { useEffect, useState } from 'react'
import { clearNotice, dismissJob, retryUpload, useJobs, type JobStage } from '../jobs'
import { navigate } from '../nav'

const LABEL: Record<JobStage, string> = {
  uploading: 'Uploading…',
  'upload-failed': 'Upload failed',
  queued: 'Queued…',
  analyzing: 'Finding parts…',
  modeling: 'Building 3D…',
  done: 'Ready',
  failed: 'Failed',
}
const BUSY: JobStage[] = ['uploading', 'queued', 'analyzing', 'modeling']

export default function JobTray() {
  const { jobs, notice } = useJobs()
  const [open, setOpen] = useState(false)
  const busy = jobs.filter((j) => BUSY.includes(j.stage)).length

  // Auto-hide the "ready" toast.
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(clearNotice, 6000)
    return () => clearTimeout(t)
  }, [notice])

  if (jobs.length === 0 && !notice) return null

  const openScan = (scanId: string) => {
    setOpen(false)
    clearNotice()
    navigate(`/scan/${scanId}`)
  }

  return (
    <>
      {notice && (
        <div className="notice" role="status">
          <span>✅ {notice.text}</span>
          <button className="btn primary small" onClick={() => openScan(notice.scanId)}>
            Open
          </button>
        </div>
      )}

      {jobs.length > 0 && (
        <button className={`tray-pill ${busy ? 'busy' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {busy ? <span className="spinner small" aria-hidden /> : <span aria-hidden>✓</span>}
          {busy ? `${busy} processing` : `${jobs.length} scan${jobs.length > 1 ? 's' : ''}`}
        </button>
      )}

      {open && (
        <div className="tray-sheet" role="dialog" aria-label="Your scans">
          <div className="tray-head">
            <strong>Your scans</strong>
            <button className="link-btn dark" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          <ul>
            {jobs.map((j) => (
              <li key={j.localId}>
                {j.thumb ? <img src={j.thumb} alt="" /> : <span className="thumb-ph" />}
                <div className="tray-info">
                  <strong>{j.name}</strong>
                  <span className={`stage ${j.stage}`}>{j.error && j.stage === 'upload-failed' ? j.error : LABEL[j.stage]}</span>
                </div>
                {j.stage === 'upload-failed' ? (
                  <button className="btn ghost small" onClick={() => retryUpload(j.localId)}>
                    Retry
                  </button>
                ) : j.scanId ? (
                  <button className="btn ghost small" onClick={() => openScan(j.scanId!)}>
                    Open
                  </button>
                ) : null}
                {!BUSY.includes(j.stage) && (
                  <button className="link-btn dark" aria-label="Remove" onClick={() => dismissJob(j.localId)}>
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
