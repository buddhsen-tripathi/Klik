import { useGLTF } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { ModelFile, Part } from '../../shared/types'
import { ACTIVE_COLOR, BLACK } from './constants'
import { layoutMatrix } from './layout'

type StdMat = THREE.MeshStandardMaterial

/**
 * A hidden part modelled from a reference photo found online. It keeps its own shape and texture:
 * only rotated upright (from SAM 3D's pose), centred, and scaled UNIFORMLY so its longest side
 * matches the part's estimated size. Never stretched to fit a box.
 */
export default function ReferenceMesh({ file, part, opacity, highlight, active }: { file: ModelFile; part: Part; opacity: number; highlight: boolean; active: boolean }) {
  const gltf = useGLTF(file.url) as unknown as { scene: THREE.Object3D }
  const invalidate = useThree((s) => s.invalidate)

  const { object, materials } = useMemo(() => {
    const inner = gltf.scene.clone(true)
    const materials: StdMat[] = []
    inner.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone()
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.push(m as StdMat)
    })
    const upright = new THREE.Group()
    if (file.layouts[0]) layoutMatrix(file.layouts[0]).decompose(new THREE.Vector3(), upright.quaternion, new THREE.Vector3())
    upright.add(inner)
    upright.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(upright)
    const size = box.getSize(new THREE.Vector3())
    const scale = Math.max(...part.size) / Math.max(size.x, size.y, size.z, 1e-6)
    const center = box.getCenter(new THREE.Vector3())
    const object = new THREE.Group()
    upright.position.copy(center).multiplyScalar(-1)
    object.add(upright)
    object.scale.setScalar(scale)
    return { object, materials }
  }, [gltf, file.layouts, part.size])

  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials])

  useEffect(() => {
    for (const m of materials) {
      m.transparent = opacity < 0.999
      m.depthWrite = !m.transparent
      m.opacity = opacity
      if (m.emissive) {
        m.emissive.copy(highlight ? ACTIVE_COLOR : BLACK)
        m.emissiveIntensity = active ? 0.35 : highlight ? 0.2 : 0
      }
      m.needsUpdate = true
    }
    invalidate()
  }, [materials, opacity, highlight, active, invalidate])

  return <primitive object={object} />
}
