import type { Analysis, Group, Handoff, Step } from '../shared/types'

/**
 * Reviewer for the parallel step writers. The writers can't see each other while they run, so
 * each one leaves handoff notes (what it assumes is already off, shared fasteners). Afterwards
 * this checks the merged plan with plain code, no AI, and says what to repair:
 *   - a writer that failed (its group fell back to one generic step)
 *   - parts missing from the plan, or used in two steps
 *   - a fastener step that names no tool
 *   - order conflicts: a group that needs another group's parts off first, but runs before it
 * Order conflicts are fixed here by reordering groups; the rest by re-running only that writer.
 */

export interface GroupResult {
  steps: Step[]
  notes: Handoff[]
  failed?: boolean
}

export interface Issue {
  groupIndex: number
  kind: 'writer_failed' | 'missing_parts' | 'duplicate_parts' | 'no_tool'
  text: string
}

const names = (a: Analysis, ids: string[]) => ids.map((id) => a.parts.find((p) => p.id === id)?.name ?? id).join(', ')

/** Problems in one group's steps (order is checked separately). */
export function checkGroup(a: Analysis, groups: Group[], i: number, r: GroupResult, all: GroupResult[]): Issue[] {
  const g = groups[i]
  if (r.failed) return [{ groupIndex: i, kind: 'writer_failed', text: `The step writer for "${g.name}" failed, so it has only a generic step.` }]
  const issues: Issue[] = []
  const used = new Map<string, number>()
  for (const s of r.steps) for (const id of s.partIds) used.set(id, (used.get(id) ?? 0) + 1)
  // The base part of the last group may stay put; everything else has to come off somewhere.
  const fastener = (id: string) => a.parts.find((p) => p.id === id)?.kind === 'fastener'
  const missing = g.partIds.filter((id) => !used.has(id))
  const allowed = i === groups.length - 1 ? 1 : 0
  const bad = missing.filter(fastener).concat(missing.filter((id) => !fastener(id)).slice(allowed))
  if (bad.length) issues.push({ groupIndex: i, kind: 'missing_parts', text: `"${g.name}" never removes: ${names(a, bad)}.` })
  // Used twice within the group, or also claimed by another group's steps.
  const elsewhere = new Set(all.flatMap((o, k) => (k === i ? [] : o.steps.flatMap((s) => s.partIds))))
  const dupes = [...used].filter(([id, n]) => n > 1 || elsewhere.has(id)).map(([id]) => id)
  if (dupes.length) issues.push({ groupIndex: i, kind: 'duplicate_parts', text: `"${g.name}" removes these more than once: ${names(a, dupes)}.` })
  const toolless = r.steps.filter((s) => s.tools.length === 0 && s.partIds.some(fastener))
  if (toolless.length) issues.push({ groupIndex: i, kind: 'no_tool', text: `"${g.name}": no tool named for ${toolless.map((s) => `"${s.title}"`).join(', ')}.` })
  return issues
}

export const checkPlan = (a: Analysis, groups: Group[], results: GroupResult[]) => results.flatMap((r, i) => checkGroup(a, groups, i, r, results))

/**
 * Group order from the handoff notes: if group B needs group A's parts off first, A goes before B.
 * Stable (keeps the planner's order where nothing says otherwise). A cycle keeps the planner's order.
 */
export function orderGroups(groups: Group[], results: GroupResult[]): { order: number[]; moves: string[]; conflicts: string[] } {
  const owner = new Map<string, number>()
  groups.forEach((g, i) => g.partIds.forEach((id) => owner.set(id, i)))
  const before = groups.map(() => new Set<number>())
  const reasons: string[] = []
  results.forEach((r, i) =>
    r.notes
      .filter((n) => n.kind === 'needs_first')
      .forEach((n) =>
        n.partIds.forEach((id) => {
          const o = owner.get(id)
          if (o == null || o === i || before[i].has(o)) return
          before[i].add(o)
          if (o > i) reasons.push(`"${groups[i].name}" needs "${groups[o].name}" off first`)
        }),
      ),
  )
  const order: number[] = []
  const placed = new Set<number>()
  while (order.length < groups.length) {
    const next = groups.findIndex((_, i) => !placed.has(i) && [...before[i]].every((d) => placed.has(d)))
    if (next === -1) return { order: groups.map((_, i) => i), moves: [], conflicts: reasons.length ? [`Order conflict the notes can't resolve: ${reasons.join('; ')}.`] : [] }
    order.push(next)
    placed.add(next)
  }
  const moved = order.some((g, k) => g !== k)
  return { order, moves: moved ? reasons.map((r) => `Reordered: ${r}.`) : [], conflicts: [] }
}

/** What a repairing writer is told: the problems, its first draft, and the other writers' notes. */
export function repairBrief(a: Analysis, groups: Group[], i: number, issues: Issue[], results: GroupResult[]): string {
  const others = results
    .map((r, k) => {
      if (k === i || r.failed) return ''
      const notes = r.notes.map((n) => `  - ${n.kind === 'needs_first' ? `needs off first: ${names(a, n.partIds)}. ` : ''}${n.text}`).join('\n')
      return `"${groups[k].name}" steps: ${r.steps.map((s) => s.title).join(' → ')}${notes ? `\n${notes}` : ''}`
    })
    .filter(Boolean)
    .join('\n')
  const draft = results[i].failed ? '' : `\nYour first draft (fix it, keep what was right):\n${results[i].steps.map((s, n) => `${n + 1}. ${s.title} [${s.partIds.join(', ')}] tools: ${s.tools.join(', ') || 'none'} - ${s.disassembly}`).join('\n')}\n`
  return `A REVIEWER checked the merged plan and found problems in your group:
${issues.map((x) => `- ${x.text}`).join('\n')}
${draft}
What the other step writers did${others ? `:\n${others}` : ': (nothing usable)'}
Fix exactly these problems. Do not remove any part another group already removes.`
}
