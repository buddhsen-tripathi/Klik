import { BookOpen, Ruler, Wrench } from 'lucide-react'
import type { Analysis } from '../../shared/types'
import { Chip, ChipRow } from '../ui/Chip'
import { BulletSection, Section } from '../ui/Section'
import { formatDims } from './format'
import HardwareTable from './HardwareTable'

/** Before step 1: what it is, how big, how hard, and what you'll need. */
export default function Overview({ analysis }: { analysis: Analysis }) {
  const ref = analysis.reference
  const fasteners = analysis.parts.filter((p) => p.kind === 'fastener')
  return (
    <section className="card overview">
      <p>{analysis.summary}</p>
      {ref && ref.match !== 'none' && (
        <p className={`doc-match ${ref.match}`}>
          <BookOpen aria-hidden /> {ref.match === 'exact' ? 'Manual:' : 'Similar model’s manual:'} <strong>{ref.product}</strong>
        </p>
      )}
      <p className="size-line">
        <Ruler aria-hidden /> <strong>{formatDims(analysis.dimensions)} cm</strong>
        {analysis.dimensionsSource === 'docs' ? '' : <span className="muted"> · estimate</span>}
      </p>
      <dl className="facts">
        <Fact label="Difficulty" value={analysis.difficulty} />
        <Fact label="Time" value={`~${analysis.estimatedMinutes} min`} />
        <Fact label="Parts" value={analysis.parts.length} />
      </dl>
      <Section title="Tools" show={analysis.tools.length > 0}>
        <ChipRow>
          {analysis.tools.map((t) => (
            <Chip key={t} icon={<Wrench aria-hidden />}>
              {t}
            </Chip>
          ))}
        </ChipRow>
      </Section>
      <Section title="Hardware" show={fasteners.length > 0}>
        <HardwareTable fasteners={fasteners} />
      </Section>
      <BulletSection title="From the documentation" items={ref?.notes ?? []} />
      <BulletSection title="Safety" items={analysis.safety} />
    </section>
  )
}

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
