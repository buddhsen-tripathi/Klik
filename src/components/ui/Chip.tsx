import type { ReactNode } from 'react'

/** Small pill label, e.g. a tool (🔧) or a fastener (🔩). */
export function Chip({ icon, variant, children }: { icon?: string; variant?: 'hardware'; children: ReactNode }) {
  return (
    <span className={`chip${variant ? ` ${variant}` : ''}`}>
      {icon && `${icon} `}
      {children}
    </span>
  )
}

/** A wrapping row of chips. Renders nothing when empty. */
export function ChipRow({ children, empty }: { children: ReactNode; empty?: boolean }) {
  if (empty) return null
  return <div className="chips">{children}</div>
}
