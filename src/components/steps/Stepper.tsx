import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { useT } from '../../i18n/useT'

/** Bottom dock: helper buttons on the left, Back + a big Next in thumb reach. */
export default function Stepper({
  stepIndex,
  count,
  writing,
  onStep,
  extra,
}: {
  stepIndex: number
  count: number
  writing?: boolean
  onStep: (i: number) => void
  extra?: ReactNode
}) {
  const t = useT()
  const last = stepIndex >= count - 1
  return (
    <div className="dock">
      {extra && <div className="dock-extra">{extra}</div>}
      <button className="btn ghost dock-back" onClick={() => onStep(stepIndex - 1)} disabled={stepIndex < 0} aria-label={t('back')}>
        <ArrowLeft aria-hidden />
      </button>
      <button className="btn primary dock-next" onClick={() => onStep(stepIndex + 1)} disabled={last || count === 0}>
        {count === 0 ? (
          writing ? t('writingSteps') : t('noSteps')
        ) : last ? (
          <>
            <Check aria-hidden /> {t('done')}
          </>
        ) : (
          <>
            {stepIndex < 0 ? t('start') : t('next')} <ArrowRight aria-hidden />
          </>
        )}
      </button>
    </div>
  )
}
