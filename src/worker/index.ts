import { Hono } from 'hono'
import { exportRequestTrace, installFetchTracing, RequestTrace, runTraced } from './tracing'
import { planSteps } from '../shared/plan'
import type { Analysis, ModelFile, Recovery, ScanPhoto, ScanSummary, ScanView, Timing } from '../shared/types'
import { checkStep } from './decisions'
import { identifyFrame } from './gemini'
import assist from './routes/assist'
import feedback from './routes/feedback'
import { ALLOWED_TYPES, fileUrl, parseJson, toBase64 } from './util'

export { ScanWorkflow } from './workflow'

const MAX_PHOTO_BYTES = 8 * 1024 * 1024
const MAX_PHOTOS = 6
const MAX_FRAME_BYTES = 1024 * 1024

const app = new Hono<{ Bindings: Env }>()

// Progress checks (re-plan after mistakes) and the voice agent.
// Clonvo Traces: every API request that does real work (anything but a plain read) is one trace.
installFetchTracing()
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
app.use('/api/*', async (c, next) => {
  if (!c.env.CLONVO_API_KEY || c.req.path === '/api/telemetry') return next()
  const sessionId = c.req.path.match(UUID)?.[0] ?? null
  const trace = new RequestTrace(`${c.req.method} ${c.req.path.replace(UUID, ':id')}`, sessionId)
  await runTraced(trace, next)
  // Polling reads (GET with no outbound calls) aren't worth an event each.
  if (c.req.method === 'GET' && trace.spans.length === 0) return
  c.executionCtx.waitUntil(exportRequestTrace(c.env.CLONVO_API_KEY, trace, c.res.status))
})
app.route('/api', assist)
app.route('/api', feedback)

// Upload 1-6 photos of one object (different angles) and start the scan pipeline.
// Form fields: photo (repeated), width (repeated), height (repeated), hint (optional).
app.post('/api/scans', async (c) => {
  const form = await c.req.formData()
  const photos = form.getAll('photo')
  const widths = form.getAll('width').map(Number)
  const heights = form.getAll('height').map(Number)
  const hint = String(form.get('hint') ?? '').trim().slice(0, 200) || null

  if (photos.length === 0) return c.json({ error: 'at least one photo is required' }, 400)
  if (photos.length > MAX_PHOTOS) return c.json({ error: `at most ${MAX_PHOTOS} photos per scan` }, 400)
  for (const [i, photo] of photos.entries()) {
    if (!(photo instanceof File)) return c.json({ error: `photo ${i} is not a file` }, 400)
    if (!ALLOWED_TYPES.includes(photo.type)) return c.json({ error: `unsupported image type ${photo.type}` }, 400)
    if (photo.size > MAX_PHOTO_BYTES) return c.json({ error: `photo ${i} is larger than 8 MB` }, 400)
    if (!(widths[i] > 0 && heights[i] > 0)) return c.json({ error: `width and height are required for photo ${i}` }, 400)
  }
  if (!c.env.GEMINI_API_KEY) return c.json({ error: 'GEMINI_API_KEY is not configured on the server' }, 500)

  const id = crypto.randomUUID()
  const files = photos as File[]
  const keys = files.map((_, i) => `scans/${id}/photo-${i}`)
  await Promise.all(files.map((f, i) => c.env.FILES.put(keys[i], f.stream(), { httpMetadata: { contentType: f.type } })))

  const w = (i: number) => Math.round(widths[i])
  const h = (i: number) => Math.round(heights[i])
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO scans (id, created_at, stage, hint, photo_key, photo_type, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, Date.now(), 'queued', hint, keys[0], files[0].type, w(0), h(0)),
    ...files.map((f, i) =>
      c.env.DB.prepare('INSERT INTO scan_photos (scan_id, idx, photo_key, photo_type, width, height) VALUES (?, ?, ?, ?, ?, ?)').bind(
        id,
        i,
        keys[i],
        f.type,
        w(i),
        h(i),
      ),
    ),
  ])
  await c.env.SCAN_WORKFLOW.create({ id, params: { scanId: id } })

  return c.json({ id }, 201)
})

/** Scanned meshes: per-part files from parallel SAM 3D jobs, or the one combined file on older scans. */
function modelFiles(row: Record<string, any>): ModelFile[] {
  const files = parseJson<(Omit<ModelFile, 'url'> & { key: string })[]>(row.model_files, [])
  if (files.length) return files.map(({ key, ...f }) => ({ ...f, url: fileUrl(key)! }))
  if (!row.model_key) return []
  return [{ url: fileUrl(row.model_key)!, partIds: parseJson<string[]>(row.model_part_ids, []), layouts: [], bytes: row.model_bytes }]
}

// Full scan, polled by the scan page.
app.get('/api/scans/:id', async (c) => {
  const id = c.req.param('id')
  const [row, photos] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM scans WHERE id = ?').bind(id).first<Record<string, any>>(),
    c.env.DB.prepare('SELECT photo_key, width, height FROM scan_photos WHERE scan_id = ? ORDER BY idx').bind(id).all<Record<string, any>>(),
  ])
  if (!row) return c.json({ error: 'not found' }, 404)

  const view: ScanView = {
    id: row.id,
    createdAt: row.created_at,
    stage: row.stage,
    photos: photos.results.map((p): ScanPhoto => ({ url: fileUrl(p.photo_key)!, width: p.width, height: p.height })),
    modelPhotoIndex: row.model_photo_index ?? 0,
    hint: row.hint,
    analysis: parseJson(row.analysis, null),
    modelUrl: fileUrl(row.model_key),
    modelBytes: row.model_bytes,
    modelPartIds: parseJson<string[]>(row.model_part_ids, []),
    error: row.error,
    modelError: row.model_error,
    progress: parseJson(row.progress, null),
    modelFiles: modelFiles(row),
    timings: parseJson<Timing[]>(row.timings, []),
    recovery: parseJson(row.recovery, null),
  }
  return c.json(view)
})

// Short statuses: ?ids=a,b,c for the background tray, otherwise the 20 most recent.
app.get('/api/scans', async (c) => {
  const ids = (c.req.query('ids') ?? '').split(',').filter(Boolean).slice(0, 30)
  const select = `SELECT id, created_at, stage, hint, photo_key, json_extract(analysis, '$.objectName') AS object_name FROM scans`
  const stmt = ids.length
    ? c.env.DB.prepare(`${select} WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids)
    : c.env.DB.prepare(`${select} ORDER BY created_at DESC LIMIT 20`)
  const { results } = await stmt.all<Record<string, any>>()
  return c.json(
    results.map(
      (r): ScanSummary => ({
        id: r.id,
        createdAt: r.created_at,
        stage: r.stage,
        photoUrl: fileUrl(r.photo_key),
        objectName: r.object_name,
        hint: r.hint,
      }),
    ),
  )
})

// What's in the live camera frame? Body: a small JPEG (the app sends ~512 px).
app.post('/api/identify', async (c) => {
  if (!c.env.GEMINI_API_KEY) return c.json({ error: 'GEMINI_API_KEY is not configured on the server' }, 500)
  const type = c.req.header('content-type') ?? ''
  if (!ALLOWED_TYPES.includes(type)) return c.json({ error: 'send the frame as image/jpeg' }, 400)
  const buf = await c.req.arrayBuffer()
  if (buf.byteLength === 0 || buf.byteLength > MAX_FRAME_BYTES) return c.json({ error: 'frame must be under 1 MB' }, 400)
  const result = await identifyFrame({
    apiKey: c.env.GEMINI_API_KEY,
    model: c.env.IDENTIFY_MODEL,
    image: { base64: toBase64(buf), mimeType: type },
  })
  return c.json(result)
})

// Live step check: is the current step done in this camera frame? (Decisions API, ~0.5 s)
// Body: a small JPEG. Query: step = index in the order the user follows, mode = disassemble | assemble.
app.post('/api/scans/:id/check', async (c) => {
  const mode = c.req.query('mode') === 'assemble' ? 'assemble' : 'disassemble'
  const index = Number(c.req.query('step'))
  const type = c.req.header('content-type') ?? ''
  if (!ALLOWED_TYPES.includes(type)) return c.json({ error: 'send the frame as image/jpeg' }, 400)
  const buf = await c.req.arrayBuffer()
  if (buf.byteLength === 0 || buf.byteLength > MAX_FRAME_BYTES) return c.json({ error: 'frame must be under 1 MB' }, 400)

  const row = await c.env.DB.prepare('SELECT analysis, recovery FROM scans WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ analysis: string | null; recovery: string | null }>()
  const analysis = parseJson<Analysis | null>(row?.analysis ?? null, null)
  if (!analysis) return c.json({ error: 'scan has no steps yet' }, 404)
  // Same ordering as the app: assembly is the disassembly list reversed; ?plan=1 = the fix plan.
  const ordered = mode === 'disassemble' ? analysis.steps : [...analysis.steps].reverse()
  const recovery = c.req.query('plan') === '1' ? parseJson<Recovery | null>(row?.recovery ?? null, null) : null
  const steps = recovery && recovery.mode === mode ? planSteps(ordered, recovery) : ordered
  const step = steps[index]
  if (!Number.isInteger(index) || !step) return c.json({ error: 'no such step' }, 400)

  const result = await checkStep({
    apiKey: c.env.GEMINI_API_KEY,
    frame: { base64: toBase64(buf), mimeType: type },
    analysis,
    step,
    mode,
  })
  return c.json(result)
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
