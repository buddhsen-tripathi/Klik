import * as THREE from 'three'

const MAX_SAMPLES = 20_000

/**
 * Size of an object along its own principal axes (PCA of its vertices), longest first.
 * Unlike an axis-aligned box this doesn't depend on how the object sits in the camera's
 * view, so it can be compared with documented W × H × D. 2nd–98th percentile per axis
 * keeps stray vertices from inflating it.
 */
export function principalExtents(root: THREE.Object3D): [number, number, number] | null {
  root.updateMatrixWorld(true)
  const pts: number[] = []
  let total = 0
  root.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined
    if ((o as THREE.Mesh).isMesh && g?.attributes.position) total += g.attributes.position.count
  })
  if (!total) return null
  const step = Math.max(1, Math.floor(total / MAX_SAMPLES))
  const v = new THREE.Vector3()
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    const pos = mesh.isMesh ? (mesh.geometry as THREE.BufferGeometry).attributes.position : null
    if (!pos) return
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
      pts.push(v.x, v.y, v.z)
    }
  })
  const n = pts.length / 3
  const mean = [0, 0, 0]
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) mean[k] += pts[i * 3 + k] / n
  const c = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  for (let i = 0; i < n; i++) {
    const d = [pts[i * 3] - mean[0], pts[i * 3 + 1] - mean[1], pts[i * 3 + 2] - mean[2]]
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) c[a][b] += (d[a] * d[b]) / n
  }
  const axes = eigenvectors(c)
  const extents = axes.map((ax) => {
    const proj = new Float64Array(n)
    for (let i = 0; i < n; i++) proj[i] = (pts[i * 3] - mean[0]) * ax[0] + (pts[i * 3 + 1] - mean[1]) * ax[1] + (pts[i * 3 + 2] - mean[2]) * ax[2]
    proj.sort()
    return proj[Math.floor(n * 0.98)] - proj[Math.floor(n * 0.02)]
  })
  return extents.sort((a, b) => b - a) as [number, number, number]
}

/** Eigenvectors of a symmetric 3×3 matrix (Jacobi rotations), as rows. */
function eigenvectors(m: number[][]): number[][] {
  const a = m.map((r) => [...r])
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  for (let sweep = 0; sweep < 20; sweep++) {
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      if (Math.abs(a[p][q]) < 1e-12) continue
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
      const cs = 1 / Math.sqrt(t * t + 1)
      const sn = t * cs
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p]
        const akq = a[k][q]
        a[k][p] = cs * akp - sn * akq
        a[k][q] = sn * akp + cs * akq
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k]
        const aqk = a[q][k]
        a[p][k] = cs * apk - sn * aqk
        a[q][k] = sn * apk + cs * aqk
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p]
        const vkq = v[k][q]
        v[k][p] = cs * vkp - sn * vkq
        v[k][q] = sn * vkp + cs * vkq
      }
    }
  }
  // Columns of v are the eigenvectors.
  return [0, 1, 2].map((j) => [v[0][j], v[1][j], v[2][j]])
}
