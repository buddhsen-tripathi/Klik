import type { ScanView } from './shared/types'

export interface ScanSummary {
  id: string
  createdAt: number
  stage: ScanView['stage']
  photoUrl: string
  objectName: string | null
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`)
  return body as T
}

export const getScan = (id: string) => fetch(`/api/scans/${id}`).then((r) => json<ScanView>(r))
export const listScans = () => fetch('/api/scans').then((r) => json<ScanSummary[]>(r))

/**
 * Shrink the photo before upload: phone photos are 3-12 MB, and Gemini and SAM 3D
 * don't need more than ~1600 px. Also bakes in EXIF rotation so boxes line up.
 */
export async function preparePhoto(file: File, maxSide = 1600): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode photo'))), 'image/jpeg', 0.88),
  )
  return { blob, width, height }
}

export async function createScan(file: File, hint: string): Promise<string> {
  const { blob, width, height } = await preparePhoto(file)
  const form = new FormData()
  form.set('photo', new File([blob], 'photo.jpg', { type: 'image/jpeg' }))
  form.set('width', String(width))
  form.set('height', String(height))
  if (hint.trim()) form.set('hint', hint.trim())
  const { id } = await json<{ id: string }>(await fetch('/api/scans', { method: 'POST', body: form }))
  return id
}
