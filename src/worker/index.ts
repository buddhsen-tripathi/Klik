import { Hono } from 'hono'
import type { ScanView } from '../shared/types'

export { ScanWorkflow } from './workflow'

const MAX_PHOTO_BYTES = 8 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const app = new Hono<{ Bindings: Env }>()

const fileUrl = (key: string | null) => (key ? `/api/files/${key}` : null)
const parseJson = <T>(s: string | null, fallback: T): T => {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

// Upload a photo and start the scan pipeline.
app.post('/api/scans', async (c) => {
  const form = await c.req.formData()
  const photo = form.get('photo')
  const width = Number(form.get('width'))
  const height = Number(form.get('height'))
  const hint = String(form.get('hint') ?? '').trim().slice(0, 200) || null

  if (!(photo instanceof File)) return c.json({ error: 'photo is required' }, 400)
  if (!ALLOWED_TYPES.includes(photo.type)) return c.json({ error: `unsupported image type ${photo.type}` }, 400)
  if (photo.size > MAX_PHOTO_BYTES) return c.json({ error: 'photo is larger than 8 MB' }, 400)
  if (!(width > 0 && height > 0)) return c.json({ error: 'width and height are required' }, 400)
  if (!c.env.GEMINI_API_KEY) return c.json({ error: 'GEMINI_API_KEY is not configured on the server' }, 500)

  const id = crypto.randomUUID()
  const photoKey = `scans/${id}/photo`
  await c.env.FILES.put(photoKey, photo.stream(), { httpMetadata: { contentType: photo.type } })
  await c.env.DB.prepare(
    'INSERT INTO scans (id, created_at, stage, hint, photo_key, photo_type, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, Date.now(), 'queued', hint, photoKey, photo.type, Math.round(width), Math.round(height))
    .run()
  await c.env.SCAN_WORKFLOW.create({ id, params: { scanId: id } })

  return c.json({ id }, 201)
})

// Poll a scan.
app.get('/api/scans/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM scans WHERE id = ?').bind(c.req.param('id')).first<Record<string, any>>()
  if (!row) return c.json({ error: 'not found' }, 404)

  const view: ScanView = {
    id: row.id,
    createdAt: row.created_at,
    stage: row.stage,
    photoUrl: fileUrl(row.photo_key)!,
    width: row.width,
    height: row.height,
    hint: row.hint,
    analysis: parseJson(row.analysis, null),
    modelUrl: fileUrl(row.model_key),
    modelBytes: row.model_bytes,
    modelPartIds: parseJson<string[]>(row.model_part_ids, []),
    error: row.error,
    modelError: row.model_error,
  }
  return c.json(view)
})

// Recent scans for the home screen.
app.get('/api/scans', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, created_at, stage, photo_key, json_extract(analysis, '$.objectName') AS object_name
     FROM scans ORDER BY created_at DESC LIMIT 20`,
  ).all<Record<string, any>>()
  return c.json(
    results.map((r) => ({ id: r.id, createdAt: r.created_at, stage: r.stage, photoUrl: fileUrl(r.photo_key), objectName: r.object_name })),
  )
})

// Serve photos and GLBs from R2. Keys are random UUID paths, so they are not guessable.
app.get('/api/files/:key{scans/.+}', async (c) => {
  const obj = await c.env.FILES.get(c.req.param('key'))
  if (!obj) return c.json({ error: 'not found' }, 404)
  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('etag', obj.httpEtag)
  headers.set('cache-control', 'public, max-age=31536000, immutable')
  return new Response(obj.body, { headers })
})

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: err.message }, 500)
})

export default app
