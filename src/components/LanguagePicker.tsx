import { Languages } from 'lucide-react'
import { setLang, useLang } from '../i18n/lang'
import { LANGUAGES, isLang } from '../shared/i18n'
import { useT } from '../i18n/useT'

/** Top-bar language switch: app text, the guide and the voice helper follow it. */
export default function LanguagePicker({ compact }: { compact?: boolean }) {
  const lang = useLang()
  const t = useT()
  return (
    <label className={`lang-picker${compact ? ' compact' : ''}`} title={t('language')}>
      <Languages aria-hidden />
      <select value={lang} aria-label={t('language')} onChange={(e) => isLang(e.target.value) && setLang(e.target.value)}>
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {compact ? l.code.toUpperCase() : l.name}
          </option>
        ))}
      </select>
    </label>
  )
}
