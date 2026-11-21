import type { PlanReview } from '../../shared/types'
import { Section } from '../ui/Section'

/** One line on the automatic check of the steps (details live in the traces). */
export default function ReviewSummary({ review }: { review?: PlanReview | null }) {
  if (!review) return null
  const fixed = review.fixed.length
  const left = review.remaining.length
  const text = left ? `${left} possible problem${left > 1 ? 's' : ''}: ${review.remaining.join(' ')}` : fixed ? `Fixed ${fixed} problem${fixed > 1 ? 's' : ''} in the steps` : 'No problems found'
  return (
    <Section title="Steps check">
      <p className="muted small">{text}</p>
    </Section>
  )
}
