import { getLang } from './i18n/lang'
import type { GuideTranslation, Lang } from './shared/i18n'
import type { Identification, Recovery, ScanSummary, ScanView, ShopProduct, Step } from './shared/types'

/** A photo ready to upload. */
export interface Shot {
  blob: Blob
  width: number
  height: number
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`)
  return body as T
}

export const getScan = (id: string) => fetch(`/api/scans/${id}`).then((r) => json<ScanView>(r))
export const listScans = () => fetch('/api/scans').then((r) => json<ScanSummary[]>(r))
export const getScanSummaries = (ids: string[]) =>
  fetch(`/api/scans?ids=${ids.map(encodeURIComponent).join(',')}`).then((r) => json<ScanSummary[]>(r))

export async function identify(frame: Blob, signal?: AbortSignal): Promise<Identification> {
  const res = await fetch('/api/identify', { method: 'POST', headers: { 'content-type': frame.type }, body: frame, signal })
  return json<Identification>(res)
}

/** Live step check (Decisions API): probability the step is done, and that the object is in view. */
export async function checkStep(scanId: string, frame: Blob, step: number, mode: 'disassemble' | 'assemble', signal?: AbortSignal, plan = false) {
  const res = await fetch(`/api/scans/${scanId}/check?step=${step}&mode=${mode}${plan ? '&plan=1' : ''}`, {
    method: 'POST',
    headers: { 'content-type': frame.type },
    body: frame,
    signal,
  })
  return json<{ done: number; inView: number }>(res)
}

export async function createScan(shots: Shot[], hint: string): Promise<string> {
  const form = new FormData()
  shots.forEach((s, i) => {
    form.append('photo', new File([s.blob], `photo-${i}.jpg`, { type: s.blob.type || 'image/jpeg' }))
    form.append('width', String(s.width))
    form.append('height', String(s.height))
  })
  if (hint.trim()) form.set('hint', hint.trim())
  form.set('lang', getLang())
  const { id } = await json<{ id: string }>(await fetch('/api/scans', { method: 'POST', body: form }))
  return id
}

/** Draw a video frame or image into a JPEG no bigger than maxSide on its longest edge. */
export async function toJpeg(
  source: HTMLVideoElement | ImageBitmap,
  maxSide: number,
  quality = 0.88,
): Promise<Shot> {
  const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.width
  const sh = source instanceof HTMLVideoElement ? source.videoHeight : source.height
  const scale = Math.min(1, maxSide / Math.max(sw, sh))
  const width = Math.round(sw * scale)
  const height = Math.round(sh * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(source, 0, 0, width, height)
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode photo'))), 'image/jpeg', quality),
  )
  return { blob, width, height }
}

/** Library photos: shrink to 1600 px and bake in EXIF rotation so Gemini's boxes line up. */
export async function prepareFile(file: File): Promise<Shot> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    return await toJpeg(bitmap, 1600)
  } finally {
    bitmap.close()
  }
}

/** "Check my progress": photo of the build as it is now → step status, mistakes, fix steps. */
export async function checkProgress(scanId: string, photo: Blob, mode: 'disassemble' | 'assemble', note: string | null): Promise<Recovery> {
  const q = new URLSearchParams({ mode, ...(note ? { note } : {}) })
  const res = await fetch(`/api/scans/${scanId}/progress?${q}`, { method: 'POST', headers: { 'content-type': photo.type || 'image/jpeg' }, body: photo })
  return json<Recovery>(res)
}

/** Drop the fix plan and go back to the full guide. */
export const clearRecovery = (scanId: string) => fetch(`/api/scans/${scanId}/recovery`, { method: 'DELETE' })

/** Short-lived Gemini Live token for the voice agent. */
export const liveToken = () => fetch('/api/live/token', { method: 'POST' }).then((r) => json<{ token: string; model: string }>(r))

/** A problem with a guide step (index into analysis.steps). Returns the rewritten step if this report triggered one. */
export const reportStepProblem = (scanId: string, index: number, kind: 'user_says_wrong' | 'coach_warning', problem: string) =>
  fetch(`/api/scans/${scanId}/steps/${index}/feedback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, problem }) }).then((r) =>
    json<{ recorded: boolean; revised: Step | null; reasons: string[]; mismatch: boolean }>(r),
  )

/** Voice agent's web search (cited answer). */
export const agentSearch = (question: string) =>
  fetch('/api/agent/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }) }).then((r) =>
    json<{ answer: string; sources: { title: string; url: string }[] }>(r),
  )

export interface ShopResult {
  products: ShopProduct[]
  warnings: string[]
}
/** Products from Shop (shop.dev) for a tool, a spare fastener or a replacement part. */
export const searchShop = (query: string, signal?: AbortSignal) =>
  fetch(`/api/shop?q=${encodeURIComponent(query)}`, { signal }).then((r) => json<ShopResult>(r))

/** Shop's "Review and pay" page for one product. */
export const startCheckout = (shop: string, variantId: string) =>
  fetch('/api/shop/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shop, variantId }) }).then((r) =>
    json<{ url: string }>(r),
  )

/** The guide in another language (translated once per scan and language, then cached). */
export const getTranslation = (scanId: string, lang: Lang, signal?: AbortSignal) =>
  fetch(`/api/scans/${scanId}/translation?lang=${lang}`, { signal }).then((r) => json<GuideTranslation>(r))
