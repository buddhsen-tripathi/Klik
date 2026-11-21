import { useSyncExternalStore } from 'react'
import { isLang, type Lang } from '../shared/i18n'

/** The app's language: picked in the top bar, otherwise the phone's language if we support it. */
function initial(): Lang {
  try {
    const saved = localStorage.getItem('lang')
    if (isLang(saved)) return saved
  } catch {
    // Storage blocked: fall through to the browser language.
  }
  const browser = (navigator.language || 'en').slice(0, 2).toLowerCase()
  return isLang(browser) ? browser : 'en'
}

let lang: Lang = initial()
const listeners = new Set<() => void>()

export const getLang = () => lang
export function setLang(l: Lang) {
  lang = l
  try {
    localStorage.setItem('lang', l)
  } catch {
    // Not saved; fine for this visit.
  }
  document.documentElement.lang = l
  listeners.forEach((f) => f())
}
document.documentElement.lang = lang

export const useLang = () =>
  useSyncExternalStore(
    (f) => {
      listeners.add(f)
      return () => listeners.delete(f)
    },
    () => lang,
  )
