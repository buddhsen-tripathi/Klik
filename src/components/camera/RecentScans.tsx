import { ChevronRight } from 'lucide-react'
import type { ScanSummary } from '../../shared/types'

const STATUS: Record<string, string> = { done: 'Ready', failed: 'Failed' }

/** Recent scans as compact rows: thumbnail, name, status. */
export default function RecentScans({ scans }: { scans: ScanSummary[] }) {
  if (!scans.length) return null
  return (
    <section className="recent">
      <h2 className="eyebrow">Recent scans</h2>
      <ul>
        {scans.map((s, i) => (
          <li key={s.id} style={{ animationDelay: `${120 + i * 40}ms` }}>
            <a href={`#/scan/${s.id}`}>
              {s.photoUrl ? <img src={s.photoUrl} alt="" loading="lazy" /> : <span className="recent-ph" />}
              <span className="recent-name">{s.objectName ?? (s.stage === 'failed' ? 'Failed scan' : 'New scan')}</span>
              <span className={`recent-status ${s.stage}`}>{STATUS[s.stage] ?? 'Building'}</span>
              <ChevronRight aria-hidden className="recent-go" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
