import type { Identification } from '../../shared/types'

/** Box + floating "3D hover" tag over the identified item. */
export default function DetectionOverlay({
  det,
  video,
  stage,
  mirrored,
}: {
  det: Identification
  video: HTMLVideoElement | null
  stage: { w: number; h: number }
  mirrored: boolean
}) {
  if (!video?.videoWidth || !stage.w || !det.box2d) return null
  // object-fit: cover crops the video; map 0-1000 frame coords onto the visible area.
  const scale = Math.max(stage.w / video.videoWidth, stage.h / video.videoHeight)
  const dw = video.videoWidth * scale
  const dh = video.videoHeight * scale
  const ox = (stage.w - dw) / 2
  const oy = (stage.h - dh) / 2
  const [ymin, x0, ymax, x1] = det.box2d
  // Front camera preview is mirrored, so mirror the box too.
  const xmin = mirrored ? 1000 - x1 : x0
  const xmax = mirrored ? 1000 - x0 : x1
  const left = Math.max(8, ox + (xmin / 1000) * dw)
  const top = Math.max(8, oy + (ymin / 1000) * dh)
  const right = Math.min(stage.w - 8, ox + (xmax / 1000) * dw)
  const bottom = Math.min(stage.h - 8, oy + (ymax / 1000) * dh)

  return (
    <div className="detection" style={{ left, top, width: right - left, height: bottom - top }}>
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />
      <div className={`hover-tag ${top < 90 ? 'inside' : ''}`}>
        <span className="mini-cube" aria-hidden>
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </span>
        <span className="hover-text">
          <strong>{det.name}</strong>
          <small>{det.disassemblable ? 'Ready to scan in 3D' : 'Probably not built to come apart'}</small>
        </span>
      </div>
    </div>
  )
}
