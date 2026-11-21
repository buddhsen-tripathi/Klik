import type { Analysis, Recovery, Step } from '../shared/types'
import { decide, image, yes } from './decisions'
import { generateJson, normalizeSteps, STEP_ITEM, type InlineImage, type ThinkingLevel } from './gemini'

/**
 * "Check my progress": the user has followed some of the guide (maybe not quite right) and
 * shows the camera what they have now. Two passes:
 *   1. Decisions API (~0.5 s): for every step, "does this photo show it done?" (probabilities).
 *   2. Gemini: with the photo, the steps and those probabilities, find mistakes, write fix
 *      steps, and pick where to resume.
 */

const DECISION_BATCH = 12 // questions per Decisions call; batches run in parallel

type Mode = Recovery['mode']

const RECOVERY_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'One or two short, friendly sentences: where they are and what to do next. Spoken aloud.' },
    stepStatus: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          status: { type: 'string', enum: ['done', 'not_done', 'wrong', 'unsure'] },
          note: { type: ['string', 'null'], description: 'Only for wrong/unsure: what you see.' },
        },
        required: ['index', 'status', 'note'],
      },
    },
    mistakes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          stepIndex: { type: ['integer', 'null'] },
          problem: { type: 'string', description: 'What is wrong, concretely (which part, how it is placed).' },
          fix: { type: 'string', description: 'How to put it right, in one sentence.' },
        },
        required: ['stepIndex', 'problem', 'fix'],
      },
    },
    fixSteps: { type: 'array', items: STEP_ITEM, description: 'Steps that undo and redo the mistakes, in order. Empty if nothing is wrong.' },
    resumeAt: { type: 'integer', description: 'Index of the first guide step still to do after the fixes (= number of steps if all done).' },
  },
  required: ['summary', 'stepStatus', 'mistakes', 'fixSteps', 'resumeAt'],
}

/** Probability that each step (in mode order) is already done, from the Decisions API. */
async function stepProbabilities(apiKey: string, photo: InlineImage, analysis: Analysis, steps: Step[], mode: Mode): Promise<number[]> {
  const taking = mode === 'disassemble'
  const partList = (s: Step) => s.partIds.map((id) => analysis.parts.find((p) => p.id === id)?.name ?? id).join(', ')
  const batches: number[][] = []
  for (let i = 0; i < steps.length; i += DECISION_BATCH) batches.push(steps.slice(i, i + DECISION_BATCH).map((_, k) => i + k))
  const results = await Promise.all(
    batches.map((idx) =>
      decide(
        apiKey,
        [
          {
            type: 'text',
            text: `Photo of a ${analysis.objectName} that the user is ${taking ? 'taking apart' : 'putting together'} by following a guide.\n`,
          },
          image(photo, 'high'),
        ],
        Object.fromEntries(
          idx.map((i) => [
            `step_${i}`,
            {
              type: 'noul' as const,
              instructions: taking
                ? `Step ${i + 1} "${steps[i].title}": are these parts already removed from the object: ${partList(steps[i])}?`
                : `Step ${i + 1} "${steps[i].title}": are these parts already fitted in place on the object: ${partList(steps[i])}?`,
              criteria: {
                true_description: taking ? 'Clearly removed or set aside.' : 'Clearly fitted in place (correctly or not).',
                false_description: taking ? 'Still attached, or cannot tell.' : 'Still loose or missing, or cannot tell.',
              },
            },
          ]),
        ),
      ).catch(() => ({}) as Record<string, never>),
    ),
  )
  const answers = Object.assign({}, ...results)
  return steps.map((_, i) => yes(answers[`step_${i}`]))
}

export async function checkProgress(opts: {
  apiKey: string
  model: string
  thinkingLevel: ThinkingLevel | null
  photo: InlineImage
  analysis: Analysis
  mode: Mode
  note: string | null
}): Promise<Omit<Recovery, 'photoUrl' | 'createdAt'>> {
  const { analysis, mode, photo } = opts
  const steps = mode === 'disassemble' ? analysis.steps : [...analysis.steps].reverse()
  const probs = await stepProbabilities(opts.apiKey, photo, analysis, steps, mode)
  const taking = mode === 'disassemble'

  const partLines = analysis.parts
    .map((p) => `- ${p.id}: ${(p.quantity ?? 1) > 1 ? `${p.quantity}x ` : ''}${p.name}${p.spec ? ` [${p.spec}]` : ''}`)
    .join('\n')
  const stepLines = steps
    .map((s, i) => `${i}. ${s.title} (parts: ${s.partIds.join(', ')}) - ${taking ? s.disassembly : s.assembly} [quick check: ${Math.round(probs[i] * 100)}% likely done]`)
    .join('\n')

  const raw = await generateJson({
    apiKey: opts.apiKey,
    model: opts.model,
    images: [photo],
    mediaResolution: 'MEDIA_RESOLUTION_HIGH',
    thinkingLevel: opts.thinkingLevel ?? 'LOW',
    schema: RECOVERY_SCHEMA,
    text: `The user is ${taking ? 'taking apart' : 'putting together'} a ${analysis.objectName} by following this guide, and sent a photo of where they are now.
${opts.note ? `They say: "${opts.note}"\n` : ''}
PARTS (id: name)
${partLines}

GUIDE STEPS (index. title, in the order they follow them)
${stepLines}

The "quick check" numbers come from a fast classifier; use them as hints, the photo wins.

Do this:
1. For EVERY step index give a status: done, not_done, wrong (done but incorrectly: wrong orientation, wrong position, wrong fastener, skipped a part, out of order in a way that matters) or unsure (can't see it).
2. List each mistake with the step it belongs to, what's wrong, and the fix. Take the user's own words seriously.
3. Write fixSteps: the shortest safe sequence to put the mistakes right (undo what blocks the fix, correct it, redo), using the part ids above. Fill both "disassembly" and "assembly" fields; the one for the user's current direction (${taking ? 'disassembly' : 'assembly'}) is what they'll read. Name fasteners and tools. Empty if nothing is wrong.
4. resumeAt: the first step that is not done after the fixes (a step whose part is still missing or skipped counts as not done, even if later steps were done).
5. summary: one or two short sentences a helper would say out loud, e.g. "Nice progress, steps 1 to 4 are done. The left wheel is on backwards, so let's fix that, then carry on with step 5."
Talk to the user in step NUMBERS (index + 1): index 0 is "step 1". Never say "step 0".
Never invent parts. If the photo doesn't show the object, say so in the summary, mark steps unsure and keep resumeAt at the first step not clearly done.`,
  })

  const ids = new Set(analysis.parts.map((p) => p.id))
  const statuses = new Set(['done', 'not_done', 'wrong', 'unsure'])
  const stepStatus = steps.map((_, i) => {
    const s = (Array.isArray(raw?.stepStatus) ? raw.stepStatus : []).find((x: any) => x?.index === i)
    const status = statuses.has(s?.status) ? s.status : probs[i] > 0.75 ? 'done' : probs[i] < 0.25 ? 'not_done' : 'unsure'
    return { index: i, status, note: typeof s?.note === 'string' && s.note.trim() ? s.note : null } as Recovery['stepStatus'][number]
  })
  const mistakes = (Array.isArray(raw?.mistakes) ? raw.mistakes : [])
    .filter((m: any) => typeof m?.problem === 'string' && m.problem.trim())
    .map((m: any) => ({
      stepIndex: Number.isInteger(m.stepIndex) && m.stepIndex >= 0 && m.stepIndex < steps.length ? m.stepIndex : null,
      problem: m.problem,
      fix: typeof m.fix === 'string' ? m.fix : '',
    }))
  const fixSteps = normalizeSteps(raw?.fixSteps, ids).map((s) => ({ ...s, group: 'Fix first' }))
  const firstOpen = stepStatus.findIndex((s) => s.status !== 'done')
  const resumeAt = Number.isInteger(raw?.resumeAt)
    ? Math.max(0, Math.min(steps.length, raw.resumeAt))
    : firstOpen === -1
      ? steps.length
      : firstOpen

  return {
    mode,
    summary: typeof raw?.summary === 'string' && raw.summary.trim() ? raw.summary : 'Here is where you are.',
    stepStatus,
    mistakes,
    fixSteps,
    resumeAt,
    note: opts.note,
  }
}
