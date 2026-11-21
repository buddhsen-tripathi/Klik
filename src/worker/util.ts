/** Small helpers shared by the API routes. */

export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export const fileUrl = (key: string | null) => (key ? `/api/files/${key}` : null)

export const parseJson = <T>(s: string | null, fallback: T): T => {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
