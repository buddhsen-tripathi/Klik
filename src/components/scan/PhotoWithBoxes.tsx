import type { ScanView } from '../../shared/types'

/** The photo with Gemini's part boxes drawn on top: shows the AI's "reasoning" while 3D builds. */
export default function PhotoWithBoxes({ scan, compact }: { scan: ScanView; compact?: boolean }) {
  // Boxes refer to the photo Gemini picked for the 3D model.
  const photo = scan.photos[scan.modelPhotoIndex] ?? scan.photos[0]
  const parts = scan.analysis?.parts.filter((p) => p.box2d) ?? []
  if (!photo) return null
  return (
    <>
      <figure className={`photo-boxes ${compact ? 'compact' : ''}`} style={{ aspectRatio: `${photo.width} / ${photo.height}` }}>
        <img src={photo.url} alt="Your photo" />
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
        <div className="angle-strip">
          {scan.photos.map((p, i) => (
            <img key={p.url} src={p.url} alt={`Angle ${i + 1}`} loading="lazy" className={i === scan.modelPhotoIndex ? 'picked' : ''} />
          ))}
        </div>
      )}
    </>
  )
}
