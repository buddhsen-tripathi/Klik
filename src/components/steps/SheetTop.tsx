import { useEffect, useRef, type ReactNode } from 'react'

type Snap = 'peek' | 'half' | 'full'
const PHONE = '(max-width: 899px)'
const PEEK = 230

/**
 * Phones: the steps panel is a pull-up sheet over the 3D view (peek / half / full). Drag the top
 * bar or tap it. The 3D view resizes to the space above the sheet (never smaller than at "half"),
 * so the model is never hidden behind it. Sizes are written straight to CSS, no re-renders.
 * `collapseKey`: change it to drop the sheet to "peek" (e.g. to show a part in 3D).
 */
export default function SheetTop({ children, collapseKey }: { children: ReactNode; collapseKey?: unknown }) {
  const el = useRef<HTMLDivElement>(null)
  const snap = useRef<Snap>('half')
  const drag = useRef<{ y: number; h: number; t: number; moved: boolean } | null>(null)

  const parts = () => {
    const panel = el.current?.closest<HTMLElement>('.panel')
    const bench = el.current?.closest<HTMLElement>('.workbench')
    return panel && bench ? { panel, bench, H: bench.clientHeight } : null
  }
  const heights = (H: number) => ({ peek: Math.min(PEEK, H * 0.4), half: Math.round(H * 0.55), full: H - 12 })

  const apply = (to: Snap) => {
    const p = parts()
    if (!p) return
    snap.current = to
    if (!matchMedia(PHONE).matches) {
      p.panel.style.removeProperty('height')
      p.bench.style.removeProperty('--viewer-h')
      return
    }
    const hs = heights(p.H)
    p.panel.style.height = `${hs[to]}px`
    p.bench.style.setProperty('--viewer-h', `${p.H - Math.min(hs[to], hs.half) + 18}px`)
    p.panel.dataset.snap = to
  }

  useEffect(() => {
    apply(snap.current)
    const onResize = () => apply(snap.current)
    addEventListener('resize', onResize)
    return () => removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (collapseKey != null && snap.current !== 'peek') apply('peek')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseKey])

  // Move/up are followed on the window, so the drag keeps going when the finger outruns the bar
  // (no pointer capture: that would swallow taps on the progress bar).
  const down = (e: React.PointerEvent) => {
    const p = parts()
    if (!p || !matchMedia(PHONE).matches) return
    drag.current = { y: e.clientY, h: p.panel.getBoundingClientRect().height, t: performance.now(), moved: false }
    const stop = (ev: PointerEvent) => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', stop)
      removeEventListener('pointercancel', stop)
      up(ev)
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', stop)
    addEventListener('pointercancel', stop)
  }
  const move = (e: PointerEvent) => {
    const d = drag.current
    const p = parts()
    if (!d || !p) return
    const dy = d.y - e.clientY
    if (!d.moved && Math.abs(dy) < 6) return
    if (!d.moved) {
      d.moved = true
      p.panel.classList.add('dragging')
    }
    const hs = heights(p.H)
    p.panel.style.height = `${Math.max(hs.peek * 0.8, Math.min(hs.full, d.h + dy))}px`
  }
  const up = (e: PointerEvent) => {
    const d = drag.current
    drag.current = null
    const p = parts()
    if (!d || !p) return
    p.panel.classList.remove('dragging')
    if (!d.moved) return
    e.preventDefault()
    // Swallow the click that follows a drag that ended on the handle.
    const swallow = (ev: MouseEvent) => ev.stopPropagation()
    addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => removeEventListener('click', swallow, true), 0)
    const now = p.panel.getBoundingClientRect().height
    const v = (now - d.h) / Math.max(1, performance.now() - d.t) // px/ms, + = up
    const hs = heights(p.H)
    // A flick goes one snap in its direction; otherwise the nearest snap.
    const order: Snap[] = ['peek', 'half', 'full']
    const at = order.indexOf(snap.current)
    const to =
      Math.abs(v) > 0.6
        ? order[Math.max(0, Math.min(2, at + (v > 0 ? 1 : -1)))]
        : order.reduce((a, b) => (Math.abs(hs[b] - now) < Math.abs(hs[a] - now) ? b : a))
    apply(to)
  }
  const tap = () => apply(snap.current === 'full' ? 'half' : snap.current === 'half' ? 'full' : 'half')

  return (
    <div ref={el} className="sheet-top" onPointerDown={down}>
      <button className="sheet-handle" onClick={tap} aria-label="Show more or less of the steps" />
      {children}
    </div>
  )
}
