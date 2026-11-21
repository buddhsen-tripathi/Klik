import type { ReactNode } from 'react'
import type { Analysis, Timing } from '../../shared/types'
import { BulletSection, Section } from '../ui/Section'
import Waterfall from './Waterfall'

/** "What the AI saw": the photo with boxes, its guesses, sources and where the time went. */
export default function AiDetails({ analysis, photo, timings }: { analysis: Analysis; photo: ReactNode; timings: Timing[] }) {
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
      <Section title="Where the time went" show={timings.length > 0}>
        <Waterfall timings={timings} />
      </Section>
    </>
  )
}
