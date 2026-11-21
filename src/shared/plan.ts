import type { Recovery, Step } from './types'

/**
 * The steps the user follows after a progress check: the fixes first, then the rest of
 * the guide from where they really are. Shared by the app and the Watch endpoint so
 * step numbers mean the same thing on both sides.
 */
export function planSteps(ordered: Step[], recovery: Recovery): Step[] {
  return [...recovery.fixSteps, ...ordered.slice(recovery.resumeAt)]
}
