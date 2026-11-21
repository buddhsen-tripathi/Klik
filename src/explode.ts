import type { Analysis, RemovalDirection, Step } from './shared/types'

export type Mode = 'disassemble' | 'assemble'

/** How a part should look at the current step. */
export interface PartState {
  /** 0 = in place, 1 = fully pulled out along its removal direction. */
  offset: number
  /** Faded out because it's already off (disassembly) or not on yet (assembly). */
  faded: boolean
  /** Part of the current step. */
  active: boolean
}

export const DIRECTION_VECTORS: Record<RemovalDirection, [number, number, number]> = {
  up: [0, 1, 0],
  down: [0, -1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  front: [0, 0, 1],
  back: [0, 0, -1],
}

/** Steps in the order the user follows them in this mode. */
export function orderedSteps(analysis: Analysis, mode: Mode) {
  return mode === 'disassemble' ? analysis.steps : [...analysis.steps].reverse()
}

/**
 * stepIndex = -1 is the overview: assembled object when taking apart,
 * the full kit of loose parts when putting together.
 */
export function partStates(analysis: Analysis, mode: Mode, stepIndex: number): Map<string, PartState> {
  const n = analysis.steps.length
  // Which disassembly step removes each part.
  const removedAt = new Map<string, number>()
  analysis.steps.forEach((s, i) => s.partIds.forEach((id) => removedAt.has(id) || removedAt.set(id, i)))

  const states = new Map<string, PartState>()
  for (const part of analysis.parts) {
    const d = removedAt.get(part.id)
    let state: PartState = { offset: 0, faded: false, active: false }

    if (d !== undefined) {
      if (mode === 'disassemble') {
        if (d < stepIndex) state = { offset: 1, faded: true, active: false }
        else if (d === stepIndex) state = { offset: 0.6, faded: false, active: true }
      } else {
        // Assembly step j puts back what disassembly step (n - 1 - j) took off.
        const j = n - 1 - d
        if (stepIndex === -1) state = { offset: 1, faded: false, active: false }
        else if (j > stepIndex) state = { offset: 1, faded: true, active: false }
        else if (j === stepIndex) state = { offset: 0.6, faded: false, active: true }
      }
    }
    states.set(part.id, state)
  }
  return states
}

/** How far (cm) a part travels when fully exploded: clears the object plus a margin. */
export function explodeDistance(analysis: Analysis, partSize: [number, number, number]) {
  const objectMax = Math.max(...analysis.dimensions)
  const partMax = Math.max(...partSize)
  return objectMax * 0.55 + partMax * 0.5
}

/**
 * 3D states while following a fix plan (after "check my progress"): parts from steps already
 * done are shown done (removed, or in place when assembling), the current plan step is
 * highlighted, and later guide steps are still to do. Fix steps don't hide parts that are
 * physically there (just wrongly placed).
 */
export function planStates(analysis: Analysis, mode: Mode, done: Step[], plan: Step[], stepIndex: number): Map<string, PartState> {
  const taking = mode === 'disassemble'
  const DONE: PartState = taking ? { offset: 1, faded: true, active: false } : { offset: 0, faded: false, active: false }
  const TODO: PartState = taking ? { offset: 0, faded: false, active: false } : { offset: 1, faded: true, active: false }
  const states = new Map<string, PartState>()
  for (const part of analysis.parts) states.set(part.id, { offset: 0, faded: false, active: false })
  for (const s of done) for (const id of s.partIds) states.set(id, DONE)
  plan.forEach((s, j) => {
    const fix = s.group === 'Fix first'
    for (const id of s.partIds) {
      if (j < stepIndex) states.set(id, fix ? { offset: 0, faded: false, active: false } : DONE)
      else if (j === stepIndex) states.set(id, { offset: 0.6, faded: false, active: true })
      else if (!fix && !states.get(id)?.active) states.set(id, TODO)
    }
  })
  return states
}
