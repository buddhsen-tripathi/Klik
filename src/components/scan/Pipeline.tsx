import type { ScanView } from '../../shared/types'

/** Checklist shown before the parts arrive: identify → find the manual → plan. */
export default function Pipeline({ scan }: { scan: ScanView }) {
  const p = scan.progress!
  const order = ['identifying', 'researching', 'planning', 'writing', 'reviewing'] as const
  const at = order.indexOf(p.phase ?? 'identifying')
  const state = (i: number) => (i < at ? 'pl-done' : i === at ? 'pl-active' : 'pl-todo')
  const r = p.research
  const skipped = r?.status === 'skipped' || r?.status === 'not_needed'
  const manual = r?.status === 'done' && r.match !== 'none' ? 'Found the manual' : r?.status === 'done' || r?.status === 'failed' ? 'No manual, using your photos' : 'Looking for the manual'

  return (
    <ol className="pipeline" aria-live="polite">
      <li className={state(0)}>
        <strong>{p.identity?.objectName ?? 'Identifying'}</strong>
      </li>
      {!skipped && (
        <li className={state(1)}>
          <strong>{manual}</strong>
        </li>
      )}
      <li className={state(2)}>
        <strong>Planning the parts</strong>
      </li>
    </ol>
  )
}
