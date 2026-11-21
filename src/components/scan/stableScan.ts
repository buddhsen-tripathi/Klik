import type { Analysis, ScanView } from '../../shared/types'

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

/**
 * Polling returns a fresh object every time. The 3D scene is keyed on object identity (parts,
 * dimensions, model files), so reuse the previous objects wherever nothing changed: otherwise each
 * poll would re-clone and re-split every scanned mesh.
 */
export function stableScan(prev: ScanView | null, next: ScanView): ScanView {
  if (!prev || prev.id !== next.id) return next
  let analysis: Analysis | null = next.analysis
  if (prev.analysis && analysis) {
    if (same(prev.analysis, analysis)) analysis = prev.analysis
    else
      analysis = {
        ...analysis,
        parts: same(prev.analysis.parts, analysis.parts) ? prev.analysis.parts : analysis.parts,
        dimensions: same(prev.analysis.dimensions, analysis.dimensions) ? prev.analysis.dimensions : analysis.dimensions,
      }
  }
  return {
    ...next,
    analysis,
    photos: same(prev.photos, next.photos) ? prev.photos : next.photos,
    modelFiles: same(prev.modelFiles, next.modelFiles) ? prev.modelFiles : next.modelFiles,
    recovery: same(prev.recovery, next.recovery) ? prev.recovery : next.recovery,
    progress: same(prev.progress, next.progress) ? prev.progress : next.progress,
  }
}
