import { useEffect, useMemo, useState } from 'react'
import { getTranslation } from '../api'
import type { GuideTranslation } from '../shared/i18n'
import type { Analysis } from '../shared/types'
import { useLang } from './lang'

/** The guide text swapped into the analysis (same ids, order and geometry; only words change). */
function apply(a: Analysis, t: GuideTranslation): Analysis {
  if (t.steps.length !== a.steps.length) return a
  const names = new Map(t.parts.map((p) => [p.id, p.name]))
  return {
    ...a,
    objectName: t.objectName,
    summary: t.summary,
    tools: t.tools,
    safety: t.safety,
    parts: a.parts.map((p) => ({ ...p, name: names.get(p.id) ?? p.name })),
    steps: a.steps.map((s, i) => {
      const x = t.steps[i]
      return { ...s, title: x.title, disassembly: x.disassembly, assembly: x.assembly, caution: x.caution, tools: x.tools, group: s.group && x.group ? x.group : s.group, details: { disassembly: x.disassemblyDetails, assembly: x.assemblyDetails } }
    }),
  }
}

/**
 * The guide in the app's language. English is the original; other languages are fetched once the
 * steps are final (cached on the server) and shown when they arrive, English until then.
 */
export function useGuide(scanId: string, analysis: Analysis, ready: boolean) {
  const lang = useLang()
  const [got, setGot] = useState<{ key: string; t: GuideTranslation } | null>(null)
  const key = `${scanId}:${lang}`
  const want = lang !== 'en' && ready

  useEffect(() => {
    if (!want) return
    const ctrl = new AbortController()
    getTranslation(scanId, lang, ctrl.signal)
      .then((t) => setGot({ key, t }))
      .catch(() => {}) // stays in English
    return () => ctrl.abort()
    // Refetch when a step is rewritten (the server re-translates only then).
  }, [want, scanId, lang, key, analysis.steps])

  const t = got?.key === key && want ? got.t : null
  const guide = useMemo(() => (t ? apply(analysis, t) : analysis), [analysis, t])
  return { guide, translating: want && !t }
}
