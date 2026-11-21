import type { Analysis } from '../shared/types'
import { LANGUAGES, type GuideTranslation, type Lang } from '../shared/i18n'
import { generateJson } from './gemini'
import { parseJson } from './util'

/**
 * Translate a scan's guide. Guides are written in English once (so feedback-driven rewrites and
 * the reviewer work on one version); each language is a translation of that, cached in D1 and
 * redone only when the English changes.
 */

/** The text that gets translated, in a fixed shape (also what the hash covers). */
export function guideText(a: Analysis): GuideTranslation {
  return {
    objectName: a.objectName,
    summary: a.summary,
    tools: a.tools,
    safety: a.safety,
    parts: a.parts.map((p) => ({ id: p.id, name: p.name })),
    steps: a.steps.map((s) => ({
      title: s.title,
      disassembly: s.disassembly,
      assembly: s.assembly,
      disassemblyDetails: s.details?.disassembly ?? [],
      assemblyDetails: s.details?.assembly ?? [],
      caution: s.caution,
      tools: s.tools,
      group: s.group ?? null,
    })),
  }
}

export function hashText(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36) + s.length.toString(36)
}

const strs = { type: 'array', items: { type: 'string' } }
const SCHEMA = {
  type: 'object',
  properties: {
    objectName: { type: 'string' },
    summary: { type: 'string' },
    tools: strs,
    safety: strs,
    parts: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } }, required: ['id', 'name'] } },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          disassembly: { type: 'string' },
          assembly: { type: 'string' },
          disassemblyDetails: strs,
          assemblyDetails: strs,
          caution: { type: ['string', 'null'] },
          tools: strs,
          group: { type: ['string', 'null'] },
        },
        required: ['title', 'disassembly', 'assembly', 'disassemblyDetails', 'assemblyDetails', 'caution', 'tools', 'group'],
      },
    },
  },
  required: ['objectName', 'summary', 'tools', 'safety', 'parts', 'steps'],
}

export async function translateGuide(opts: { apiKey: string; model: string; analysis: Analysis; lang: Lang }): Promise<GuideTranslation> {
  const source = guideText(opts.analysis)
  const language = LANGUAGES.find((l) => l.code === opts.lang)!.english
  const out = (await generateJson({
    apiKey: opts.apiKey,
    model: opts.model,
    images: [],
    mediaResolution: 'MEDIA_RESOLUTION_LOW',
    thinkingLevel: 'LOW',
    text: `Translate this repair guide from English into ${language}, for someone doing the work with the object in front of them: clear, plain, natural ${language}, imperative instructions as in a good printed manual.
Rules:
- Keep every {part_id} token exactly as written (they become numbered markers), and keep part "id" values unchanged.
- Keep specs, sizes, units and tool sizes as written (M3 x 6 mm, Phillips #1, 4 mm Allen key, 2 Nm); translate the words around them.
- Same number of items in every list, in the same order. caution and group stay null where they are null.
- Brand and model names stay as they are.

${JSON.stringify(source)}`,
    schema: SCHEMA,
  })) as GuideTranslation
  // A translation that lost or reordered steps would point at the wrong parts: refuse it.
  if (out?.steps?.length !== source.steps.length || out.parts?.length !== source.parts.length) throw new Error('translation came back incomplete')
  return out
}

/** The cached translation if it matches the current English, otherwise a fresh one (then cached). */
export async function getOrTranslate(env: Env, scanId: string, analysis: Analysis, lang: Lang): Promise<GuideTranslation & { hash: string }> {
  const hash = hashText(JSON.stringify(guideText(analysis)))
  const cached = await env.DB.prepare('SELECT source_hash, content FROM translations WHERE scan_id = ? AND lang = ?').bind(scanId, lang).first<{ source_hash: string; content: string }>()
  const hit = cached?.source_hash === hash ? parseJson<GuideTranslation | null>(cached.content, null) : null
  if (hit) return { hash, ...hit }
  const out = await translateGuide({ apiKey: env.GEMINI_API_KEY, model: env.IDENTIFY_MODEL || env.GEMINI_MODEL, analysis, lang })
  await env.DB.prepare('INSERT OR REPLACE INTO translations (scan_id, lang, source_hash, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(scanId, lang, hash, JSON.stringify(out), Date.now())
    .run()
  return { hash, ...out }
}
