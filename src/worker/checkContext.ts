import type { Analysis, Recovery } from '../shared/types'
import { parseJson } from './util'

// The live check runs every ~1.2 s per camera: keep the parsed plan for a few seconds instead of
// reading and parsing it from D1 on every frame. Saves in this isolate clear it right away; other
// isolates pick up a rewritten step or new fix plan within TTL.
const TTL = 10_000
const cache = new Map<string, { at: number; analysis: Analysis | null; recovery: Recovery | null }>()

export async function checkContext(db: D1Database, id: string) {
  const hit = cache.get(id)
  if (hit && Date.now() - hit.at < TTL) return hit
  const row = await db.prepare('SELECT analysis, recovery FROM scans WHERE id = ?').bind(id).first<{ analysis: string | null; recovery: string | null }>()
  const ctx = { at: Date.now(), analysis: parseJson<Analysis | null>(row?.analysis ?? null, null), recovery: parseJson<Recovery | null>(row?.recovery ?? null, null) }
  if (cache.size > 200) cache.clear()
  cache.set(id, ctx)
  return ctx
}

export const forgetCheckContext = (id: string) => cache.delete(id)
