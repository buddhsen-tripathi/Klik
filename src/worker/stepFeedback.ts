import type { Analysis, Step } from '../shared/types'
import { generateJson, normalizeSteps, STEP_ITEM, type ThinkingLevel } from './gemini'
import { forgetCheckContext } from './checkContext'
import { parseJson, toBase64 } from './util'
import { partLabel } from '../shared/parts'

/**
 * Learning from use: every problem someone hits on a step is saved. When the user says a step is
 * wrong, or the same step collects REPEAT_THRESHOLD problems (e.g. the live coach keeps warning
 * about it), the step is rewritten to prevent them and saved, so the next person gets the better one.
 */

export type FeedbackKind = 'user_says_wrong' | 'coach_warning' | 'photo_check'
const REPEAT_THRESHOLD = 2

export async function recordFeedback(db: D1Database, f: { scanId: string; stepIndex: number; kind: FeedbackKind; problem: string; source: string }) {
  await db
    .prepare('INSERT INTO step_feedback (scan_id, step_index, kind, problem, source, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(f.scanId, f.stepIndex, f.kind, f.problem.slice(0, 500), f.source, Date.now())
    .run()
}

/** Rewrite the step if its open problems call for it. Returns the new step, or null if not (yet). */
export type Revision = { step: Step; reasons: string[] } | { mismatch: true } | null

export async function maybeReviseStep(env: Env, scanId: string, stepIndex: number): Promise<Revision> {
  const open = await env.DB.prepare('SELECT kind FROM step_feedback WHERE scan_id = ? AND step_index = ? AND used = 0')
    .bind(scanId, stepIndex)
    .all<{ kind: FeedbackKind }>()
  const kinds = open.results.map((r) => r.kind)
  if (!kinds.includes('user_says_wrong') && kinds.length < REPEAT_THRESHOLD) return null

  const row = await env.DB.prepare('SELECT analysis, stage FROM scans WHERE id = ?').bind(scanId).first<{ analysis: string | null; stage: string }>()
  const analysis = parseJson<Analysis | null>(row?.analysis ?? null, null)
  // Only once the plan is final (the scan workflow no longer writes the analysis).
  if (!analysis || !['modeling', 'done'].includes(row?.stage ?? '')) return null
  const step = analysis.steps[stepIndex]
  if (!step) return null

  // Claim the problems atomically, so two reports arriving together don't both rewrite.
  const claimed = await env.DB.prepare('UPDATE step_feedback SET used = 1 WHERE scan_id = ? AND step_index = ? AND used = 0 RETURNING kind, problem')
    .bind(scanId, stepIndex)
    .all<{ kind: FeedbackKind; problem: string }>()
  const problems = [...new Set(claimed.results.map((r) => r.problem.trim()))]
  if (!problems.length) return null

  const photo = await env.DB.prepare('SELECT photo_key, photo_type FROM scan_photos WHERE scan_id = ? ORDER BY idx')
    .bind(scanId)
    .all<{ photo_key: string; photo_type: string }>()
  const best = photo.results[Math.min(analysis.bestPhotoIndex, photo.results.length - 1)]
  const obj = best ? await env.FILES.get(best.photo_key) : null
  const images = obj ? [{ base64: toBase64(await obj.arrayBuffer()), mimeType: best.photo_type }] : []

  const partLines = analysis.parts
    .filter((p) => step.partIds.includes(p.id))
    .map((p) => `- ${p.id}: ${partLabel(p)}`)
    .join('\n')
  const ref = analysis.reference && analysis.reference.match !== 'none' ? `Documentation notes: ${analysis.reference.notes.join(' ')}\n` : ''
  const raw = await generateJson({
    apiKey: env.GEMINI_API_KEY,
    model: env.STEPS_MODEL || env.GEMINI_MODEL,
    images,
    mediaResolution: 'MEDIA_RESOLUTION_MEDIUM',
    thinkingLevel: ((env.ANALYSIS_THINKING as ThinkingLevel) || 'LOW') as ThinkingLevel,
    schema: {
      type: 'object',
      properties: {
        applies: { type: 'boolean', description: 'false if none of the problems are actually about this step (wrong step blamed).' },
        step: STEP_ITEM,
      },
      required: ['applies', 'step'],
    },
    text: `You are improving one step of a guide for taking apart / putting together a ${analysis.objectName}.
People following it ran into these problems:
${problems.map((p) => `- ${p}`).join('\n')}

CURRENT STEP: ${step.title}
Taking apart: ${step.disassembly}
Putting together: ${step.assembly}
Tools: ${step.tools.join(', ') || 'none'}
Caution: ${step.caution ?? 'none'}
Parts (keep exactly these partIds): 
${partLines}
${ref}
Rewrite the step so people avoid those problems: add the missing detail (which fastener, orientation, order, where to hold it, what not to force) and put any risk in "caution".
Keep it short and in the same voice. Keep the same partIds. Only state sizes that appear above; never invent thread sizes or lengths.
If none of the problems are about this step's parts or actions, set applies false and return the step unchanged.`,
  })
  if (raw?.applies === false) return { mismatch: true } // blamed on the wrong step; leave it alone
  const [fixed] = normalizeSteps([{ ...raw?.step, partIds: step.partIds }], new Set(step.partIds))
  if (!fixed) return null
  const revised: Step = { ...fixed, group: step.group ?? null, revision: { at: Date.now(), reasons: problems.slice(0, 5), count: problems.length + (step.revision?.count ?? 0) } }
  // Only this one step changes; the rest of the analysis is untouched.
  await env.DB.prepare(`UPDATE scans SET analysis = json_set(analysis, '$.steps[${stepIndex}]', json(?)) WHERE id = ?`).bind(JSON.stringify(revised), scanId).run()
  forgetCheckContext(scanId)
  return { step: revised, reasons: problems }
}
