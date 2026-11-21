import { useGLTF } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useDeferredValue, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { DIRECTION_VECTORS, explodeDistance } from '../../explode'
import BlockoutModel from './BlockoutModel'
import { ACTIVE_COLOR, BLACK, EASE, EPS, NO_STATE, ORIENTS } from './constants'
import { layoutMatrix } from './layout'
import { principalExtents } from './measure'
import type { SizeCheck, ViewerProps } from './types'

/** SAM 3D meshes (one file per parallel job), each placed where it was in the photo, one node per part. */
type StdMat = THREE.MeshStandardMaterial

export default function ScannedModel(props: ViewerProps) {
  const { analysis, states, orient, selectedId, onSelect } = props
  // Per-part meshes arrive one by one while the scan is still modelling. Deferring the list keeps
  // the parts already on screen while the next file loads, instead of flashing the fallback.
  // Polling hands us a new array every few seconds; only a new file should rebuild the scene.
  const fileKey = props.modelFiles.map((f) => f.url).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableFiles = useMemo(() => props.modelFiles, [fileKey])
  const files = useDeferredValue(stableFiles)
  const urls = useMemo(() => files.map((f) => f.url), [files])
  const gltfs = useGLTF(urls) as unknown as { scene: THREE.Object3D }[]
  const invalidate = useThree((s) => s.invalidate)
  const anisotropy = useThree((s) => Math.min(4, s.gl.capabilities.getMaxAnisotropy()))

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
          // Opaque by default: always-transparent meshes sort badly and look washed out.
          // They switch to transparent only while fading (see useFrame).
          ;(m as StdMat).transparent = false
          const map = (m as StdMat).map
          if (map) map.anisotropy = anisotropy
          list.push(m as StdMat)
        }
      })
      return list
    })
    return { root, objects, split, materials, partIds, bases: objects.map((o) => o.position.clone()) }
  }, [files, gltfs, anisotropy])
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

  // Size: placed scans come out in metres (SAM 3D's depth estimate), so they keep their own size and
  // shape; the documented/estimated dimensions are only a cross-check. Only when the two disagree
  // wildly (bad depth guess) is the scan scaled, uniformly, to the dimensions. Then stand it on the ground.
  const fit = useMemo(() => {
    const { root } = prepared
    root.rotation.set(ORIENTS[orient % 4], 0, 0)
    root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const longest = Math.max(size.x, size.y, size.z, 1e-6)
    const target = Math.max(...analysis.dimensions)
    const placed = files.length > 0 && files.every((f) => f.layouts.length > 0)
    // Measure along the object's own axes (not the camera's), in cm.
    const own = placed ? principalExtents(root) : null
    const measured = own ? (own.map((x) => x * 100) as [number, number, number]) : null
    const ratio = measured ? measured[0] / target : null
    const ownSize = ratio != null && ratio > 0.67 && ratio < 1.5
    // Fallback scale maps the scan's own longest side (not the tilted box's) onto the longest dimension.
    const scale = ownSize ? 100 : own ? target / own[0] : target / longest
    const check: SizeCheck = { measured, ratio, usedScanSize: ownSize }
    return { scale, check, position: new THREE.Vector3(-center.x * scale, -box.min.y * scale, -center.z * scale) }
  }, [prepared, orient, analysis.dimensions, files])
  const { onMeasured } = props
  useEffect(() => onMeasured?.(fit.check), [fit.check, onMeasured])

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
        m.opacity = Math.abs(m.opacity - t.opacity) < 0.002 ? t.opacity : THREE.MathUtils.lerp(m.opacity, t.opacity, k)
        const see = m.opacity < 0.999
        if (m.transparent !== see) {
          m.transparent = see
          m.depthWrite = !see
          m.needsUpdate = true
        }
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

  // Parts SAM 3D couldn't see (hidden screws etc.) appear as faint shapes only while they're in the
  // current step or selected, so boxes don't cover the real scan the rest of the time.
  const hidden = useMemo(
    () =>
      new Set(
        analysis.parts
          .filter((p) => !modelPartIds.includes(p.id) && (states.get(p.id)?.active || selectedId === p.id))
          .map((p) => p.id),
      ),
    [analysis.parts, modelPartIds, states, selectedId],
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
