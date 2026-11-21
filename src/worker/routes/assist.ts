import { Hono } from 'hono'
import type { Analysis, Recovery } from '../../shared/types'
import { webAnswer } from '../clonvo'
import type { ThinkingLevel } from '../gemini'
import { exportSpans, newSpanId } from '../otel'
import { checkProgress } from '../recovery'
import { ALLOWED_TYPES, fileUrl, parseJson, toBase64 } from '../util'

const MAX_CHECK_BYTES = 4 * 1024 * 1024
const LIVE_SESSION_MINUTES = 30

const assist = new Hono<{ Bindings: Env }>()

/**
 * Voice sessions run browser → Gemini Live directly, so the app reports each session here
 * (turns with what was said, tool calls, coach checks) and it goes to Clonvo Traces as one trace.
 */
assist.post('/telemetry', async (c) => {
  if (!c.env.CLONVO_API_KEY) return c.body(null, 204)
  const body = await c.req.json<any>().catch(() => null)
  if (!body || typeof body.name !== 'string' || !Array.isArray(body.events)) return c.json({ error: 'bad telemetry' }, 400)
  const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d)
  const flat = (o: unknown) =>
    Object.fromEntries(
      Object.entries(o && typeof o === 'object' ? o : {})
        .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))
        .map(([k, v]) => [k.slice(0, 80), typeof v === 'string' ? v.slice(0, 4000) : v]),
    ) as Record<string, string | number | boolean>
  const sessionId = typeof body.scanId === 'string' ? body.scanId.slice(0, 64) : undefined
  const rootId = newSpanId()
  const start = num(body.start, Date.now())
  c.executionCtx.waitUntil(
    exportSpans(c.env.CLONVO_API_KEY, newSpanId() + newSpanId(), [
      {
        spanId: rootId,
        name: body.name.slice(0, 100),
        start,
        end: num(body.end, Date.now()),
        attributes: { 'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.name': 'voice helper', 'session.id': sessionId, ...flat(body.attributes) },
      },
      ...body.events.slice(0, 300).map((e: any) => ({
        spanId: newSpanId(),
        parentSpanId: rootId,
        name: String(e?.name ?? 'event').slice(0, 100),
        start: num(e?.start, start),
        end: num(e?.end, num(e?.start, start)),
        ok: e?.ok !== false,
        client: String(e?.name ?? '').startsWith('tool '),
        attributes: { 'session.id': sessionId, ...flat(e?.attributes) },
      })),
    ]),
  )
  return c.body(null, 204)
})

/**
 * "Check my progress": body is a photo of the build as it is now.
 * ?mode=disassemble|assemble&note=what the user thinks went wrong (optional)
 */
assist.post('/scans/:id/progress', async (c) => {
  const id = c.req.param('id')
  const mode = c.req.query('mode') === 'assemble' ? 'assemble' : 'disassemble'
  const note = (c.req.query('note') ?? '').trim().slice(0, 500) || null
  const type = c.req.header('content-type') ?? ''
  if (!ALLOWED_TYPES.includes(type)) return c.json({ error: 'send the photo as image/jpeg, png or webp' }, 400)
  const buf = await c.req.arrayBuffer()
  if (buf.byteLength === 0 || buf.byteLength > MAX_CHECK_BYTES) return c.json({ error: 'photo must be under 4 MB' }, 400)

  const row = await c.env.DB.prepare('SELECT analysis FROM scans WHERE id = ?').bind(id).first<{ analysis: string | null }>()
  const analysis = parseJson<Analysis | null>(row?.analysis ?? null, null)
  if (!analysis?.steps.length) return c.json({ error: 'this scan has no steps yet' }, 404)

  const key = `scans/${id}/progress-${Date.now()}.${type.split('/')[1]}`
  const [, result] = await Promise.all([
    c.env.FILES.put(key, buf, { httpMetadata: { contentType: type } }),
    checkProgress({
      apiKey: c.env.GEMINI_API_KEY,
      model: c.env.STEPS_MODEL || c.env.GEMINI_MODEL,
      thinkingLevel: (c.env.ANALYSIS_THINKING as ThinkingLevel) || null,
      photo: { base64: toBase64(buf), mimeType: type },
      analysis,
      mode,
      note,
    }),
  ])
  const recovery: Recovery = { ...result, createdAt: Date.now(), photoUrl: fileUrl(key) }
  await c.env.DB.prepare('UPDATE scans SET recovery = ? WHERE id = ?').bind(JSON.stringify(recovery), id).run()
  return c.json(recovery)
})

// Back to the full guide.
assist.delete('/scans/:id/recovery', async (c) => {
  await c.env.DB.prepare('UPDATE scans SET recovery = NULL WHERE id = ?').bind(c.req.param('id')).run()
  return c.body(null, 204)
})

/**
 * Voice agent: a single-use, short-lived Gemini Live token, so the browser talks to Gemini
 * directly (lowest latency) without ever seeing the API key.
 */
assist.post('/live/token', async (c) => {
  if (!c.env.GEMINI_API_KEY) return c.json({ error: 'GEMINI_API_KEY is not configured' }, 500)
  const now = Date.now()
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
    method: 'POST',
    headers: { 'x-goog-api-key': c.env.GEMINI_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      uses: 1,
      expireTime: new Date(now + LIVE_SESSION_MINUTES * 60_000).toISOString(),
      newSessionExpireTime: new Date(now + 2 * 60_000).toISOString(),
    }),
  })
  const body = (await res.json().catch(() => null)) as { name?: string; error?: { message?: string } } | null
  if (!res.ok || !body?.name) return c.json({ error: body?.error?.message ?? 'could not start a voice session' }, 502)
  return c.json({ token: body.name, model: c.env.LIVE_MODEL || 'gemini-3.8-live' })
})

// Voice agent's "search the web" tool: a short cited answer from Clonvo.
assist.post('/agent/search', async (c) => {
  if (!c.env.CLONVO_API_KEY) return c.json({ error: 'web search is not configured' }, 500)
  const { question } = await c.req.json<{ question?: string }>().catch(() => ({ question: '' }))
  const q = (question ?? '').trim().slice(0, 300)
  if (!q) return c.json({ error: 'question is required' }, 400)
  return c.json(await webAnswer(c.env.CLONVO_API_KEY, q))
})

export default assist
