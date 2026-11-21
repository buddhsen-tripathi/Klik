import { CircleCheck, TriangleAlert, Wrench } from 'lucide-react'
import type { PlanReview } from '../../shared/types'
import { Section } from '../ui/Section'

/** What the plan reviewer checked and fixed after the parallel step writers. */
export default function ReviewSummary({ review }: { review?: PlanReview | null }) {
  if (!review) return null
  const clean = review.fixed.length === 0 && review.remaining.length === 0
  return (
    <Section title="Plan reviewer">
      <ul className="list review-list">
        {clean && (
          <li className="icon-text">
            <CircleCheck aria-hidden /> Checked {review.checked} steps: no missing parts, duplicates or order conflicts.
          </li>
        )}
        {review.fixed.map((f) => (
          <li key={f} className="icon-text">
            <Wrench aria-hidden /> {f}
          </li>
        ))}
        {review.remaining.map((f) => (
          <li key={f} className="icon-text">
            <TriangleAlert aria-hidden /> {f}
          </li>
        ))}
      </ul>
      {review.notes.length > 0 && (
        <details className="review-notes">
          <summary>Handoff notes between the step writers ({review.notes.length})</summary>
          <ul className="list">
            {review.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  )
}
