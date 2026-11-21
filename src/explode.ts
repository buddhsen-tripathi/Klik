import type { Analysis, RemovalDirection, Step } from './shared/types'

export type Mode = 'disassemble' | 'assemble'

/** How a part should look at the current step. */
export interface PartState {
  /** 0 = in place, 1 = fully pulled out along its removal direction (the move the current step is about). */
  offset: number
  /** Off the object, sitting in its own spot on the parts tray: already taken off, or not fitted yet. */
  tray: boolean
  /** Part of the current step. */
  active: boolean
}

const INSTALLED: PartState = { offset: 0, tray: false, active: false }
const IN_TRAY: PartState = { offset: 0, tray: true, active: false }
/** The current step's part, lifted partway out of (or hovering just above) its place. */
const MOVING: PartState = { offset: 0.5, tray: false, active: true }

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

/** Which disassembly step takes each part off (parts no step touches stay on the object). */
export function removalOrder(analysis: Analysis): Map<string, number> {
  const removedAt = new Map<string, number>()
  analysis.steps.forEach((s, i) => s.partIds.forEach((id) => removedAt.has(id) || removedAt.set(id, i)))
  return removedAt
}

/**
 * stepIndex = -1 is the overview: assembled object when taking apart, the full kit laid out on
 * the tray when putting together. Each step moves its parts between the object and the tray.
 */
export function partStates(analysis: Analysis, mode: Mode, stepIndex: number): Map<string, PartState> {
  const n = analysis.steps.length
  const removedAt = removalOrder(analysis)
  const states = new Map<string, PartState>()
  for (const part of analysis.parts) {
    const d = removedAt.get(part.id)
    let state = INSTALLED
    if (d !== undefined) {
      if (mode === 'disassemble') {
        if (d < stepIndex) state = IN_TRAY
        else if (d === stepIndex) state = MOVING
      } else {
        // Assembly step j puts back what disassembly step (n - 1 - j) took off.
        const j = n - 1 - d
        if (stepIndex === -1 || j > stepIndex) state = IN_TRAY
        else if (j === stepIndex) state = MOVING
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
  const DONE = taking ? IN_TRAY : INSTALLED
  const TODO = taking ? INSTALLED : IN_TRAY
  const states = new Map<string, PartState>()
  for (const part of analysis.parts) states.set(part.id, INSTALLED)
  for (const s of done) for (const id of s.partIds) states.set(id, DONE)
  plan.forEach((s, j) => {
    const fix = s.group === 'Fix first'
    for (const id of s.partIds) {
      if (j < stepIndex) states.set(id, fix ? INSTALLED : DONE)
      else if (j === stepIndex) states.set(id, MOVING)
      else if (!fix && !states.get(id)?.active) states.set(id, TODO)
    }
  })
  return states
}
