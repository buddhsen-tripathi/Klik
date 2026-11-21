import { History } from 'lucide-react'
import type { Step } from '../../shared/types'
import { useT } from '../../i18n/useT'

/** "Updated after people had trouble here", with what they ran into. */
export default function StepRevision({ revision }: { revision: Step['revision'] }) {
  const t = useT()
  if (!revision) return null
  return (
    <details className="step-revision">
      <summary className="icon-text">
        <History aria-hidden /> {t('updated')}
      </summary>
      <ul className="list">
        {revision.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </details>
  )
}
