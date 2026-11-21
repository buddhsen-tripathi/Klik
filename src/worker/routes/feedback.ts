import { Hono } from 'hono'
import { maybeReviseStep, recordFeedback, type FeedbackKind } from '../stepFeedback'

const feedback = new Hono<{ Bindings: Env }>()
const KINDS: FeedbackKind[] = ['user_says_wrong', 'coach_warning', 'photo_check']

/**
 * A problem with one step, from the voice helper / live coach. Body: { kind, problem }.
 * :index is the step's index in analysis.steps (disassembly order).
 * Answers with the rewritten step when this report tipped it over, so the app can show it now.
 */
feedback.post('/scans/:id/steps/:index/feedback', async (c) => {
  const scanId = c.req.param('id')
  const stepIndex = Number(c.req.param('index'))
  const body = await c.req.json<{ kind?: string; problem?: string }>().catch(() => ({}) as { kind?: string; problem?: string })
  const kind = KINDS.find((k) => k === body.kind)
  const problem = (body.problem ?? '').trim()
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || !kind || !problem) return c.json({ error: 'need a step index, kind and problem' }, 400)
  await recordFeedback(c.env.DB, { scanId, stepIndex, kind, problem, source: 'voice' })
  const revised = await maybeReviseStep(c.env, scanId, stepIndex).catch((err) => {
    console.warn('step rewrite failed', err)
    return null
  })
  if (revised && 'mismatch' in revised) return c.json({ recorded: true, revised: null, reasons: [], mismatch: true })
  return c.json({ recorded: true, revised: revised?.step ?? null, reasons: revised?.reasons ?? [], mismatch: false })
})

export default feedback
