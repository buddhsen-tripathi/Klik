import type { ScanView } from '../../shared/types'
import { MATCH_LABEL } from './labels'

/** What's happening right now, over the 3D view: Gemini's thinking, then fal's progress. */
export default function LiveStatus({ scan }: { scan: ScanView }) {
  const p = scan.progress
  const parts = scan.analysis?.parts.length ?? 0
  let title: string
  let detail: string | null = null
  let extra: string | null = null
  if (scan.stage === 'analyzing') {
    const agents = p?.agents ?? []
    if (agents.length) {
      const done = agents.filter((a) => a.status !== 'running').length
      title = agents.length > 1 ? `${agents.length} agents writing steps (${done}/${agents.length})` : 'Writing the steps…'
      detail =
        agents.length > 1
          ? agents.map((a) => `${a.name} ${a.status === 'done' ? '✓' : a.status === 'failed' ? '✕' : '…'}`).join(' · ')
          : `${parts} parts`
    } else {
      title = p?.thought ?? (parts ? 'Building the block model…' : 'Looking at your photos…')
      detail = parts ? `${parts} part${parts > 1 ? 's' : ''} found${p?.partsFinal ? ' · splitting into subassemblies' : ''}` : null
    }
    const r = p?.research
    if (r?.status === 'done') extra = `📘 ${MATCH_LABEL[r.match ?? 'none']} · ${r.sources.length} source${r.sources.length === 1 ? '' : 's'}`
    else if (r?.status === 'failed') extra = '📘 No documentation found, working from the photos'
  } else {
    const fal = p?.fal
    if (fal?.status === 'IN_QUEUE') title = `3D scan queued${fal.queuePosition != null ? ` (#${fal.queuePosition + 1})` : ''}`
    else if (fal?.status === 'IN_PROGRESS')
      title = fal.total && fal.total > 1 ? `Sculpting ${fal.total} parts in parallel (${fal.done ?? 0}/${fal.total})` : 'Sculpting the 3D scan…'
    else title = 'Starting the 3D scan…'
    detail = fal?.done ? 'Finished parts are ready: tap Load 3D scan.' : (fal?.log ?? 'The block model is ready to use meanwhile.')
  }
  return (
    <div className="live-status" role="status">
      <span className="spinner small" aria-hidden />
      <div>
        <strong>{title}</strong>
        {detail && <small>{detail}</small>}
        {extra && <small>{extra}</small>}
      </div>
      <div className="viewer-progress" />
    </div>
  )
}
