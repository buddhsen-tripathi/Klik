import { useLang } from './lang'
import { translate, type StringKey } from './strings'

/** t('next'), t('stepOf', { n: 2, count: 6 }) in the current language; re-renders on change. */
export function useT() {
  const lang = useLang()
  return (key: StringKey, vars?: Record<string, string | number>) => translate(lang, key, vars)
}
