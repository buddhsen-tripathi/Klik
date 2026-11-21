import { agentSearch } from '../../api'
import type { Mode } from '../../explode'
import type { Analysis, Part, Recovery, Step } from '../../shared/types'
import type { FunctionDeclaration } from './liveSession'

/** What the agent can see of the app right now. */
export interface AgentSnapshot {
  analysis: Analysis
  /** Steps in the order the user is following them (the fix plan if one is active). */
  steps: Step[]
  stepIndex: number
  mode: Mode
  /** Active fix plan from "check my progress", if any. */
  recovery: Recovery | null
  hasScan: boolean
  watching: boolean
}

/** What the agent can do in the app. */
export interface AgentActions {
  goToStep(i: number): void
  setMode(m: Mode): void
  selectPart(id: string | null): void
  setView(v: 'scan' | 'blockout'): void
  setSpin(on: boolean): void
  setWatching(on: boolean): void
  openProgressCheck(note: string | null): void
  startPlan(): void
  clearPlan(): void
  newScan(): void
  end(): void
}

const int = (description: string) => ({ type: 'INTEGER', description })
const str = (description: string) => ({ type: 'STRING', description })

export const TOOLS: FunctionDeclaration[] = [
  { name: 'go_to_step', description: 'Show a step. 1 = first step; 0 = the overview.', parameters: { type: 'OBJECT', properties: { step: int('Step number, 1-based') }, required: ['step'] } },
  { name: 'next_step', description: 'Go to the next step (user says next, done, got it, what now).' },
  { name: 'previous_step', description: 'Go back one step.' },
  { name: 'current_step', description: 'Get the full text of the step on screen (to repeat or explain it).' },
  {
    name: 'set_mode',
    description: 'Switch between taking it apart and putting it together.',
    parameters: { type: 'OBJECT', properties: { mode: { type: 'STRING', enum: ['disassemble', 'assemble'] } }, required: ['mode'] },
  },
  {
    name: 'show_part',
    description: 'Highlight a part or fastener in the 3D view and get its details (spec, count, material).',
    parameters: { type: 'OBJECT', properties: { part: str('Part name as the user said it, e.g. "the long screws"') }, required: ['part'] },
  },
  {
    name: 'set_view',
    description: 'Show the textured 3D scan or the simple block model, and optionally spin it.',
    parameters: { type: 'OBJECT', properties: { view: { type: 'STRING', enum: ['scan', 'blockout'] }, spin: { type: 'BOOLEAN' } } },
  },
  {
    name: 'hands_free',
    description: 'Turn hands-free mode on/off: the camera watches and moves to the next step when the current one is done.',
    parameters: { type: 'OBJECT', properties: { on: { type: 'BOOLEAN' } }, required: ['on'] },
  },
  {
    name: 'check_progress',
    description:
      'When the user is unsure, thinks they made a mistake, has leftover parts, or wants to restart from where they are: open the camera so they can photograph their build. The result (what is done, mistakes, fix steps) arrives later as an [App] message.',
    parameters: { type: 'OBJECT', properties: { note: str('What the user said went wrong, in their words') } },
  },
  {
    name: 'fix_plan',
    description: 'After a progress check: start following the fix plan, or cancel it and go back to the full guide.',
    parameters: { type: 'OBJECT', properties: { action: { type: 'STRING', enum: ['start', 'cancel'] } }, required: ['action'] },
  },
  {
    name: 'search_web',
    description: 'Look something up online (manuals, screw sizes, where to buy a spare part, how a mechanism works) when the guide does not say.',
    parameters: { type: 'OBJECT', properties: { question: str('A full, specific question including the product name') }, required: ['question'] },
  },
  { name: 'new_scan', description: 'Start scanning a different object (leaves this guide).' },
  { name: 'end_conversation', description: 'The user is done talking (bye, thanks that is all, stop listening).' },
]

const qty = (p: Part) => ((p.quantity ?? 1) > 1 ? `${p.quantity}x ` : '')
const partLine = (p: Part) => `${qty(p)}${p.name}${p.spec ? ` [${p.spec}]` : ''}${p.kind === 'fastener' ? ' (fastener)' : ''}`

function stepText(s: AgentSnapshot, i: number): string {
  const step = s.steps[i]
  if (!step) return i < 0 ? 'Overview (no step selected).' : 'No such step.'
  const names = step.partIds.map((id) => s.analysis.parts.find((p) => p.id === id)).filter(Boolean) as Part[]
  const fix = step.group === 'Fix first' ? ' [FIX]' : ''
  return `Step ${i + 1} of ${s.steps.length}${fix}: ${step.title}. ${s.mode === 'disassemble' ? step.disassembly : step.assembly}${
    names.length ? ` Parts: ${names.map(partLine).join(', ')}.` : ''
  }${step.tools.length ? ` Tools: ${step.tools.join(', ')}.` : ''}${step.caution ? ` Caution: ${step.caution}` : ''}`
}

/** Short state line sent whenever the user changes something on screen. */
export function describeState(s: AgentSnapshot): string {
  const plan = s.recovery ? ` Following a fix plan (${s.recovery.fixSteps.length} fixes, then the guide from its step ${s.recovery.resumeAt + 1}).` : ''
  return `[App] Mode: ${s.mode === 'disassemble' ? 'taking apart' : 'putting together'}. Now showing: ${stepText(s, s.stepIndex)}${plan}${s.watching ? ' Hands-free camera is on.' : ''}`
}

/** The agent's briefing: the whole guide plus how to behave. */
export function buildInstructions(s: AgentSnapshot): string {
  const a = s.analysis
  const ref = a.reference
  return `You are the voice helper inside "Assemble on the Go", an app that guides people through taking apart and putting together real objects. The user's hands are busy, so you drive the app with tools.

How to talk:
- Short and natural: one or two sentences, like a friend at the workbench. No lists, no markdown.
- Number steps from 1. Name the exact screw or part and the tool.
- When the user says next / done / got it, call next_step and then say the new step briefly.
- If they sound unsure, say something went wrong, have a leftover part, or want to "start from where I am", call check_progress (pass their words as note) and tell them to take a photo. When the [App] result arrives, explain it in a sentence and offer to start the fix plan (fix_plan start).
- Safety first: mention cautions on the step.
- Only state sizes that are in the guide; otherwise say you're not sure or use search_web.
- Messages starting with [App] are app events, not the user speaking.

THE OBJECT: ${a.objectName}. ${a.summary}
Size: ${a.dimensions.join(' x ')} cm (${a.dimensionsSource === 'docs' ? 'from the manufacturer' : 'estimated'}). Difficulty: ${a.difficulty}, about ${a.estimatedMinutes} min.
Tools: ${a.tools.join(', ') || 'none listed'}.
Safety: ${a.safety.join(' ') || 'nothing special'}.
${ref && ref.match !== 'none' ? `Documentation (${ref.match} match: ${ref.product}): ${ref.notes.join(' ')}\n` : ''}
PARTS
${a.parts.map((p) => `- ${partLine(p)}`).join('\n')}

STEPS (${s.mode === 'disassemble' ? 'taking apart' : 'putting together'})
${s.steps.map((_, i) => `- ${stepText(s, i)}`).join('\n')}

${describeState(s)}`
}

/** Best match for a spoken part name ("the long screws", "wheel"). */
function findPart(parts: Part[], query: string): Part | null {
  const words = query.toLowerCase().match(/[a-z0-9]+/g) ?? []
  let best: Part | null = null
  let bestScore = 0
  for (const p of parts) {
    const hay = `${p.name} ${p.id.replace(/_/g, ' ')} ${p.spec ?? ''} ${p.kind ?? ''}`.toLowerCase()
    const score = words.reduce((n, w) => n + (w.length > 2 && hay.includes(w.replace(/s$/, '')) ? 1 : 0), 0)
    if (score > bestScore) {
      best = p
      bestScore = score
    }
  }
  return best
}

/** Run one tool call against the app. Returns what the agent hears back. */
export async function runTool(name: string, args: Record<string, unknown>, s: AgentSnapshot, act: AgentActions): Promise<object> {
  const clamp = (i: number) => Math.max(-1, Math.min(s.steps.length - 1, i))
  const show = (i: number) => {
    const j = clamp(i)
    act.goToStep(j)
    return { ok: true, now: stepText(s, j) }
  }
  switch (name) {
    case 'go_to_step':
      return show(Number(args.step) - 1)
    case 'next_step':
      return s.stepIndex >= s.steps.length - 1 ? { ok: false, now: 'That was the last step. They are finished!' } : show(s.stepIndex + 1)
    case 'previous_step':
      return show(s.stepIndex - 1)
    case 'current_step':
      return { now: stepText(s, s.stepIndex) }
    case 'set_mode': {
      const mode = args.mode === 'assemble' ? 'assemble' : 'disassemble'
      act.setMode(mode)
      return { ok: true, mode, note: 'Showing the overview of this mode. Steps are re-numbered.' }
    }
    case 'show_part': {
      const p = findPart(s.analysis.parts, String(args.part ?? ''))
      if (!p) return { ok: false, error: 'No part by that name', parts: s.analysis.parts.map((x) => x.name) }
      act.selectPart(p.id)
      const inSteps = s.steps.map((st, i) => (st.partIds.includes(p.id) ? i + 1 : 0)).filter(Boolean)
      return { ok: true, part: partLine(p), material: p.material, visibleInPhoto: p.visible, stepsUsingIt: inSteps }
    }
    case 'set_view':
      if (args.view === 'scan' && !s.hasScan) return { ok: false, error: 'The 3D scan is not ready yet; the block model is showing.' }
      if (args.view === 'scan' || args.view === 'blockout') act.setView(args.view)
      if (typeof args.spin === 'boolean') act.setSpin(args.spin)
      return { ok: true }
    case 'hands_free':
      act.setWatching(Boolean(args.on))
      return { ok: true, note: args.on ? 'Camera opens; the user may need to tap Allow camera.' : 'Camera off.' }
    case 'check_progress':
      act.openProgressCheck(typeof args.note === 'string' && args.note.trim() ? args.note : null)
      return { ok: true, note: 'Camera sheet is open. Ask them to take a photo of the whole build. The result will arrive as an [App] message.' }
    case 'fix_plan':
      if (!s.recovery) return { ok: false, error: 'No progress check yet. Use check_progress first.' }
      if (args.action === 'cancel') {
        act.clearPlan()
        return { ok: true, note: 'Back to the full guide, at the overview.' }
      }
      act.startPlan()
      return { ok: true, now: `Plan started. First: ${s.recovery.fixSteps[0]?.title ?? `guide step ${s.recovery.resumeAt + 1}`}` }
    case 'search_web': {
      const r = await agentSearch(String(args.question ?? ''))
      return { answer: r.answer.slice(0, 1500), sources: r.sources.map((x) => x.title) }
    }
    case 'new_scan':
      act.newScan()
      return { ok: true }
    case 'end_conversation':
      setTimeout(act.end, 2500) // let it say goodbye first
      return { ok: true }
    default:
      return { ok: false, error: `unknown tool ${name}` }
  }
}

/** Words to bias dictation towards (part names, specs, tool names). */
export function vocabulary(a: Analysis): string[] {
  const words = new Set<string>()
  for (const p of a.parts) {
    words.add(p.name)
    if (p.spec) words.add(p.spec)
  }
  for (const t of a.tools) words.add(t)
  if (a.reference?.product) words.add(a.reference.product)
  return [...words].slice(0, 100)
}
