import type { ScanView } from '../../shared/types'
import type { Source } from '../viewer/Viewer3D'
import Segmented from '../ui/Segmented'
import { formatMB } from './labels'

/** Buttons over the 3D view: scan/blockout switch, flip, spin and hands-free watch. */
export default function ViewerToolbar(props: {
  scan: ScanView
  source: Source
  onSource: (s: Source) => void
  onFlip: () => void
  spin: boolean
  onSpin: () => void
  canWatch: boolean
  watching: boolean
  onWatch: () => void
}) {
  const { scan, source, spin, watching } = props
  const hasScan = scan.modelFiles.length > 0
  // Per-part meshes stream in while the scan is still modelling.
  const building = scan.stage === 'modeling'
  const count = `${scan.modelFiles.length}/${scan.progress?.fal?.total ?? '?'}`

  return (
    <div className="viewer-bar">
      {hasScan && source === 'scan' ? (
        <Segmented
          small
          value={source}
          onChange={props.onSource}
          options={[
            { value: 'scan', label: `3D scan${building ? ` · ${count}` : ''}` },
            { value: 'blockout', label: 'Blockout' },
          ]}
        />
      ) : hasScan ? (
        <button className="btn primary small" onClick={() => props.onSource('scan')}>
          {building ? `Load 3D scan · ${count} parts` : `Load 3D scan${scan.modelBytes ? ` · ${formatMB(scan.modelBytes)}` : ''}`}
        </button>
      ) : (
        <span className="chip">{building ? 'Blockout · 3D scan building…' : 'Blockout'}</span>
      )}
      <div className="row">
        {source === 'scan' && hasScan && (
          <button className="btn ghost small bar-btn" onClick={props.onFlip} title="Flip scan: rotate it if it came back sideways" aria-label="Flip scan">
            <span aria-hidden className="bar-icon-text">90°</span>
            <span className="bar-label">Flip scan</span>
          </button>
        )}
        <button className={`btn small bar-btn ${spin ? 'primary' : 'ghost'}`} onClick={props.onSpin} aria-pressed={spin} aria-label={spin ? 'Stop spin' : 'Spin'} title={spin ? 'Stop spin' : 'Spin'}>
          <span aria-hidden>↻</span>
          <span className="bar-label">{spin ? 'Stop spin' : 'Spin'}</span>
        </button>
        {props.canWatch && (
          <button
            className={`btn small bar-btn ${watching ? 'primary' : 'ghost'}`}
            aria-pressed={watching}
            aria-label="Watch (hands-free)"
            title="Watch: the camera checks each step and moves on when it's done"
            onClick={props.onWatch}
          >
            <span aria-hidden>📷</span>
            <span className="bar-label">Watch</span>
          </button>
        )}
      </div>
    </div>
  )
}
