import type { ModelFile, Part } from '../../shared/types'
import { qty } from './format'

/** Details for the part tapped in the 3D view. */
export default function SelectedPart({ part, reference }: { part: Part; reference?: ModelFile['reference'] }) {
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
