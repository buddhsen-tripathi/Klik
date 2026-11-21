import type { ReactNode } from 'react'
import type { Analysis } from '../../shared/types'
import { BulletSection, Section } from '../ui/Section'
import ReviewSummary from './ReviewSummary'

/** "What the AI saw": your photos with the part boxes, its guesses and the sources. */
export default function AiDetails({ analysis, photo }: { analysis: Analysis; photo: ReactNode }) {
  const sources = analysis.sources ?? []
  return (
    <>
      {photo}
      <BulletSection title="Guesses to double-check" items={analysis.assumptions} />
      <Section title="Manuals and guides used" show={sources.length > 0}>
        <ul className="list sources">
          {sources.map((src) => (
            <li key={src.url}>
              <a href={src.url} target="_blank" rel="noreferrer noopener">
                {src.title}
              </a>
            </li>
          ))}
        </ul>
      </Section>
      <ReviewSummary review={analysis.review} />
    </>
  )
}
