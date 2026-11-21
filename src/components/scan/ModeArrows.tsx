import { ArrowDown, ArrowUp } from 'lucide-react'
import type { Mode } from '../../explode'
import { useT } from '../../i18n/useT'

/** Up = take apart, down = put together. Sits on the 3D view, under the scan switch. */
export default function ModeArrows({ mode, onMode }: { mode: Mode; onMode: (m: Mode) => void }) {
  const t = useT()
  const options = [
    { value: 'disassemble' as const, label: t('takeApart'), Icon: ArrowUp },
    { value: 'assemble' as const, label: t('putTogether'), Icon: ArrowDown },
  ]
  return (
    <div className="mode-arrows" role="radiogroup" aria-label={`${t('takeApart')} / ${t('putTogether')}`}>
      {options.map(({ value, label, Icon }) => (
        <button key={value} role="radio" aria-checked={mode === value} aria-label={label} title={label} className={mode === value ? 'on' : ''} onClick={() => onMode(value)}>
          <Icon aria-hidden />
          {mode === value && <span className="mode-label">{label}</span>}
        </button>
      ))}
    </div>
  )
}
