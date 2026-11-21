import type { Analysis, Step, Triage } from '../shared/types'
import type { InlineImage } from './gemini'
import { plainStepText, qty } from '../shared/parts'

/**
 * Gemini Decisions API (gemini-decision-1): typed yes/no and choice questions over shared
 * input, answered in one prefill pass with zero output tokens (~0.5 s). Used for the quick
 * branch points: assembled vs loose parts, simple vs complex, worth searching for a manual,
 * and "is this step done yet?" from the live camera.
 */
const API = 'https://generativelanguage.googleapis.com/v1beta/decisions'
const MODEL = 'gemini-decision-1'

type Input = { type: 'text'; text: string } | { type: 'image'; data: string; mime_type: string; resolution?: 'low' | 'medium' | 'high' }
type Question =
  | { type: 'noul'; instructions: string; criteria?: { true_description: string; false_description: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
type Answer =
  | { type: 'noul'; noul: number; confidence: number }
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }

export async function decide(apiKey: string, input: Input[], questions: Record<string, Question>, timeoutMs = 15_000): Promise<Record<string, Answer>> {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ model: MODEL, input, questions }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const body = (await res.json().catch(() => null)) as any
  if (!res.ok) throw new Error(`Decisions ${res.status}: ${body?.error?.message ?? 'request failed'}`)
  return body.answers
}

export const image = (img: InlineImage, resolution: 'low' | 'medium' | 'high' = 'medium'): Input => ({
  type: 'image',
  data: img.base64,
  mime_type: img.mimeType,
  resolution,
})
export const yes = (a: Answer | undefined) => (a?.type === 'noul' ? a.noul : 0.5)
const pick = <T extends string>(a: Answer | undefined, fallback: T): { value: T; confidence: number } =>
  a?.type === 'choice' ? { value: a.choice as T, confidence: a.confidence } : { value: fallback, confidence: 0 }

/** Routing for one scan, run alongside the identify pass. */
export async function triage(apiKey: string, images: InlineImage[], hint: string | null): Promise<Triage> {
  const answers = await decide(
    apiKey,
    [
      { type: 'text', text: `Photos of an object a user wants to take apart or put together.${hint ? ` Camera tag: "${hint}".` : ''}\n` },
      ...images.slice(0, 3).map((img) => image(img)),
    ],
    {
      has_docs: {
        type: 'noul',
        instructions:
          'Is this a specific branded or manufactured product (or a kit) for which an official manual, assembly instructions or a repair/teardown guide is likely to exist online?',
        criteria: {
          true_description: 'A recognisable product, appliance, device, furniture kit, toy or model kit from a manufacturer.',
          false_description: 'A generic or handmade object with nothing model-specific to look up.',
        },
      },
      state: {
        type: 'choice',
        instructions: 'What state is the object in the photos?',
        criteria: {
          assembled: 'One complete, put-together object.',
          loose_parts: 'Separate parts or an unassembled kit laid out, waiting to be put together.',
          partly_assembled: 'Partly put together, with some parts still loose.',
        },
      },
      complexity: {
        type: 'choice',
        instructions: 'How many separate subassemblies would someone deal with when taking this apart?',
        criteria: {
          simple: 'One piece or a few parts held by a single joint (a pen, a jar, a stool, a lamp).',
          moderate: 'Several parts in two or three areas.',
          complex: 'Many parts in distinct subassemblies (a chair with a gas lift, a drill, a bicycle, a car).',
        },
      },
    },
  )
  const state = pick<Triage['state']>(answers.state, 'assembled')
  const complexity = pick<Triage['complexity']>(answers.complexity, 'moderate')
  return {
    hasDocs: yes(answers.has_docs),
    state: state.value,
    stateConfidence: state.confidence,
    complexity: complexity.value,
    complexityConfidence: complexity.confidence,
  }
}

export interface StepCheck {
  /** Probability the step is complete. */
  done: number
  /** Probability the object (or its parts) is actually in view. */
  inView: number
}

/** Live camera: has the user finished this step? */
export async function checkStep(opts: {
  apiKey: string
  frame: InlineImage
  analysis: Analysis
  step: Step
  mode: 'disassemble' | 'assemble'
}): Promise<StepCheck> {
  const { analysis, step, mode } = opts
  const names = step.partIds.map((id) => {
    const p = analysis.parts.find((x) => x.id === id)
    return p ? `${qty(p)}${p.name}` : id
  })
  const list = names.join(', ')
  const taking = mode === 'disassemble'
  const answers = await decide(
    opts.apiKey,
    [
      {
        type: 'text',
        text: `Live camera frame. The user is ${taking ? 'taking apart' : 'putting together'} a ${analysis.objectName}.
Current step: "${step.title}". ${plainStepText(taking ? step.disassembly : step.assembly, analysis.parts)}
Parts in this step: ${list}.
`,
      },
      image(opts.frame),
    ],
    {
      step_done: {
        type: 'noul',
        instructions: taking
          ? `Has this step been completed, i.e. are these parts removed or separated from the rest of the object: ${list}?`
          : `Has this step been completed, i.e. are these parts fitted in place on the object: ${list}?`,
        criteria: taking
          ? {
              true_description: 'The listed parts are clearly off, detached or set aside, and the object no longer has them in place.',
              false_description: 'The listed parts are still attached, or the photo does not show enough to tell.',
            }
          : {
              true_description: 'The listed parts are clearly fitted or fastened in their place on the object.',
              false_description: 'The listed parts are still loose or missing, or the photo does not show enough to tell.',
            },
      },
      in_view: {
        type: 'noul',
        instructions: `Does the photo clearly show the ${analysis.objectName} or its parts?`,
      },
    },
    8_000,
  )
  return { done: yes(answers.step_done), inView: yes(answers.in_view) }
}
