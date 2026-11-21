import type { Analysis, Part } from './types'

/** "4x " for repeated parts, nothing for one. (Prompt text; the UI uses × in steps/format.ts.) */
export const qty = (p: Part) => ((p.quantity ?? 1) > 1 ? `${p.quantity}x ` : '')

/** "4x M3 screw [M3 x 6 mm]": a part as the models are told about it. */
export const partLabel = (p: Part) => `${qty(p)}${p.name}${p.spec ? ` [${p.spec}]` : ''}`

/** Steps in the order the user follows them: assembly is the disassembly list reversed. */
export function orderedSteps(analysis: Analysis, mode: 'disassemble' | 'assemble') {
  return mode === 'disassemble' ? analysis.steps : [...analysis.steps].reverse()
}
