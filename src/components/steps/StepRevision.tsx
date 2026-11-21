import { History } from 'lucide-react'
import type { Step } from '../../shared/types'

/** "Updated after people had trouble here", with what they ran into. */
export default function StepRevision({ revision }: { revision: Step['revision'] }) {
  if (!revision) return null
  return (
    <details className="step-revision">
      <summary className="icon-text">
        <History aria-hidden /> Updated from feedback
      </summary>
      <ul className="list">
        {revision.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </details>
  )
}
