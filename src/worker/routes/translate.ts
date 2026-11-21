import { Hono } from 'hono'
import { isLang } from '../../shared/i18n'
import type { Analysis } from '../../shared/types'
import { getOrTranslate } from '../translate'
import { parseJson } from '../util'

const translate = new Hono<{ Bindings: Env }>()

// The guide in another language: cached per scan and language, redone when the English changes.
translate.get('/scans/:id/translation', async (c) => {
  const id = c.req.param('id')
  const lang = c.req.query('lang')
  if (!isLang(lang) || lang === 'en') return c.json({ error: 'unsupported language' }, 400)
  const row = await c.env.DB.prepare('SELECT stage, analysis FROM scans WHERE id = ?').bind(id).first<{ stage: string; analysis: string | null }>()
  const analysis = parseJson<Analysis | null>(row?.analysis ?? null, null)
  if (!analysis || row?.stage === 'analyzing') return c.json({ error: 'the guide is not ready yet' }, 409)

  return c.json(await getOrTranslate(c.env, id, analysis, lang))
})

export default translate
