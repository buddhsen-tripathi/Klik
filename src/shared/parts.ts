import type { Analysis, Part } from './types'

/** "4x " for repeated parts, nothing for one. (Prompt text; the UI uses × in steps/format.ts.) */
export const qty = (p: Part) => ((p.quantity ?? 1) > 1 ? `${p.quantity}x ` : '')

/** "4x M3 screw [M3 x 6 mm]": a part as the models are told about it. */
export const partLabel = (p: Part) => `${qty(p)}${p.name}${p.spec ? ` [${p.spec}]` : ''}`

/** Steps in the order the user follows them: assembly is the disassembly list reversed. */
export function orderedSteps(analysis: Analysis, mode: 'disassemble' | 'assemble') {
  return mode === 'disassemble' ? analysis.steps : [...analysis.steps].reverse()
}

/*
 * Numbered markers. Step text mentions parts as {part_id} tokens ("Align {body} with {chassis}").
 * The app numbers them per step (1, 2, 3 in reading order, then any other parts of the step) and
 * shows the same numbers as badges in the text and as pins on the 3D model.
 */
const TOKEN = /\{([A-Za-z0-9_-]+)\}/g

/** Part ids to number for this step text: mentioned ones in reading order, then the step's other parts. */
export function markerIds(text: string, partIds: string[], known: (id: string) => boolean): string[] {
  const ids: string[] = []
  for (const m of text.matchAll(TOKEN)) if (known(m[1]) && !ids.includes(m[1])) ids.push(m[1])
  for (const id of partIds) if (known(id) && !ids.includes(id)) ids.push(id)
  return ids
}

/** Text split into plain strings and part tokens, for rendering badges. */
export function splitTokens(text: string): (string | { id: string })[] {
  const out: (string | { id: string })[] = []
  let at = 0
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > at) out.push(text.slice(at, m.index))
    out.push({ id: m[1] })
    at = m.index + m[0].length
  }
  if (at < text.length) out.push(text.slice(at))
  return out
}

/** Tokens replaced by part names (for speech and for models that don't know the ids), optionally "name (2)". */
export function plainStepText(text: string, parts: Part[], numbers?: string[]): string {
  return text.replace(TOKEN, (_, id: string) => {
    const name = parts.find((p) => p.id === id)?.name ?? id.replace(/_/g, ' ')
    const n = numbers?.indexOf(id) ?? -1
    return n >= 0 ? `${name} (${n + 1})` : name
  })
}
