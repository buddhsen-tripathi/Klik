import type { Source } from '../shared/types'

/**
 * Clonvo tools gateway (https://clonvo.com/docs/tools). One key for web search,
 * scraping, research and sandboxes; we only need web_search for manuals/specs.
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

export interface Research {
  query: string
  /** Condensed page text for the step writers. */
  notes: string
  sources: Source[]
}

const MAX_NOTES = 12_000

/** Look up manuals / teardown guides / spec sheets for the object. */
export async function researchObject(apiKey: string, query: string): Promise<Research> {
  const result = await callTool<SearchResult>(
    apiKey,
    'web_search',
    { query, max_results: 4, include_content: true, max_content_chars: 3500 },
    25_000,
  )
  const hits = (result.results ?? []).filter((r) => r.url)
  let notes = ''
  for (const [i, r] of hits.entries()) {
    const text = (r.content || r.snippet || '').replace(/\n{3,}/g, '\n\n').trim()
    if (!text) continue
    notes += `[${i + 1}] ${r.title} (${r.url})\n${text}\n\n`
    if (notes.length > MAX_NOTES) break
  }
  return {
    query,
    notes: notes.slice(0, MAX_NOTES),
    sources: hits.map((r) => ({ title: r.title || r.url, url: r.url })),
  }
}
