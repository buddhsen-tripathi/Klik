import type { Source } from '../shared/types'

/**
 * Clonvo tools gateway (https://clonvo.com/docs/tools): one key for web search,
 * cited answers, scraping and sandboxes. Used to find manuals, teardown guides and
 * spec sheets so dimensions and fasteners come from documents, not guesses.
 */
const API = 'https://api.clonvo.com/v1/tools'

async function callTool<T>(apiKey: string, tool: string, args: object, timeoutMs: number): Promise<T> {
  const res = await fetch(`${API}/${tool}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ arguments: args }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const body = (await res.json().catch(() => null)) as any
  if (!res.ok) throw new Error(`Clonvo ${tool} ${res.status}: ${body?.error?.message ?? 'request failed'}`)
  return body.result as T
}

interface SearchResult {
  results: { title: string; url: string; snippet?: string; content?: string }[]
}
interface AnswerResult {
  answer: string
  citations: { title: string; url: string }[]
}

export interface ResearchFindings {
  /** Page text and the cited answer, labelled with [n] source numbers. */
  notes: string
  sources: Source[]
}

const PER_PAGE_CHARS = 6_000
const MAX_NOTES = 30_000

/**
 * Run the searches (manual, teardown/parts list, ...) and one cited spec question in parallel.
 * Individual calls may fail; whatever came back is used. Throws only if everything failed.
 */
export async function researchObject(apiKey: string, queries: string[], specQuestion: string): Promise<ResearchFindings> {
  const searches = queries.slice(0, 3).map((query) =>
    callTool<SearchResult>(apiKey, 'web_search', { query, max_results: 3, include_content: true, max_content_chars: PER_PAGE_CHARS }, 30_000),
  )
  const answer = specQuestion ? callTool<AnswerResult>(apiKey, 'web_answer', { query: specQuestion }, 30_000) : Promise.reject(new Error('no question'))
  const [answerResult, ...searchResults] = await Promise.allSettled([answer, ...searches])

  const sources: Source[] = []
  const indexOf = (url: string, title: string) => {
    let i = sources.findIndex((s) => s.url === url)
    if (i < 0) i = sources.push({ title: title || url, url }) - 1
    return i + 1
  }

  let notes = ''
  if (answerResult.status === 'fulfilled' && answerResult.value.answer) {
    const refs = (answerResult.value.citations ?? []).map((c) => `[${indexOf(c.url, c.title)}]`).join('')
    notes += `CITED ANSWER to "${specQuestion}" ${refs}\n${answerResult.value.answer.trim()}\n\n`
  }
  const seen = new Set<string>()
  for (const r of searchResults) {
    if (r.status !== 'fulfilled') continue
    for (const hit of r.value.results ?? []) {
      if (!hit.url || seen.has(hit.url)) continue
      seen.add(hit.url)
      const text = (hit.content || hit.snippet || '').replace(/\n{3,}/g, '\n\n').trim()
      if (!text) continue
      notes += `[${indexOf(hit.url, hit.title)}] ${hit.title} (${hit.url})\n${text}\n\n`
      if (notes.length > MAX_NOTES) break
    }
  }

  const failures = [answerResult, ...searchResults].filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
  if (!notes && failures.length) throw failures[0].reason
  return { notes: notes.slice(0, MAX_NOTES), sources }
}
