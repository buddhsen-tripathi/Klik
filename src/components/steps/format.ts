import type { Part } from '../../shared/types'

/** "4× " for counted parts, "" for single ones. */
export const qty = (p: Part) => ((p.quantity ?? 1) > 1 ? `${p.quantity}× ` : '')

export const formatDims = (d: number[]) => d.map((n) => +n.toFixed(1)).join(' × ')
