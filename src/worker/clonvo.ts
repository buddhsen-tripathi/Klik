import type { Source } from '../shared/types'

/**
 * Clonvo tools gateway (https://clonvo.com/docs/tools): one key for web search,
 * cited answers, scraping and sandboxes. Used to find manuals, teardown guides and
 * spec sheets so dimensions and fasteners come from documents, not guesses.
 */
import { newSpanId, traceparent } from './otel'

const API = 'https://api.clonvo.com/v1/tools'

/** One finished tool call, for the latency waterfall. generationId can be looked up in Clonvo
 *  (GET /v1/generation?id=…) for its server-side latency and provider. */
export interface ToolTiming {
  name: string
  start: number
  end: number
  generationId: string | null
  provider: string | null
  cached: boolean
  ok: boolean
  spanId: string
}

async function callTool<T>(
  apiKey: string,
  tool: string,
  args: object,
  timeoutMs: number,
  label: string,
  onTiming?: (t: ToolTiming) => void,
  traceId?: string,
): Promise<T> {
  const start = Date.now()
  const spanId = newSpanId()
  let body: any = null
  let generationId: string | null = null
  let ok = false
  try {
    const res = await fetch(`${API}/${tool}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        // Groups these calls in Clonvo's Activity view.
        'x-title': 'Assemble on the Go',
        'http-referer': 'https://assemble-on-the-go.workers.dev',
        // Clonvo Traces: nest this gateway call under our span for it (see otel.ts).
        ...(traceId ? { traceparent: traceparent(traceId, spanId) } : {}),
      },
      body: JSON.stringify({ arguments: args }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    generationId = res.headers.get('x-clonvo-generation-id')
    body = await res.json().catch(() => null)
    if (!res.ok) throw new Error(`Clonvo ${tool} ${res.status}: ${body?.error?.message ?? 'request failed'}`)
    ok = true
    return body.result as T
  } finally {
    onTiming?.({
      name: label,
      start,
      end: Date.now(),
      generationId: generationId ?? body?.id ?? null,
      provider: body?.provider ?? null,
      cached: body?.cached === true,
      ok,
      spanId,
    })
  }
}

interface SearchResult {
  results: { title: string; url: string; snippet?: string; content?: string }[]
}
interface AnswerResult {
  answer: string
  citations: { title: string; url: string }[]
}

export interface ResearchFindings {
  /** Page text and/or the cited answer, labelled with [n] source numbers. */
  notes: string
  sources: Source[]
}

const PER_PAGE_CHARS = 6_000
const MAX_NOTES = 30_000

/**
 * Fast path (~2 s): one cited answer about dimensions and fasteners. This is all the planner
 * waits for; the slower page search runs alongside the planner.
 */
export async function answerSpecs(apiKey: string, question: string, onTiming?: (t: ToolTiming) => void, traceId?: string): Promise<ResearchFindings> {
  const r = await callTool<AnswerResult>(apiKey, 'web_answer', { query: question }, 30_000, 'clonvo.web_answer', onTiming, traceId)
  const sources: Source[] = []
  for (const c of r.citations ?? []) if (c.url && !sources.some((s) => s.url === c.url)) sources.push({ title: c.title || c.url, url: c.url })
  const refs = sources.map((_, i) => `[${i + 1}]`).join('')
  return { notes: r.answer ? `CITED ANSWER to "${question}" ${refs}\n${r.answer.trim()}\n\n` : '', sources }
}

/**
 * Slow path (~15-20 s): manual / teardown searches with page content, in parallel. Failed
 * searches are skipped; throws only if all of them failed.
 */
export async function searchPages(
  apiKey: string,
  queries: string[],
  onTiming?: (t: ToolTiming) => void,
  startIndex = 0,
  traceId?: string,
): Promise<ResearchFindings> {
  const results = await Promise.allSettled(
    queries.slice(0, 3).map((query, i) =>
      callTool<SearchResult>(
        apiKey,
        'web_search',
        { query, max_results: 3, include_content: true, max_content_chars: PER_PAGE_CHARS },
        30_000,
        `clonvo.web_search.${i + 1}`,
        onTiming,
        traceId,
      ),
    ),
  )
  const sources: Source[] = []
  let notes = ''
  const seen = new Set<string>()
  for (const r of results) {
    if (r.status !== 'fulfilled') continue
    for (const hit of r.value.results ?? []) {
      if (!hit.url || seen.has(hit.url)) continue
      seen.add(hit.url)
      const text = (hit.content || hit.snippet || '').replace(/\n{3,}/g, '\n\n').trim()
      if (!text) continue
      sources.push({ title: hit.title || hit.url, url: hit.url })
      notes += `[${startIndex + sources.length}] ${hit.title} (${hit.url})\n${text}\n\n`
      if (notes.length > MAX_NOTES) break
    }
  }
  const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
  if (!notes && failed.length === results.length && failed.length) throw failed[0].reason
  return { notes: notes.slice(0, MAX_NOTES), sources }
}

/** Short cited answer for the voice agent's "search the web" tool. */
export async function webAnswer(apiKey: string, question: string): Promise<{ answer: string; sources: Source[] }> {
  const r = await callTool<AnswerResult>(apiKey, 'web_answer', { query: question }, 20_000, 'clonvo.web_answer.agent')
  return {
    answer: (r.answer ?? '').trim(),
    sources: (r.citations ?? []).filter((c) => c.url).slice(0, 5).map((c) => ({ title: c.title || c.url, url: c.url })),
  }
}
