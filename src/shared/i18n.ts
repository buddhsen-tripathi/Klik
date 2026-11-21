/** Languages the app offers. The guide itself is translated by Gemini, so any of these works for it. */
export const LANGUAGES = [
  { code: 'en', name: 'English', english: 'English' },
  { code: 'es', name: 'Español', english: 'Spanish' },
  { code: 'fr', name: 'Français', english: 'French' },
  { code: 'de', name: 'Deutsch', english: 'German' },
  { code: 'pt', name: 'Português', english: 'Portuguese' },
  { code: 'hi', name: 'हिन्दी', english: 'Hindi' },
  { code: 'ja', name: '日本語', english: 'Japanese' },
  { code: 'zh', name: '中文', english: 'Simplified Chinese' },
] as const

export type Lang = (typeof LANGUAGES)[number]['code']
export const isLang = (v: unknown): v is Lang => LANGUAGES.some((l) => l.code === v)

/** The guide's text in another language (same order and lengths as the English it came from). */
export interface GuideTranslation {
  objectName: string
  summary: string
  tools: string[]
  safety: string[]
  parts: { id: string; name: string }[]
  steps: {
    title: string
    disassembly: string
    assembly: string
    disassemblyDetails: string[]
    assemblyDetails: string[]
    caution: string | null
    tools: string[]
    /** Subassembly name shown above the step (older translations don't have it). */
    group?: string | null
  }[]
}
