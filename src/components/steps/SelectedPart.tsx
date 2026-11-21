import type { Part } from '../../shared/types'
import { qty } from './format'

/** Details for the part tapped in the 3D view. */
export default function SelectedPart({ part }: { part: Part }) {
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
    </section>
  )
}
