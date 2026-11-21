import { Box } from 'lucide-react'
import { useState } from 'react'
import type { ScanView } from '../../shared/types'

/** Your photos, with the AI's part boxes on the one used for the 3D model. Tap a thumbnail to switch. */
export default function PhotoWithBoxes({ scan, compact }: { scan: ScanView; compact?: boolean }) {
  const [shown, setShown] = useState<number | null>(null)
  const modelIndex = scan.photos[scan.modelPhotoIndex] ? scan.modelPhotoIndex : 0
  const index = shown ?? modelIndex
  const photo = scan.photos[index]
  // Boxes refer to the model photo only.
  const parts = index === modelIndex ? (scan.analysis?.parts.filter((p) => p.box2d) ?? []) : []
  if (!photo) return null
  return (
    <>
      <figure className={`photo-boxes ${compact ? 'compact' : ''}`} style={{ aspectRatio: `${photo.width} / ${photo.height}` }}>
        <img src={photo.url} alt={`Photo ${index + 1}`} />
        {parts.map((p) => {
          const [ymin, xmin, ymax, xmax] = p.box2d!
          return (
            <div
              key={p.id}
              className="box"
              style={{ top: `${ymin / 10}%`, left: `${xmin / 10}%`, height: `${(ymax - ymin) / 10}%`, width: `${(xmax - xmin) / 10}%` }}
            >
              <span>{p.name}</span>
            </div>
          )
        })}
      </figure>
      {scan.photos.length > 1 && (
        <div className="angle-strip" role="tablist" aria-label="Photos">
          {scan.photos.map((p, i) => (
            <button
              key={p.url}
              role="tab"
              aria-selected={i === index}
              className={i === index ? 'on' : ''}
              onClick={() => setShown(i)}
              title={i === modelIndex ? 'Used for the 3D model' : `Photo ${i + 1}`}
            >
              <img src={p.url} alt={`Photo ${i + 1}`} loading="lazy" />
              {i === modelIndex && <Box className="angle-badge" aria-label="Used for the 3D model" />}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
