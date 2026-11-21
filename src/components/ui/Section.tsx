import type { ReactNode } from 'react'

/** A titled block inside a card. Hidden when `show` is false (e.g. an empty list). */
export function Section({ title, show = true, children }: { title: string; show?: boolean; children: ReactNode }) {
  if (!show) return null
  return (
    <>
      <h3>{title}</h3>
      {children}
    </>
  )
}

/** Titled bullet list; hidden when there are no items. */
export function BulletSection({ title, items }: { title: string; items: string[] }) {
  return (
    <Section title={title} show={items.length > 0}>
      <ul className="list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </Section>
  )
}

/** Collapsible card ("All steps", "What the AI saw"). */
export function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="card">
      <summary>{summary}</summary>
      {children}
    </details>
  )
}
