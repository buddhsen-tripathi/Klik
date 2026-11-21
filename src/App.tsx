import { Hexagon } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { cameraSupported } from './camera'
import Capture from './components/camera/Capture'
import CameraScreen from './components/camera/CameraScreen'
import JobTray from './components/JobTray'

// three.js is ~1 MB, so only load it once the user opens a scan.
const ScanPage = lazy(() => import('./components/scan/ScanPage'))

// Tiny hash router: #/ is the camera, #/upload is the photo picker, #/scan/<id> is a scan.
function useRoute() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const match = hash.match(/^#\/scan\/([\w-]+)/)
  if (match) return { page: 'scan' as const, id: match[1] }
  if (hash.startsWith('#/upload') || !cameraSupported()) return { page: 'upload' as const }
  return { page: 'camera' as const }
}

const go = (path: string) => {
  window.location.hash = path
}

export default function App() {
  const route = useRoute()

  // The camera gets the whole screen; other pages get the normal top bar.
  if (route.page === 'camera') {
    return (
      <div className="app">
        <CameraScreen onUseLibrary={() => go('/upload')} />
        <JobTray />
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand">
          <Hexagon className="brand-mark" aria-hidden />
          Assemble on the Go
        </a>
      </header>
      {route.page === 'scan' ? (
        <Suspense fallback={<main className="scan-page centered muted">Loading…</main>}>
          <ScanPage key={route.id} id={route.id} />
        </Suspense>
      ) : (
        <Capture onUseCamera={() => go('/')} />
      )}
      <JobTray />
    </div>
  )
}
