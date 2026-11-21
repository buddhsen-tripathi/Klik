import type { ReactNode } from 'react'

/** Small pill label with an optional icon, e.g. a tool or a fastener. */
export function Chip({ icon, variant, children, onClick }: { icon?: ReactNode; variant?: 'hardware'; children: ReactNode; onClick?: () => void }) {
  const cls = `chip icon-text${variant ? ` ${variant}` : ''}`
  if (onClick)
    return (
      <button className={`${cls} chip-btn`} onClick={onClick}>
        {icon}
        {children}
      </button>
    )
  return (
    <span className={cls}>
      {icon}
      {children}
    </span>
  )
}

/** A wrapping row of chips. Renders nothing when empty. */
export function ChipRow({ children, empty }: { children: ReactNode; empty?: boolean }) {
  if (empty) return null
  return <div className="chips">{children}</div>
}
