import type { ReactNode } from 'react'

/** Small pill label with an optional icon, e.g. a tool or a fastener. */
export function Chip({ icon, variant, children }: { icon?: ReactNode; variant?: 'hardware'; children: ReactNode }) {
  return (
    <span className={`chip icon-text${variant ? ` ${variant}` : ''}`}>
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
