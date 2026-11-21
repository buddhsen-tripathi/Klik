import type { ScanView } from '../../shared/types'
import { MATCH_LABEL, TRIAGE_STATE } from './labels'

/** Checklist shown before the parts arrive: identify → search manuals → read them → plan. */
export default function Pipeline({ scan }: { scan: ScanView }) {
  const p = scan.progress!
  const order = ['identifying', 'researching', 'planning', 'writing'] as const
  const at = order.indexOf(p.phase ?? 'identifying')
  const state = (i: number) => (i < at ? 'pl-done' : i === at ? 'pl-active' : 'pl-todo')
  const id = p.identity
  const r = p.research
  const who = id ? [id.brand, id.model].filter(Boolean).join(' · ') : ''

  const researchTitle =
    r?.status === 'skipped'
      ? 'Documentation lookup off'
      : r?.status === 'not_needed'
        ? 'Generic object, no manual needed'
      : r?.status === 'reading'
        ? `Reading ${r.sources.length} page${r.sources.length === 1 ? '' : 's'} for dimensions and screws`
        : r?.status === 'done'
          ? MATCH_LABEL[r.match ?? 'none']
          : r?.status === 'failed'
            ? 'No documentation found'
            : 'Searching manuals and teardown guides'

  return (
    <ol className="pipeline" aria-live="polite">
      <li className={state(0)}>
        <strong>{id ? id.objectName : 'Identifying the exact model'}</strong>
        {who && <small>{who}</small>}
        {p.triage && (
          <small>
            {TRIAGE_STATE[p.triage.state]} · {p.triage.complexity} · manual {p.triage.hasDocs >= 0.4 ? 'likely' : 'unlikely'}
          </small>
        )}
      </li>
      <li className={r?.status === 'skipped' || r?.status === 'not_needed' ? 'pl-todo' : state(1)}>
        <strong>{researchTitle}</strong>
        {r?.status === 'searching' && r.queries.map((q) => <small key={q}>🔎 {q}</small>)}
        {r && r.sources.length > 0 && (
          <small className="sources-line">{r.sources.slice(0, 4).map((src) => new URL(src.url).hostname.replace(/^www\./, '')).join(' · ')}</small>
        )}
      </li>
      <li className={state(2)}>
        <strong>{at === 2 && p.thought ? `${p.thought}…` : 'Planning parts and fasteners'}</strong>
      </li>
    </ol>
  )
}
