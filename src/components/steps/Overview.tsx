import { BookOpen, Ruler, Wrench } from 'lucide-react'
import type { Analysis } from '../../shared/types'
import { Chip, ChipRow } from '../ui/Chip'
import { BulletSection, Section } from '../ui/Section'
import { formatDims } from './format'
import HardwareTable from './HardwareTable'
import { openShop } from '../shop/shopStore'
import { useT } from '../../i18n/useT'

/** Before step 1: what it is, how big, how hard, and what you'll need. */
export default function Overview({ analysis }: { analysis: Analysis }) {
  const t = useT()
  const ref = analysis.reference
  const fasteners = analysis.parts.filter((p) => p.kind === 'fastener')
  return (
    <section className="card overview">
      <p>{analysis.summary}</p>
      {ref && ref.match !== 'none' && (
        <p className={`doc-match ${ref.match}`}>
          <BookOpen aria-hidden /> {ref.match === 'exact' ? t('manual') : t('similarManual')} <strong>{ref.product}</strong>
        </p>
      )}
      <p className="size-line">
        <Ruler aria-hidden /> <strong>{formatDims(analysis.dimensions)} cm</strong>
        {analysis.dimensionsSource === 'docs' ? '' : <span className="muted"> · {t('estimate')}</span>}
      </p>
      <dl className="facts">
        <Fact label={t('difficulty')} value={t(analysis.difficulty)} />
        <Fact label={t('time')} value={t('minutes', { n: analysis.estimatedMinutes })} />
        <Fact label={t('parts')} value={analysis.parts.length} />
      </dl>
      <Section title={t('tools')} show={analysis.tools.length > 0}>
        <ChipRow>
          {analysis.tools.map((t) => (
            <Chip key={t} icon={<Wrench aria-hidden />} onClick={() => openShop({ title: t, query: t })}>
              {t}
            </Chip>
          ))}
        </ChipRow>
      </Section>
      <Section title={t('hardware')} show={fasteners.length > 0}>
        <HardwareTable fasteners={fasteners} />
      </Section>
      <BulletSection title={t('fromDocs')} items={ref?.notes ?? []} />
      <BulletSection title={t('safety')} items={analysis.safety} />
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
