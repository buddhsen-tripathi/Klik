import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Marker } from './types'

/**
 * Numbered pins over the current step's parts, matching the numbers in the step text.
 * Each pin follows its part (found by userData.partId) as it moves to the tray and back.
 * Rendering stays on demand: a pin that moved asks for one more frame, then everything stops.
 */
export default function PartMarkers({ markers, onPick }: { markers: Marker[]; onPick?: (id: string) => void }) {
  const scene = useThree((s) => s.scene)
  const invalidate = useThree((s) => s.invalidate)
  const pins = useRef<(THREE.Group | null)[]>([])
  const els = useRef<(HTMLButtonElement | null)[]>([])
  const tmp = useMemo(() => ({ box: new THREE.Box3(), v: new THREE.Vector3() }), [])

  useFrame(() => {
    let moved = false
    markers.forEach((m, i) => {
      const pin = pins.current[i]
      const el = els.current[i]
      if (!pin || !el) return
      const { box, v } = tmp
      box.makeEmpty()
      scene.traverse((o) => {
        if (o.userData.partId === m.id) box.expandByObject(o)
      })
      el.style.display = box.isEmpty() ? 'none' : ''
      if (box.isEmpty()) return
      // The part's center: tops of a small part and the big part it sits on often line up on screen.
      box.getCenter(v)
      if (v.distanceToSquared(pin.position) > 1e-6) {
        pin.position.copy(v)
        moved = true
      }
    })
    if (moved) invalidate()
  })

  return (
    <>
      {markers.map((m, i) => (
        <group key={m.id} ref={(g) => void (pins.current[i] = g)}>
          {/* Below the steps sheet (z-index 5) so pins never cover it on phones. */}
          <Html center zIndexRange={[4, 0]}>
            <button ref={(b) => void (els.current[i] = b)} className="pin" style={{ display: 'none' }} onClick={() => onPick?.(m.id)} aria-label={`Part ${m.n}`}>
              {m.n}
            </button>
          </Html>
        </group>
      ))}
    </>
  )
}
