import { Check, Ruler, TriangleAlert } from 'lucide-react'
import type { Analysis } from '../../shared/types'
import type { SizeCheck } from '../viewer/Viewer3D'
import './SizeCheckChip.css'

const fmt = (v: number[]) => v.map((x) => (x < 10 ? x.toFixed(1) : Math.round(x))).join(' × ')
const longestFirst = (v: number[]) => [...v].sort((a, b) => b - a)

/**
 * The scan keeps its own shape and texture; the documented (or estimated) dimensions are the
 * check. When the scan's real-world scale is trustworthy it keeps its own size; otherwise it's
 * scaled uniformly to the dimensions and only its proportions are compared. Sides are compared
 * longest-to-shortest, so it doesn't matter how the scan is turned.
 */
export default function SizeCheckChip({ check, analysis }: { check: SizeCheck; analysis: Analysis }) {
  if (!check.measured || !check.ratio) return null
  const ref = analysis.dimensionsSource === 'docs' ? 'the manual' : 'the estimate'
  const shown = check.usedScanSize ? check.measured : check.measured.map((x) => x / check.ratio!)
  const dims = longestFirst(analysis.dimensions)
  const off = Math.max(...longestFirst(shown).map((x, i) => Math.abs(x / Math.max(dims[i], 0.1) - 1)))
  const lead = check.usedScanSize ? `Scan measures ${fmt(shown)} cm` : `Sized to ${ref}: ${fmt(analysis.dimensions)} cm`
  const ok = off <= 0.25
  const text = ok
    ? `${lead} · scan ${check.usedScanSize ? 'matches' : 'proportions match'} ${ref}`
    : `${lead} · the scan’s shape differs from ${ref} by ${Math.round(off * 100)}%, double-check sizes before buying parts`
  // Short pill on screen (it sits on the 3D view); the full sentence is the tooltip / screen-reader text.
  return (
    <div className={`size-check icon-text ${ok ? 'ok' : 'warn'}`} role="note" title={text} aria-label={text}>
      <Ruler aria-hidden /> {fmt(shown)} cm{' '}
      {ok ? <Check aria-hidden /> : <><TriangleAlert aria-hidden /> {Math.round(off * 100)}% off</>}
    </div>
  )
}
