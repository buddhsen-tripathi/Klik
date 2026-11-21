import type { Timing } from '../shared/types'

/**
 * Clonvo Traces (https://clonvo.com/docs/traces): each scan is exported as one OpenTelemetry trace
 * (OTLP/HTTP JSON to otel.clonvo.com), built from the latency waterfall we already record. Clonvo
 * tool calls carry a W3C `traceparent` pointing at their own span, so Clonvo nests the gateway call
 * (provider, cost, latency) inside the trace.
 */
const ENDPOINT = 'https://otel.clonvo.com/v1/traces'

const hex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')

/** Scan ids are UUIDs: their 32 hex digits are the trace id, so every call for a scan lands in one trace. */
export const traceIdFor = (scanId: string) => scanId.replace(/-/g, '').toLowerCase().padEnd(32, '0').slice(0, 32)
/** The root span id is derived too, so spans can point at it before the trace is exported. */
export const rootSpanIdFor = (scanId: string) => traceIdFor(scanId).slice(16).replace(/^0{16}$/, '1'.repeat(16))
export const newSpanId = () => hex(8)
export const traceparent = (traceId: string, spanId: string) => `00-${traceId}-${spanId}-01`

type Attr = { key: string; value: { stringValue: string } | { intValue: string } | { boolValue: boolean } }
const attrs = (o: Record<string, string | number | boolean | null | undefined>): Attr[] =>
  Object.entries(o)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([key, v]) =>
      typeof v === 'number' ? { key, value: { intValue: String(Math.round(v)) } } : typeof v === 'boolean' ? { key, value: { boolValue: v } } : { key, value: { stringValue: String(v) } },
    )
const ns = (ms: number) => `${Math.round(ms)}000000`

/** What kind of step a waterfall row is, so Clonvo shows it as an LLM call, a tool call or a plain step. */
function classify(t: Timing, model: string): Record<string, string> {
  if (t.name.startsWith('clonvo.')) return { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': t.name.replace(/^clonvo\./, '') }
  if (t.name.startsWith('3D')) return { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': 'fal.sam-3d' }
  if (/^(queue|steps ready|model ready|research)/.test(t.name)) return {}
  return { 'gen_ai.operation.name': 'chat', 'gen_ai.system': 'gemini', 'gen_ai.request.model': model }
}

export interface SpanData {
  spanId: string
  parentSpanId?: string
  name: string
  start: number
  end: number
  /** Outbound call (client span) rather than our own work. */
  client?: boolean
  ok?: boolean
  attributes: Record<string, string | number | boolean | null | undefined>
}

/** POST spans of one trace to Clonvo (OTLP/HTTP JSON). Never throws: tracing must not break the app. */
export async function exportSpans(apiKey: string, traceId: string, spans: SpanData[]): Promise<void> {
  const body = {
    resourceSpans: [
      {
        resource: { attributes: attrs({ 'service.name': 'assemble-on-the-go', 'deployment.environment': 'production' }) },
        scopeSpans: [
          {
            scope: { name: 'assemble-on-the-go' },
            spans: spans.map((s) => ({
              traceId,
              spanId: s.spanId,
              ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
              name: s.name,
              kind: s.client ? 3 : 1,
              startTimeUnixNano: ns(s.start),
              endTimeUnixNano: ns(Math.max(s.end, s.start)),
              attributes: attrs(s.attributes),
              status: { code: s.ok === false ? 2 : 1 },
            })),
          },
        ],
      },
    ],
  }
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) console.warn('trace export failed', res.status, (await res.text()).slice(0, 200))
  } catch (err) {
    console.warn('trace export failed', err)
  }
}

export interface TraceRun {
  apiKey: string
  scanId: string
  name: string
  start: number
  end: number
  timings: Timing[]
  model: string
  attributes?: Record<string, string | number | boolean | null | undefined>
  ok?: boolean
}

/** Export one run (a scan) as a trace, built from its latency waterfall. */
export async function exportTrace(run: TraceRun): Promise<void> {
  const rootId = rootSpanIdFor(run.scanId)
  await exportSpans(run.apiKey, traceIdFor(run.scanId), [
    {
      spanId: rootId,
      name: run.name,
      start: run.start,
      end: run.end,
      ok: run.ok,
      attributes: { 'session.id': run.scanId, 'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.name': 'assemble-on-the-go', ...run.attributes },
    },
    ...run.timings
      .filter((t) => t.end >= t.start && t.name !== run.name)
      .map((t) => ({
        spanId: t.spanId ?? newSpanId(),
        parentSpanId: rootId,
        name: t.name,
        start: t.start,
        end: t.end,
        client: t.name.startsWith('clonvo.') || t.name.startsWith('3D'),
        ok: !t.note?.includes('failed'),
        attributes: { ...classify(t, run.model), 'clonvo.generation_id': t.generationId ?? undefined, note: t.note, 'session.id': run.scanId },
      })),
  ])
}
