import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'

type Controls = THREE.EventDispatcher<{ start: object }> & { target: THREE.Vector3; update(): void }

/**
 * Keeps what matters in view: when the framed box changes (a part lands on the tray, a new mode),
 * glide the orbit target and zoom so it fits, keeping the user's viewing angle. Hands off as soon
 * as the user starts dragging.
 */
export default function AutoFrame({ box, frameKey }: { box: THREE.Box3; frameKey: string }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const controls = useThree((s) => s.controls) as unknown as Controls | null
  const size = useThree((s) => s.size)
  const invalidate = useThree((s) => s.invalidate)
  const goal = useRef<{ target: THREE.Vector3; dist: number } | null>(null)

  useEffect(() => {
    if (box.isEmpty()) return
    const center = box.getCenter(new THREE.Vector3())
    const radius = box.getSize(new THREE.Vector3()).length() / 2
    // Fit the bounding sphere in the narrower of the two fields of view (portrait phones).
    const vfov = THREE.MathUtils.degToRad(camera.fov)
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (size.width / Math.max(size.height, 1)))
    goal.current = { target: center, dist: (radius / Math.sin(Math.min(vfov, hfov) / 2)) * 0.92 }
    invalidate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey, size.width, size.height])

  useEffect(() => {
    if (!controls) return
    const stop = () => (goal.current = null)
    controls.addEventListener('start', stop)
    return () => controls.removeEventListener('start', stop)
  }, [controls])

  const dir = useRef(new THREE.Vector3())
  useFrame((_, dt) => {
    const g = goal.current
    if (!g || !controls) return
    const k = 1 - Math.exp(-dt * 3.5)
    const t = controls.target
    dir.current.copy(camera.position).sub(t)
    const dist = THREE.MathUtils.lerp(dir.current.length(), g.dist, k)
    t.lerp(g.target, k)
    camera.position.copy(t).addScaledVector(dir.current.normalize(), dist)
    controls.update()
    if (t.distanceTo(g.target) < g.dist * 0.002 && Math.abs(dist - g.dist) < g.dist * 0.002) goal.current = null
    else invalidate()
  })
  return null
}
