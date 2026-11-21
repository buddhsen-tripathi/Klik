import { lazy, Suspense, useEffect, useState } from 'react'
import Capture from './components/Capture'

// three.js is ~1 MB, so only load it once the user opens a scan.
const ScanPage = lazy(() => import('./components/ScanPage'))

// Tiny hash router: #/ is the capture screen, #/scan/<id> is a scan.
function useRoute() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const match = hash.match(/^#\/scan\/([\w-]+)/)
  return match ? { page: 'scan' as const, id: match[1] } : { page: 'home' as const }
}

export default function App() {
  const route = useRoute()
  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand">
          <span className="brand-mark" aria-hidden>
            ⬡
          </span>
          Assemble on the Go
        </a>
      </header>
      {route.page === 'scan' ? (
        <Suspense fallback={<main className="scan-page centered muted">Loading…</main>}>
          <ScanPage key={route.id} id={route.id} />
        </Suspense>
      ) : (
        <Capture />
      )}
    </div>
  )
}
