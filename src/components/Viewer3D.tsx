import { Edges, Grid, Html, OrbitControls, useGLTF } from '@react-three/drei'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Component, Suspense, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { DIRECTION_VECTORS, explodeDistance, type PartState } from '../explode'
import type { Analysis, Layout, ModelFile, Part } from '../shared/types'

export type Source = 'blockout' | 'scan'

interface ViewerProps {
  analysis: Analysis
  states: Map<string, PartState>
  source: Source
  /** Scanned meshes (one per parallel SAM 3D job), loaded as they arrive. */
  modelFiles: ModelFile[]
  /** Quarter turns around X, to fix scans that come back lying on their side. */
  orient: number
  /** Turntable: slowly orbit the model. The only mode that renders continuously. */
  spin?: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
}

const ACTIVE_COLOR = new THREE.Color('#ff9f1c')
const BLACK = new THREE.Color('#000000')
const deg = (d: number) => (d * Math.PI) / 180
const ORIENTS = [0, -Math.PI / 2, Math.PI / 2, Math.PI]
const NO_STATE: PartState = { offset: 0, faded: false, active: false }
const EASE = 6 // higher = snappier animation
const EPS = 0.01

/*
 * Lean rendering rules (phones first):
 * - frameloop="demand": no 60 fps loop. A frame is drawn only when the camera moves,
 *   props change, or a part is still animating (each animator calls invalidate()).
 * - DPR capped at 1.5, no shadow passes.
 * - The scanned GLB is only mounted when the user asks for it, and its GPU memory is
 *   released when it unmounts.
 */
export default function Viewer3D(props: ViewerProps) {
  const { analysis } = props
  const size = Math.max(...analysis.dimensions, 10)
  const height = analysis.dimensions[1]

  const blockout = <BlockoutModel {...props} />
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.5]}
      gl={{ antialias: true, powerPreference: 'default' }}
      // Far enough back to fit the fully exploded kit, not just the assembled object.
      camera={{ position: [size * 1.7, size * 1.4, size * 2.4], fov: 40, near: size / 100, far: size * 40 }}
      onPointerMissed={() => props.onSelect(null)}
    >
      <hemisphereLight args={['#ffffff', '#6b6f78', 1.2]} />
      <directionalLight position={[size, size * 2, size * 1.5]} intensity={1.8} />
      <directionalLight position={[-size, size, -size]} intensity={0.6} />
      <Grid
        infiniteGrid
        cellSize={5}
        sectionSize={25}
        fadeDistance={size * 5}
        cellColor="#6b7280"
        sectionColor="#9ca3af"
        cellThickness={0.5}
        position={[0, -0.01, 0]}
      />
      {props.source === 'scan' && props.modelFiles.length > 0 ? (
        <ModelErrorBoundary fallback={blockout}>
          <Suspense fallback={<BlockoutModel {...props} ghost />}>
            <ScannedModel {...props} />
          </Suspense>
        </ModelErrorBoundary>
      ) : (
        blockout
      )}
      <OrbitControls
        makeDefault
        target={[0, height / 2, 0]}
        enableDamping
        autoRotate={!!props.spin}
        autoRotateSpeed={1.6}
        maxPolarAngle={Math.PI * 0.95}
      />
      <SpinDriver on={!!props.spin} />
    </Canvas>
  )
}

/** With frameloop="demand", keep requesting frames only while the turntable is on. */
function SpinDriver({ on }: { on: boolean }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    if (on) invalidate()
  }, [on, invalidate])
  useFrame(() => {
    if (on) invalidate()
  })
  return null
}

// ---------------- Blockout: Gemini's simple-shape model ----------------

function BlockoutModel({ analysis, states, selectedId, onSelect, ghost, only }: ViewerProps & { ghost?: boolean; only?: Set<string> }) {
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
            selected={selectedId === part.id}
            ghost={ghost}
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
  selected: boolean
  ghost?: boolean
  onSelect: (id: string | null) => void
}) {
  const { part, state, distance, selected, ghost, onSelect } = props
  const group = useRef<THREE.Group>(null)
  const mat = useRef<THREE.MeshStandardMaterial>(null)
  const invalidate = useThree((s) => s.invalidate)
  const dir = DIRECTION_VECTORS[part.removalDirection]
  const [w, h, d] = part.size
  const highlight = state.active || selected

  const target = useMemo(
    () =>
      new THREE.Vector3(
        part.position[0] + dir[0] * distance * state.offset,
        part.position[1] + dir[1] * distance * state.offset,
        part.position[2] + dir[2] * distance * state.offset,
      ),
    [part.position, dir, distance, state.offset],
  )
  const targetOpacity = state.faded ? 0.12 : ghost ? 0.35 : 1

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

  useFrame((_, dt) => {
    const g = group.current
    const m = mat.current
    if (!g || !m) return
    const k = 1 - Math.exp(-dt * EASE)
    g.position.lerp(target, k)
    m.opacity = THREE.MathUtils.lerp(m.opacity, targetOpacity, k)
    m.depthWrite = m.opacity > 0.9
    // Keep drawing only while still moving.
    if (g.position.distanceTo(target) > EPS || Math.abs(m.opacity - targetOpacity) > EPS) invalidate()
  })

  const scale: [number, number, number] = part.shape === 'cylinder' ? [w, h, w] : [w, h, d]
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    onSelect(part.id)
  }

  return (
    <group ref={group} position={part.position} rotation={[deg(part.rotation[0]), deg(part.rotation[1]), deg(part.rotation[2])]}>
      <mesh scale={scale} onClick={click}>
        {part.shape === 'cylinder' ? (
          <cylinderGeometry args={[0.5, 0.5, 1, 20]} />
        ) : part.shape === 'sphere' ? (
          <sphereGeometry args={[0.5, 20, 12]} />
        ) : (
          <boxGeometry args={[1, 1, 1]} />
        )}
        <meshStandardMaterial ref={mat} color={part.color} roughness={0.7} metalness={0.05} transparent opacity={ghost ? 0.35 : 1} />
        <Edges threshold={20} color={highlight ? '#ff9f1c' : '#1f2329'} />
      </mesh>
      {highlight && !ghost && (
        <Html center position={[0, h / 2 + 2, 0]} className="part-label" zIndexRange={[10, 0]}>
          {part.name}
        </Html>
      )}
    </group>
  )
}

// ---------------- Scanned: SAM 3D GLB, split into one node per part ----------------

type StdMat = THREE.MeshStandardMaterial

function ScannedModel(props: ViewerProps) {
  const { analysis, states, orient, selectedId, onSelect } = props
  // Per-part meshes arrive one by one while the scan is still modelling. Deferring the list keeps
  // the parts already on screen while the next file loads, instead of flashing the fallback.
  const files = useDeferredValue(props.modelFiles)
  const urls = useMemo(() => files.map((f) => f.url), [files])
  const gltfs = useGLTF(urls) as unknown as { scene: THREE.Object3D }[]
  const invalidate = useThree((s) => s.invalidate)

  const prepared = useMemo(() => {
    const root = new THREE.Group()
    const objects: THREE.Object3D[] = []
    const partIds: string[] = []
    files.forEach((file, fi) => {
      const scene = gltfs[fi].scene.clone(true)
      // Own material per mesh so highlighting one part doesn't light up the others.
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh) mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone()
      })
      // One node per box prompt. Walk past wrapper nodes to find them.
      let node: THREE.Object3D = scene
      while (node.children.length === 1 && !(node as THREE.Mesh).isMesh) node = node.children[0]
      const nodes = node.children.length > 1 ? [...node.children] : [node]
      if (file.layouts.length === nodes.length) {
        // Place each object where SAM 3D saw it in the photo, so separate files line up.
        nodes.forEach((n, k) => {
          const holder = new THREE.Group()
          layoutMatrix(file.layouts[k]).decompose(holder.position, holder.quaternion, holder.scale)
          holder.add(n)
          root.add(holder)
          objects.push(holder)
        })
      } else {
        // Older single-file scans: the file is already one scene.
        root.add(scene)
        objects.push(...nodes)
      }
      partIds.push(...file.partIds.slice(0, nodes.length))
    })
    const split = partIds.length > 1 && objects.length === partIds.length
    // Collect each node's materials once, so the frame loop never has to traverse.
    const materials = objects.map((obj) => {
      const list: StdMat[] = []
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          ;(m as StdMat).transparent = true
          list.push(m as StdMat)
        }
      })
      return list
    })
    return { root, objects, split, materials, partIds, bases: objects.map((o) => o.position.clone()) }
  }, [files, gltfs])
  const modelPartIds = prepared.partIds

  // Material clones belong to one `prepared`; drop them when a new file is added.
  useEffect(() => () => prepared.materials.flat().forEach((m) => m.dispose()), [prepared])

  // Free GPU memory when the scan is closed (not when a new part arrives), and drop it from drei's cache.
  const loaded = useRef({ gltfs, urls })
  useEffect(() => {
    loaded.current = { gltfs, urls }
  }, [gltfs, urls])
  useEffect(
    () => () => {
      for (const g of loaded.current.gltfs)
        g.scene.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (!mesh.isMesh) return
          mesh.geometry.dispose()
          for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose()
            m.dispose()
          }
        })
      loaded.current.urls.forEach((u) => useGLTF.clear(u))
    },
    [],
  )

  // Scale the scan to Gemini's estimated real size and stand it on the ground at the origin.
  const fit = useMemo(() => {
    const { root } = prepared
    root.rotation.set(ORIENTS[orient % 4], 0, 0)
    root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const scale = Math.max(...analysis.dimensions) / Math.max(size.x, size.y, size.z, 1e-6)
    return { scale, position: new THREE.Vector3(-center.x * scale, -box.min.y * scale, -center.z * scale) }
  }, [prepared, orient, analysis.dimensions])

  const byId = useMemo(() => new Map(analysis.parts.map((p) => [p.id, p])), [analysis.parts])
  const tmp = useMemo(
    () => ({ q: new THREE.Quaternion(), s: new THREE.Vector3(), p: new THREE.Vector3(), v: new THREE.Vector3(), m: new THREE.Matrix4() }),
    [],
  )

  // Per-node targets are recomputed only when the step, selection or orientation changes.
  const targets = useMemo(() => {
    if (!prepared.split) return []
    const { root } = prepared
    root.updateMatrixWorld(true)
    const rootWorldInv = root.matrixWorld.clone().invert()
    return prepared.objects.map((obj, i) => {
      const part = byId.get(modelPartIds[i])
      const state = (part && states.get(part.id)) ?? NO_STATE
      const dist = part ? explodeDistance(analysis, part.size) * state.offset : 0
      const dir = part ? DIRECTION_VECTORS[part.removalDirection] : [0, 0, 0]
      // Offset is in scene cm. Undo the fit scale, then the node's parent transform relative to the
      // fitted group (root rotation + any wrapper nodes), so it works whether or not root is mounted yet.
      tmp.m.copy(root.matrix).multiply(rootWorldInv).multiply(obj.parent!.matrixWorld).decompose(tmp.p, tmp.q, tmp.s)
      tmp.v
        .set(dir[0] * dist, dir[1] * dist, dir[2] * dist)
        .divideScalar(fit.scale)
        .applyQuaternion(tmp.q.invert())
        .divideScalar(tmp.s.x || 1)
      return {
        position: prepared.bases[i].clone().add(tmp.v),
        opacity: state.faded ? 0.12 : 1,
        highlight: state.active || selectedId === part?.id,
        active: state.active,
      }
    })
  }, [prepared, states, selectedId, byId, modelPartIds, analysis, tmp, fit])

  useEffect(() => {
    targets.forEach((t, i) => {
      for (const m of prepared.materials[i]) {
        if (!m.emissive) continue
        m.emissive.copy(t.highlight ? ACTIVE_COLOR : BLACK)
        m.emissiveIntensity = t.active ? 0.35 : t.highlight ? 0.2 : 0
      }
    })
    invalidate()
  }, [targets, prepared, invalidate])

  useFrame((_, dt) => {
    if (!targets.length) return
    const k = 1 - Math.exp(-dt * EASE)
    let moving = false
    prepared.objects.forEach((obj, i) => {
      const t = targets[i]
      obj.position.lerp(t.position, k)
      if (obj.position.distanceTo(t.position) > EPS) moving = true
      for (const m of prepared.materials[i]) {
        m.opacity = THREE.MathUtils.lerp(m.opacity, t.opacity, k)
        m.depthWrite = m.opacity > 0.9
        if (Math.abs(m.opacity - t.opacity) > EPS) moving = true
      }
    })
    if (moving) invalidate()
  })

  const click = (e: ThreeEvent<MouseEvent>) => {
    if (!prepared.split) return
    e.stopPropagation()
    let o: THREE.Object3D | null = e.object
    while (o && !prepared.objects.includes(o)) o = o.parent
    const i = o ? prepared.objects.indexOf(o) : -1
    if (i >= 0) onSelect(modelPartIds[i] ?? null)
  }

  // Parts SAM 3D couldn't see (hidden fasteners etc.) are drawn as faint blockout shapes.
  const hidden = useMemo(
    () => new Set(analysis.parts.filter((p) => !modelPartIds.includes(p.id)).map((p) => p.id)),
    [analysis.parts, modelPartIds],
  )

  return (
    <>
      <group position={fit.position} scale={fit.scale}>
        <primitive object={prepared.root} onClick={click} />
      </group>
      {prepared.split && hidden.size > 0 && <BlockoutModel {...props} ghost only={hidden} />}
    </>
  )
}

/**
 * SAM 3D pose → three.js matrix. Mesh vertices are glTF Y-up; the pose maps Z-up object space
 * into PyTorch3D camera space (+X left, +Y up, +Z away from the camera), with row-vector
 * rotation (p · R). Checked against the photo: parts lower/left in the image land lower/left.
 */
function layoutMatrix(l: Layout): THREE.Matrix4 {
  const [w, x, y, z] = l.rotation
  const R = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(x, y, z, w).normalize()).transpose()
  const yUpToZUp = new THREE.Matrix4().makeRotationX(Math.PI / 2)
  const camToThree = new THREE.Matrix4().makeScale(-1, 1, -1)
  return camToThree
    .multiply(new THREE.Matrix4().makeTranslation(l.translation[0], l.translation[1], l.translation[2]))
    .multiply(R)
    .multiply(new THREE.Matrix4().makeScale(l.scale, l.scale, l.scale))
    .multiply(yUpToZUp)
}

class ModelErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err: unknown) {
    console.error('Could not load 3D scan, showing blockout instead', err)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
