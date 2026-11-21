/** KLIK mark (a "K" whose arm clicks into the bar) plus the wordmark. */
export function KlikMark({ size = 26 }: { size?: number }) {
  return (
    <svg className="klik-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--primary)" />
      <rect x="8" y="7" width="5" height="18" rx="2" fill="var(--primary-foreground)" />
      <path d="M23.5 7.5 15.5 16l8 8.5" fill="none" stroke="var(--primary-foreground)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function Logo({ light }: { light?: boolean }) {
  return (
    <a href="#/" className={`brand${light ? ' light' : ''}`} aria-label="KLIK home">
      <KlikMark />
      <span className="brand-word">KLIK</span>
    </a>
  )
}
