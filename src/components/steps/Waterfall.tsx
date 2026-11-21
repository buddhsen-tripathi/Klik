import type { Timing } from '../shared/types'

const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
const TOTALS = new Set(['steps ready', 'model ready'])

/** Latency waterfall for one scan: every stage on one timeline from the upload. */
export default function Waterfall({ timings }: { timings: Timing[] }) {
  if (timings.length === 0) return null
  const t0 = Math.min(...timings.map((t) => t.start))
  const span = Math.max(...timings.map((t) => t.end)) - t0 || 1
  const rows = [...timings].sort((a, b) => Number(TOTALS.has(a.name)) - Number(TOTALS.has(b.name)) || a.start - b.start)
  return (
    <div className="waterfall" role="table" aria-label="Where the time went">
      {rows.map((t, i) => (
        <div key={i} className={`wf-row${TOTALS.has(t.name) ? ' total' : ''}${t.note?.startsWith('failed') ? ' failed' : ''}`} role="row">
          <span className="wf-name" title={[t.note, t.generationId && `Clonvo ${t.generationId}`].filter(Boolean).join(' · ')}>
            {t.name}
          </span>
          <span className="wf-track">
            <span className="wf-bar" style={{ left: `${((t.start - t0) / span) * 100}%`, width: `max(2px, ${((t.end - t.start) / span) * 100}%)` }} />
          </span>
          <span className="wf-time">{secs(t.end - t.start)}</span>
        </div>
      ))}
    </div>
  )
}
