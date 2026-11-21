/**
 * One voice session's events, sent to the server at the end (it forwards them to Clonvo Traces).
 * Uses sendBeacon so it still arrives when the page is closing.
 */
export interface SessionEvent {
  name: string
  start: number
  end: number
  ok?: boolean
  attributes?: Record<string, string | number | boolean>
}

const MAX_EVENTS = 300

export function createSessionLog(scanId: string, name: string) {
  const start = Date.now()
  const events: SessionEvent[] = []
  let sent = false
  return {
    event(e: SessionEvent) {
      if (events.length < MAX_EVENTS) events.push(e)
    },
    get count() {
      return events.length
    },
    flush(attributes: Record<string, string | number | boolean> = {}) {
      if (sent || events.length === 0) return
      sent = true
      const body = JSON.stringify({ scanId, name, start, end: Date.now(), attributes, events })
      const blob = new Blob([body], { type: 'application/json' })
      if (!navigator.sendBeacon?.('/api/telemetry', blob)) void fetch('/api/telemetry', { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {})
    },
  }
}
export type SessionLog = ReturnType<typeof createSessionLog>
