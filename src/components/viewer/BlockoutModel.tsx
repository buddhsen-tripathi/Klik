import { Edges, Html } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { DIRECTION_VECTORS, explodeDistance, type PartState } from '../../explode'
import type { ModelFile, Part } from '../../shared/types'
import ReferenceMesh from './ReferenceMesh'
import { ACTIVE_COLOR, BLACK, deg, EASE, EPS, NO_STATE } from './constants'
import { blockTraySlots, type Slot } from './tray'
import type { ViewerProps } from './types'


export default function BlockoutModel({
  analysis,
  states,
  selectedId,
  onSelect,
  ghost,
  only,
  traySlots,
  references,
}: ViewerProps & { ghost?: boolean; only?: Set<string>; traySlots?: Map<string, Slot>; references?: Map<string, ModelFile> }) {
  const ownSlots = useMemo(() => (traySlots ? null : blockTraySlots(analysis)), [traySlots, analysis])
  const slots = traySlots ?? ownSlots!
  const focusing = selectedId != null || [...states.values()].some((s) => s.active)
  return (
    <group>
      {analysis.parts
        .filter((p) => !only || only.has(p.id))
        .map((part) => (
          <BlockoutPart
            key={part.id}
            part={part}
            state={states.get(part.id) ?? NO_STATE}
            distance={explodeDistance(analysis, part.size)}
            slot={slots.get(part.id)}
            reference={references?.get(part.id)}
            selected={selectedId === part.id}
            ghost={ghost}
            dim={focusing}
            onSelect={onSelect}
          />
        ))}
    </group>
  )
}

function BlockoutPart(props: {
  part: Part
  state: PartState
  distance: number
  slot?: Slot
  reference?: ModelFile
  selected: boolean
  ghost?: boolean
  /** Something else is in focus: fade this part unless it's highlighted or on the tray. */
  dim?: boolean
  onSelect: (id: string | null) => void
}) {
  const { part, state, distance, slot, reference, selected, ghost, dim, onSelect } = props
  const group = useRef<THREE.Group>(null)
  const mat = useRef<THREE.MeshStandardMaterial>(null)
  const invalidate = useThree((s) => s.invalidate)
  const dir = DIRECTION_VECTORS[part.removalDirection]
  const [w, h, d] = part.size
  const highlight = state.active || selected

  // On the tray: its own spot on the ground. Otherwise in place, or partway out along its removal direction.
  const target = useMemo(
    () =>
      state.tray && slot
        ? new THREE.Vector3(slot.x, h / 2, slot.z)
        : new THREE.Vector3(
            part.position[0] + dir[0] * distance * state.offset,
            part.position[1] + dir[1] * distance * state.offset,
            part.position[2] + dir[2] * distance * state.offset,
          ),
    [part.position, dir, distance, state.offset, state.tray, slot, h],
  )
  // Faint only while it overlaps the real scan (parts SAM 3D couldn't see); solid on the tray.
  const targetOpacity = ghost && !state.tray ? 0.35 : dim && !highlight && !state.tray ? 0.4 : 1
  // The step's part pulses a few times when the step starts.
  const pulseUntil = useRef(0)
  useEffect(() => {
    if (state.active) pulseUntil.current = performance.now() + 1800
  }, [state.active])

  // New parts drop in from above and fade in, so the model visibly builds as Gemini streams it.
  useLayoutEffect(() => {
    if (!group.current || !mat.current) return
    group.current.position.y += Math.max(...part.size, 10) * 1.5
    mat.current.opacity = 0
    invalidate()
  }, [])

  // Highlight changes are instant, so set them here instead of every frame.
  useEffect(() => {
    if (!mat.current) return
    mat.current.emissive.copy(highlight ? ACTIVE_COLOR : BLACK)
    mat.current.emissiveIntensity = state.active ? 0.35 : selected ? 0.2 : 0
    invalidate()
  }, [highlight, state.active, selected, target, targetOpacity, invalidate])

  useFrame((st, dt) => {
    const g = group.current
    if (!g) return
    const m = mat.current
    const k = 1 - Math.exp(-dt * EASE)
    if (m && pulseUntil.current) {
      const pulsing = performance.now() < pulseUntil.current
      m.emissiveIntensity = pulsing ? 0.15 + 0.45 * (0.5 - 0.5 * Math.cos(st.clock.elapsedTime * 9)) : state.active ? 0.35 : selected ? 0.2 : 0
      if (pulsing) invalidate()
      else pulseUntil.current = 0
    }
    g.position.lerp(target, k)
    if (m) {
      m.opacity = THREE.MathUtils.lerp(m.opacity, targetOpacity, k)
      m.depthWrite = m.opacity > 0.9
    }
    // Keep drawing only while still moving.
    if (g.position.distanceTo(target) > EPS || (m && Math.abs(m.opacity - targetOpacity) > EPS)) invalidate()
  })

  const scale: [number, number, number] = part.shape === 'cylinder' ? [w, h, w] : [w, h, d]
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    onSelect(part.id)
  }

  return (
    <group ref={group} userData={{ partId: part.id }} position={part.position} rotation={reference ? [0, 0, 0] : [deg(part.rotation[0]), deg(part.rotation[1]), deg(part.rotation[2])]}>
      {reference ? (
        // A hidden part modelled from a reference photo: its own shape, uniformly scaled. The box shows while it loads.
        <group onClick={click}>
          <Suspense fallback={null}>
            <ReferenceMesh file={reference} part={part} opacity={targetOpacity} highlight={highlight} active={state.active} />
          </Suspense>
        </group>
      ) : (
        <mesh scale={scale} onClick={click}>
          {part.shape === 'cylinder' ? (
            <cylinderGeometry args={[0.5, 0.5, 1, 20]} />
          ) : part.shape === 'sphere' ? (
            <sphereGeometry args={[0.5, 20, 12]} />
          ) : (
            <boxGeometry args={[1, 1, 1]} />
          )}
          <meshStandardMaterial ref={mat} color={part.color} roughness={0.7} metalness={0.05} transparent opacity={ghost ? 0.35 : 1} />
          <Edges threshold={20} color={highlight ? '#d87943' : '#1f2329'} />
        </mesh>
      )}
      {highlight && !ghost && (
        <Html center position={[0, h / 2 + 2, 0]} className="part-label" zIndexRange={[10, 0]}>
          {part.name}
        </Html>
      )}
    </group>
  )
}
