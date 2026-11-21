/**
 * Parse JSON that is still being streamed, e.g. `{"a":1,"parts":[{"id":"x"},{"id":"y","na`.
 * Cuts back to the last complete value, closes the open brackets and parses that.
 * Returns null if nothing usable has arrived yet.
 */
export function parsePartialJson(text: string): any {
  const stack: string[] = []
  let inString = false
  let escaped = false
  // Positions just after a complete value at some depth, with the closers needed there.
  let lastCut = -1
  let lastCutStack: string[] = []

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') {
        inString = false
        // A finished string is a complete value only when it isn't an object key.
        const next = text.slice(i + 1).trimStart()[0]
        if (next !== ':') {
          lastCut = i + 1
          lastCutStack = [...stack]
        }
      }
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') {
      stack.pop()
      lastCut = i + 1
      lastCutStack = [...stack]
    } else if (ch === ',') {
      // Value before the comma is complete (numbers, booleans, null end here).
      lastCut = i
      lastCutStack = [...stack]
    }
  }
  if (stack.length === 0 && !inString) {
    try {
      return JSON.parse(text)
    } catch {}
  }
  if (lastCut < 0) return null
  const closers = lastCutStack
    .slice()
    .reverse()
    .map((c) => (c === '{' ? '}' : ']'))
    .join('')
  try {
    return JSON.parse(text.slice(0, lastCut).replace(/,\s*$/, '') + closers)
  } catch {
    return null
  }
}
