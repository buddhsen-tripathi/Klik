import { agentSearch, reportStepProblem, searchShop } from '../../api'
import type { Mode } from '../../explode'
import type { Analysis, Part, Recovery, Step } from '../../shared/types'
import type { FunctionDeclaration } from './liveSession'
import { markerIds, partLabel, plainStepText } from '../../shared/parts'
import { money } from '../shop/money'
import { openShop } from '../shop/shopStore'

/** What the agent can see of the app right now. */
export interface AgentSnapshot {
  scanId: string
  analysis: Analysis
  /** Steps in the order the user is following them (the fix plan if one is active). */
  steps: Step[]
  stepIndex: number
  mode: Mode
  /** Active fix plan from "check my progress", if any. */
  recovery: Recovery | null
  hasScan: boolean
  /** Live coach: the camera is on and its frames stream to the agent. */
  coach: boolean
}

/** What the agent can do in the app. */
export interface AgentActions {
  goToStep(i: number): void
  setMode(m: Mode): void
  selectPart(id: string | null): void
  setView(v: 'scan' | 'blockout'): void
  setSpin(on: boolean): void
  setCoach(on: boolean): void
  openProgressCheck(note: string | null): void
  /** Live coach: re-plan from the current camera frame (null if there's no frame yet). */
  replanFromCamera(note: string | null): Promise<Recovery | null>
  startPlan(): void
  clearPlan(): void
  newScan(): void
  /** A guide step (index into analysis.steps) was rewritten from feedback: show the new one. */
  reviseStep(index: number, step: Step): void
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
    name: 'live_coach',
    description:
      'Turn live coach on/off: the camera opens, you see what they are doing, and the app moves to the next step when the camera sees the current one done.',
    parameters: { type: 'OBJECT', properties: { on: { type: 'BOOLEAN' } }, required: ['on'] },
  },
  {
    name: 'check_progress',
    description:
      'When the user is unsure, thinks they made a mistake, has leftover parts, or wants to restart from where they are: re-plan from what the camera sees. With live coach on it uses the camera right away and returns what is done, the mistakes and fix steps; otherwise it opens a photo sheet and the result arrives later as an [App] message.',
    parameters: { type: 'OBJECT', properties: { note: str('What the user said went wrong, in their words') } },
  },
  {
    name: 'fix_plan',
    description: 'After a progress check: start following the fix plan, or cancel it and go back to the full guide.',
    parameters: { type: 'OBJECT', properties: { action: { type: 'STRING', enum: ['start', 'cancel'] } }, required: ['action'] },
  },
  {
    name: 'find_products',
    description:
      'Show products to buy on screen (from Shop): a tool they lack, spare screws, or a replacement for a broken or lost part. The list appears on screen; mention the top one or two in a few words.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: str('Specific search words, e.g. "Phillips #1 precision screwdriver", "M2 x 6 mm Phillips pan head screws", or the object plus the part ("Porsche 356 diecast front bumper")'),
        title: str('Short heading for the list, e.g. "Replacement front bumper"'),
      },
      required: ['query'],
    },
  },
  {
    name: 'search_web',
    description: 'Look something up online (manuals, screw sizes, how a mechanism works) when the guide does not say.',
    parameters: { type: 'OBJECT', properties: { question: str('A full, specific question including the product name') }, required: ['question'] },
  },
  {
    name: 'report_step_problem',
    description:
      'Save a problem with a guide step so the step gets rewritten for everyone. Call it when (a) the user says a step is wrong, missing something or confusing (user_says_wrong true), or (b) you just warned them about a mistake on a step (live coach). Not for ordinary questions. The rewritten step may come back later; then read them the new instruction.',
    behavior: 'NON_BLOCKING',
    parameters: {
      type: 'OBJECT',
      properties: {
        step: { type: 'INTEGER', description: 'Number (1-based) of the step the problem is ABOUT: find it in STEPS by the part or action they mention, which may not be the step on screen. Omit only if it is the current step.' },
        problem: str('What went wrong or what is unclear, concretely (which part, which screw, what they did).'),
        user_says_wrong: { type: 'BOOLEAN', description: 'true if the user themselves said the instructions are wrong or unclear.' },
      },
      required: ['problem'],
    },
  },
  { name: 'new_scan', description: 'Start scanning a different object (leaves this guide).' },
  {
    name: 'stay_quiet',
    description: 'Live coach check found nothing worth saying: call this instead of speaking.',
    behavior: 'NON_BLOCKING',
  },
  { name: 'end_conversation', description: 'The user is done talking (bye, thanks that is all, stop listening).' },
]

const partLine = (p: Part) => `${partLabel(p)}${p.kind === 'fastener' ? ' (fastener)' : ''}`

function stepText(s: AgentSnapshot, i: number): string {
  const step = s.steps[i]
  if (!step) return i < 0 ? 'Overview (no step selected).' : 'No such step.'
  const names = step.partIds.map((id) => s.analysis.parts.find((p) => p.id === id)).filter(Boolean) as Part[]
  const fix = step.group === 'Fix first' ? ' [FIX]' : ''
  // Parts show as numbered markers on screen: "the body (1)" lets the agent say "part 1".
  const text = s.mode === 'disassemble' ? step.disassembly : step.assembly
  const numbers = markerIds(text, step.partIds, (id) => s.analysis.parts.some((p) => p.id === id))
  return `Step ${i + 1} of ${s.steps.length}${fix}: ${step.title}. ${plainStepText(text, s.analysis.parts, numbers)}${
    names.length ? ` Parts: ${names.map(partLine).join(', ')}.` : ''
  }${step.tools.length ? ` Tools: ${step.tools.join(', ')}.` : ''}${step.caution ? ` Caution: ${step.caution}` : ''}`
}

/** Short state line sent whenever the user changes something on screen. */
export function describeState(s: AgentSnapshot): string {
  const plan = s.recovery ? ` Following a fix plan (${s.recovery.fixSteps.length} fixes, then the guide from its step ${s.recovery.resumeAt + 1}).` : ''
  return `[App] Mode: ${s.mode === 'disassemble' ? 'taking apart' : 'putting together'}. Now showing: ${stepText(s, s.stepIndex)}${plan}${s.coach ? ' Live coach is ON: you can see their camera.' : ' Camera is off.'}`
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
- If the user says a step is wrong, confusing or missing something, call report_step_problem (user_says_wrong true), tell them you're fixing it, and when the new step comes back read it to them in a sentence.

LIVE COACH (when the camera is on you get video frames of their hands and the object):
- Watch what they actually do and coach in real time, like an expert standing next to them.
- Warn straight away, in one short sentence with the fix, if you see: the wrong screw/part/tool, forcing or prying something that should come free, wrong order or orientation, a part about to be lost or dropped, or anything unsafe (blades, springs, batteries, power still connected).
- The app moves to the next step by itself when the camera sees the step done; an [App] message tells you, then say the next step in a sentence.
- "[App] Coach check" messages are periodic: if nothing needs saying, call stay_quiet and say nothing. Never say "looks good" just to fill silence.
- Only describe what is in the frames you actually received. If you have no frames yet, or the object is out of frame or blurry, say you can't see it yet and ask them to point the camera at it. Never guess what they are holding.
- If they made a mistake that needs re-planning, call check_progress with what you saw as the note.
- After you warn about a mistake, also call report_step_problem with what went wrong, so the step gets clearer for the next person.

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
    case 'live_coach':
      act.setCoach(Boolean(args.on))
      return { ok: true, note: args.on ? 'Camera opens; the user may need to tap Allow camera.' : 'Camera off.' }
    case 'check_progress': {
      const note = typeof args.note === 'string' && args.note.trim() ? args.note : null
      if (s.coach) {
        const r = await act.replanFromCamera(note)
        if (r)
          return {
            ok: true,
            summary: r.summary,
            mistakes: r.mistakes.map((m) => `${m.stepIndex != null ? `step ${m.stepIndex + 1}: ` : ''}${m.problem} (fix: ${m.fix})`),
            plan: `${r.fixSteps.length} fix step(s), then the guide from step ${r.resumeAt + 1}`,
            next: 'Tell them in a sentence and offer to start the fix plan (fix_plan start).',
          }
      }
      act.openProgressCheck(note)
      return { ok: true, note: 'Photo sheet is open. Ask them to take a photo of the whole build. The result will arrive as an [App] message.' }
    }
    case 'stay_quiet':
      return { ok: true, scheduling: 'SILENT' }
    case 'fix_plan':
      if (!s.recovery) return { ok: false, error: 'No progress check yet. Use check_progress first.' }
      if (args.action === 'cancel') {
        act.clearPlan()
        return { ok: true, note: 'Back to the full guide, at the overview.' }
      }
      act.startPlan()
      return { ok: true, now: `Plan started. First: ${s.recovery.fixSteps[0]?.title ?? `guide step ${s.recovery.resumeAt + 1}`}` }
    case 'find_products': {
      const query = String(args.query ?? '').trim()
      if (!query) return { ok: false, error: 'Say what to search for.' }
      openShop({ title: String(args.title ?? '').trim() || query, query })
      const r = await searchShop(query).catch(() => null)
      if (!r) return { ok: false, error: 'Shop search failed right now.' }
      if (!r.products.length) return { ok: true, found: 0, next: 'Nothing matched; offer to try different words or search_web.' }
      return {
        ok: true,
        onScreen: true,
        top: r.products.slice(0, 3).map((p) => ({ title: p.title, price: p.price ? money(p.price) : null, seller: p.seller, inStock: p.available })),
        warnings: r.warnings,
      }
    }
    case 'search_web': {
      const r = await agentSearch(String(args.question ?? ''))
      return { answer: r.answer.slice(0, 1500), sources: r.sources.map((x) => x.title) }
    }
    case 'report_step_problem': {
      const i = args.step != null ? Number(args.step) - 1 : s.stepIndex
      const step = s.steps[i]
      const problem = String(args.problem ?? '').trim()
      if (!step || !problem) return { ok: false, error: 'Say which step and what the problem is.', scheduling: 'WHEN_IDLE' }
      // Fix steps from a progress check aren't part of the saved guide.
      const index = s.analysis.steps.findIndex((g) => g === step || (g.title === step.title && g.partIds.join() === step.partIds.join()))
      if (index < 0) return { ok: true, note: 'That is a temporary fix step; nothing to save.', scheduling: 'SILENT' }
      const r = await reportStepProblem(s.scanId, index, args.user_says_wrong ? 'user_says_wrong' : 'coach_warning', problem)
      if (r.mismatch)
        return {
          ok: false,
          error: `That problem doesn't match step ${i + 1} ("${step.title}"), so nothing changed.`,
          next: 'Call report_step_problem again with the number of the step it is about, or ask them which step they mean.',
          scheduling: 'WHEN_IDLE',
        }
      if (!r.revised)
        return args.user_says_wrong
          ? { ok: false, note: 'Saved, but the step could not be rewritten right now.', next: 'Tell them it is noted.', scheduling: 'WHEN_IDLE' }
          : { ok: true, saved: true, scheduling: 'SILENT' }
      act.reviseStep(index, r.revised)
      return {
        ok: true,
        revised: true,
        step: i + 1,
        newInstruction: plainStepText(s.mode === 'disassemble' ? r.revised.disassembly : r.revised.assembly, s.analysis.parts),
        caution: r.revised.caution,
        next: 'Tell them in a few words that this step is updated, then read the new instruction.',
        scheduling: 'WHEN_IDLE',
      }
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
