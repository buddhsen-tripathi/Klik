import type { Mode } from '../../explode'
import type { Analysis, Step } from '../../shared/types'
import { Chip, ChipRow } from '../ui/Chip'
import { qty } from './format'

/** The current step: what to do, which parts, which screws and tools. */
export default function StepCard({ step, mode, analysis }: { step: Step; mode: Mode; analysis: Analysis }) {
  const partName = (id: string) => analysis.parts.find((p) => p.id === id)?.name ?? id
  const fasteners = analysis.parts.filter((p) => p.kind === 'fastener' && step.partIds.includes(p.id))
  return (
    <section className="card step-card">
      {step.group && <p className="eyebrow">{step.group}</p>}
      <h2>{step.title}</h2>
      <p className="instruction">{mode === 'disassemble' ? step.disassembly : step.assembly}</p>
      <p className="parts-line">
        <strong>Parts:</strong> {step.partIds.map(partName).join(', ')}
      </p>
      <ChipRow empty={fasteners.length === 0}>
        {fasteners.map((f) => (
          <Chip key={f.id} icon="🔩" variant="hardware">
            {qty(f)}
            {f.spec ?? f.name}
          </Chip>
        ))}
      </ChipRow>
      <ChipRow empty={step.tools.length === 0}>
        {step.tools.map((t) => (
          <Chip key={t} icon="🔧">
            {t}
          </Chip>
        ))}
      </ChipRow>
      {step.caution && <p className="caution">⚠️ {step.caution}</p>}
    </section>
  )
}
