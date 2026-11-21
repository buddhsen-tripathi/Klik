import { Bolt, TriangleAlert, Wrench } from 'lucide-react'
import type { Mode } from '../../explode'
import type { Analysis, Step } from '../../shared/types'
import { Chip, ChipRow } from '../ui/Chip'
import { markerIds, splitTokens } from '../../shared/parts'
import { qty } from './format'
import Marker from './Marker'
import { openShop } from '../shop/shopStore'
import StepRevision from './StepRevision'

/** The current step: what to do, which parts, which screws and tools. */
export default function StepCard({ step, mode, analysis, onFocusPart }: { step: Step; mode: Mode; analysis: Analysis; onFocusPart?: (id: string) => void }) {
  const partName = (id: string) => analysis.parts.find((p) => p.id === id)?.name ?? id.replace(/_/g, ' ')
  const text = mode === 'disassemble' ? step.disassembly : step.assembly
  // Numbers match the pins on the 3D model (see Workbench / PartMarkers).
  const numbers = markerIds(text, step.partIds, (id) => analysis.parts.some((p) => p.id === id))
  const marker = (id: string) => <Marker n={numbers.indexOf(id) + 1} name={partName(id)} onClick={onFocusPart && (() => onFocusPart(id))} />
  const withMarkers = (t: string) =>
    splitTokens(t).map((x, i) => (typeof x === 'string' ? x : numbers.includes(x.id) ? <span key={i}>{marker(x.id)}</span> : partName(x.id)))
  const details = (mode === 'disassemble' ? step.details?.disassembly : step.details?.assembly) ?? []
  const fasteners = analysis.parts.filter((p) => p.kind === 'fastener' && step.partIds.includes(p.id))
  return (
    <section className="card step-card">
      {step.group && <p className="eyebrow">{step.group}</p>}
      <h2>{step.title}</h2>
      <StepRevision revision={step.revision} />
      <p className="instruction">{withMarkers(text)}</p>
      {details.length > 0 && (
        <ul className="step-details">
          {details.map((d) => (
            <li key={d}>{withMarkers(d)}</li>
          ))}
        </ul>
      )}
      <ul className="marker-key" aria-label="Parts">
        {numbers.map((id) => (
          <li key={id}>
            {marker(id)}
            {onFocusPart ? (
              <button className="part-link" onClick={() => onFocusPart(id)}>
                {partName(id)}
              </button>
            ) : (
              partName(id)
            )}
          </li>
        ))}
      </ul>
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
          <Chip key={t} icon={<Wrench aria-hidden />} onClick={() => openShop({ title: t, query: t })}>
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
