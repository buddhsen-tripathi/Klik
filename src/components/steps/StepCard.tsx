import { Bolt, TriangleAlert, Wrench } from 'lucide-react'
import type { Mode } from '../../explode'
import type { Analysis, Step } from '../../shared/types'
import { Chip, ChipRow } from '../ui/Chip'
import { qty } from './format'
import StepRevision from './StepRevision'

/** The current step: what to do, which parts, which screws and tools. */
export default function StepCard({ step, mode, analysis, onFocusPart }: { step: Step; mode: Mode; analysis: Analysis; onFocusPart?: (id: string) => void }) {
  const partName = (id: string) => analysis.parts.find((p) => p.id === id)?.name ?? id
  const fasteners = analysis.parts.filter((p) => p.kind === 'fastener' && step.partIds.includes(p.id))
  return (
    <section className="card step-card">
      {step.group && <p className="eyebrow">{step.group}</p>}
      <h2>{step.title}</h2>
      <StepRevision revision={step.revision} />
      <p className="instruction">{mode === 'disassemble' ? step.disassembly : step.assembly}</p>
      <p className="parts-line">
        <strong>Parts:</strong>{' '}
        {step.partIds.map((id, i) => (
          <span key={id}>
            {i > 0 && ', '}
            {onFocusPart ? (
              <button className="part-link" onClick={() => onFocusPart(id)}>
                {partName(id)}
              </button>
            ) : (
              partName(id)
            )}
          </span>
        ))}
      </p>
      <ChipRow empty={fasteners.length === 0}>
        {fasteners.map((f) => (
          <Chip key={f.id} icon={<Bolt aria-hidden />} variant="hardware" onClick={onFocusPart && (() => onFocusPart(f.id))}>
            {qty(f)}
            {f.spec ?? f.name}
          </Chip>
        ))}
      </ChipRow>
      <ChipRow empty={step.tools.length === 0}>
        {step.tools.map((t) => (
          <Chip key={t} icon={<Wrench aria-hidden />}>
            {t}
          </Chip>
        ))}
      </ChipRow>
      {step.caution && <p className="caution icon-text">
          <TriangleAlert aria-hidden /> {step.caution}
        </p>}
    </section>
  )
}
