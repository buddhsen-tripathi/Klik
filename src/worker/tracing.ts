import { AsyncLocalStorage } from 'node:async_hooks'
import { exportSpans, newSpanId, traceparent, type SpanData } from './otel'

/**
 * Per-request tracing for Clonvo Traces. Every API request that does real work becomes one trace:
 * the request as the root span, and every outbound call it makes (Gemini, the Decisions API,
 * Clonvo tools, fal, image downloads) as a child span, recorded by wrapping fetch. Exported after
 * the response is sent (waitUntil), so it never slows the user down.
 */
export class RequestTrace {
  readonly traceId = newSpanId() + newSpanId()
  readonly rootId = newSpanId()
  readonly start = Date.now()
  readonly spans: SpanData[] = []
  readonly name: string
  readonly sessionId: string | null
  constructor(name: string, sessionId: string | null) {
    this.name = name
    this.sessionId = sessionId
  }
}

const store = new AsyncLocalStorage<RequestTrace>()
export const runTraced = <T>(trace: RequestTrace, fn: () => Promise<T>) => store.run(trace, fn)

/** What an outbound URL is, in OpenTelemetry GenAI terms. */
function describe(url: URL): { name: string; kind: 'llm' | 'tool' | 'http'; attributes: Record<string, string> } {
  if (url.hostname === 'generativelanguage.googleapis.com') {
    const model = url.pathname.match(/models\/([^:/]+)/)?.[1]
    if (model) return { name: `gemini ${model}`, kind: 'llm', attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.system': 'gemini', 'gen_ai.request.model': model } }
    if (url.pathname.includes('decisions')) return { name: 'gemini decisions', kind: 'llm', attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.system': 'gemini', 'gen_ai.request.model': 'decisions' } }
    if (url.pathname.includes('auth_tokens')) return { name: 'gemini live token', kind: 'http', attributes: { 'gen_ai.system': 'gemini' } }
  }
  if (url.hostname === 'api.clonvo.com') {
    const tool = url.pathname.split('/').pop() ?? 'tool'
    return { name: `clonvo.${tool}`, kind: 'tool', attributes: { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': tool } }
  }
  if (url.hostname.endsWith('fal.run') || url.hostname.endsWith('fal.media') || url.hostname.endsWith('fal.ai'))
    return { name: `fal ${url.pathname.split('/').slice(1, 4).join('/')}`, kind: 'tool', attributes: { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': 'fal.sam-3d' } }
  return { name: `GET ${url.hostname}`, kind: 'http', attributes: { 'server.address': url.hostname } }
}

let installed = false
/** Wrap global fetch once per isolate. Outside a traced request (e.g. the workflow) it does nothing. */
export function installFetchTracing() {
  if (installed) return
  installed = true
  const original = globalThis.fetch
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const trace = store.getStore()
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (!trace || url.hostname === 'otel.clonvo.com') return original(input, init)
    const info = describe(url)
    const spanId = newSpanId()
    // Clonvo nests its own gateway span (provider, cost) under ours.
    if (url.hostname === 'api.clonvo.com') {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
      if (!headers.has('traceparent')) headers.set('traceparent', traceparent(trace.traceId, spanId))
      init = { ...init, headers }
    }
    const start = Date.now()
    try {
      const res = await original(input, init)
      trace.spans.push({
        spanId,
        name: info.name,
        start,
        end: Date.now(),
        client: info.kind !== 'llm',
        ok: res.ok,
        attributes: { ...info.attributes, 'http.response.status_code': res.status, 'clonvo.generation_id': res.headers.get('x-clonvo-generation-id') ?? undefined },
      })
      return res
    } catch (err) {
      trace.spans.push({ spanId, name: info.name, start, end: Date.now(), client: true, ok: false, attributes: { ...info.attributes, 'error.type': String((err as Error)?.name ?? 'error') } })
      throw err
    }
  }
}

export async function exportRequestTrace(apiKey: string, trace: RequestTrace, status: number, attributes: Record<string, string | number | undefined> = {}) {
  await exportSpans(apiKey, trace.traceId, [
    {
      spanId: trace.rootId,
      name: trace.name,
      start: trace.start,
      end: Date.now(),
      ok: status < 500,
      attributes: { 'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.name': 'assemble-on-the-go', 'session.id': trace.sessionId ?? undefined, 'http.response.status_code': status, ...attributes },
    },
    ...trace.spans.map((s) => ({ ...s, parentSpanId: trace.rootId, attributes: { ...s.attributes, 'session.id': trace.sessionId ?? undefined } })),
  ])
}
