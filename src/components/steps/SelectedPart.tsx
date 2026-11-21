import { ShoppingBag } from 'lucide-react'
import type { ModelFile, Part } from '../../shared/types'
import { openShop } from '../shop/shopStore'
import { qty } from './format'

/** Details for the part tapped in the 3D view. */
export default function SelectedPart({ part, objectName, reference }: { part: Part; objectName: string; reference?: ModelFile['reference'] }) {
  // Screws: search by spec (any store). Other parts only make sense for this object.
  const shop =
    part.kind === 'fastener'
      ? { label: 'Buy spares', title: `Spare ${part.spec ?? part.name}`, query: part.spec ? `${part.spec} ${part.name}` : part.name }
      : { label: 'Find a replacement', title: `Replacement ${part.name.toLowerCase()}`, query: `${objectName} ${part.name}` }
  return (
    <section className="card selected-part">
      <h3>
        {qty(part)}
        {part.name}
      </h3>
      {part.spec && <p className="spec">{part.spec}</p>}
      <p className="muted">
        {part.material}
        {part.visible ? '' : ' · hidden part (inferred, not seen in the photo)'}
      </p>
      <button className="btn ghost small icon-text" onClick={() => openShop({ title: shop.title, query: shop.query })}>
        <ShoppingBag aria-hidden /> {shop.label}
      </button>
      {reference && (
        <p className="muted small">
          3D shape from a reference photo:{' '}
          <a href={reference.pageUrl} target="_blank" rel="noreferrer">
            {new URL(reference.pageUrl).hostname.replace(/^www\./, '')}
          </a>
        </p>
      )}
    </section>
  )
}
