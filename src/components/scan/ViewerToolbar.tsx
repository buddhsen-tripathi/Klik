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
          <button className="btn ghost small" onClick={props.onFlip} title="Rotate the scan if it came back sideways">
            Flip scan
          </button>
        )}
        <button className={`btn small ${spin ? 'primary' : 'ghost'}`} onClick={props.onSpin} aria-pressed={spin}>
          {spin ? 'Stop spin' : 'Spin'}
        </button>
        {props.canWatch && (
          <button
            className={`btn small ${watching ? 'primary' : 'ghost'}`}
            aria-pressed={watching}
            title="Hands-free: the camera checks each step and moves on when it's done"
            onClick={props.onWatch}
          >
            📷 Watch
          </button>
        )}
      </div>
    </div>
  )
}
