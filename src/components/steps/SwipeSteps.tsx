import { useRef, useState, type ReactNode } from 'react'

/** Swipe left / right on the step card for next / previous, with a short slide-in. */
export default function SwipeSteps({ stepIndex, count, onStep, children }: { stepIndex: number; count: number; onStep: (i: number) => void; children: ReactNode }) {
  const start = useRef<{ x: number; y: number } | null>(null)
  // Which way the last change went, for the slide direction (state adjusted during render, React's pattern).
  const [last, setLast] = useState(stepIndex)
  const [dir, setDir] = useState<'next' | 'prev' | null>(null)
  if (stepIndex !== last) {
    setDir(stepIndex > last ? 'next' : 'prev')
    setLast(stepIndex)
  }
  return (
    <div
      className="sheet-main"
      onPointerDown={(e) => (start.current = { x: e.clientX, y: e.clientY })}
      onPointerUp={(e) => {
        const s = start.current
        start.current = null
        if (!s || count === 0) return
        const dx = e.clientX - s.x
        const dy = e.clientY - s.y
        if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
        if (dx < 0 && stepIndex < count - 1) onStep(stepIndex + 1)
        if (dx > 0 && stepIndex > -1) onStep(stepIndex - 1)
      }}
      onPointerCancel={() => (start.current = null)}
    >
      <div key={stepIndex} className={dir ? `slide-in-${dir}` : undefined}>
        {children}
      </div>
    </div>
  )
}
