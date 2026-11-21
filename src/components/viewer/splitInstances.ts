import * as THREE from 'three'

/**
 * A part with quantity > 1 (four wheels, two headlights) usually comes back from SAM 3D as one
 * mesh. Split it into its connected pieces so each copy can move on its own. Returns null when the
 * mesh doesn't clearly break into `expected` similar-sized pieces (then it stays one object).
 * The pieces share the original vertex buffers; only new index arrays are made.
 */
export function splitInstances(holder: THREE.Object3D, expected: number): THREE.Group[] | null {
  if (expected < 2 || expected > 12) return null
  const meshes: THREE.Mesh[] = []
  holder.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh))
  if (meshes.length !== 1) return null
  const mesh = meshes[0]
  const geo = mesh.geometry
  const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!pos) return null
  const index = geo.index ? geo.index.array : Uint32Array.from({ length: pos.count }, (_, i) => i)
  const tris = Math.floor(index.length / 3)
  if (tris < expected * 8) return null

  // Weld vertices by position (UV seams split them), then union triangles that share a vertex.
  geo.computeBoundingBox()
  const eps = geo.boundingBox!.getSize(new THREE.Vector3()).length() * 1e-4 || 1e-6
  const weld = new Int32Array(pos.count)
  const seen = new Map<string, number>()
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) / eps)},${Math.round(pos.getY(i) / eps)},${Math.round(pos.getZ(i) / eps)}`
    let id = seen.get(key)
    if (id === undefined) seen.set(key, (id = seen.size))
    weld[i] = id
  }
  const parent = Int32Array.from({ length: seen.size }, (_, i) => i)
  const find = (a: number): number => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]]
    return a
  }
  for (let t = 0; t < tris; t++) {
    const a = find(weld[index[t * 3]])
    parent[find(weld[index[t * 3 + 1]])] = a
    parent[find(weld[index[t * 3 + 2]])] = a
  }

  // Triangles per component, with each component's centre.
  const comps = new Map<number, { tris: number[]; c: THREE.Vector3 }>()
  const v = new THREE.Vector3()
  for (let t = 0; t < tris; t++) {
    const r = find(weld[index[t * 3]])
    let c = comps.get(r)
    if (!c) comps.set(r, (c = { tris: [], c: new THREE.Vector3() }))
    c.tris.push(t)
    c.c.add(v.fromBufferAttribute(pos, index[t * 3]))
  }
  const list = [...comps.values()].map((c) => ({ ...c, c: c.c.divideScalar(c.tris.length) })).sort((a, b) => b.tris.length - a.tris.length)
  if (list.length < expected) return null
  const seeds = list.slice(0, expected)
  // The copies should be similar in size; otherwise these "pieces" are just details of one object.
  if (seeds[expected - 1].tris.length < seeds[0].tris.length * 0.25) return null
  // Crumbs (bolts, tread bits) join the nearest copy.
  const groups = seeds.map((s) => [...s.tris])
  for (const crumb of list.slice(expected)) {
    let best = 0
    for (let k = 1; k < seeds.length; k++) if (crumb.c.distanceToSquared(seeds[k].c) < crumb.c.distanceToSquared(seeds[best].c)) best = k
    groups[best].push(...crumb.tris)
  }

  holder.updateMatrixWorld(true)
  const rel = holder.matrixWorld.clone().invert().multiply(mesh.matrixWorld)
  return groups.map((triList) => {
    const idx = new Uint32Array(triList.length * 3)
    triList.forEach((t, i) => idx.set([index[t * 3], index[t * 3 + 1], index[t * 3 + 2]], i * 3))
    const g = new THREE.BufferGeometry()
    for (const [name, attr] of Object.entries(geo.attributes)) g.setAttribute(name, attr)
    g.setIndex(new THREE.BufferAttribute(idx, 1))
    g.computeBoundingBox()
    g.computeBoundingSphere()
    const piece = new THREE.Mesh(g, Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone())
    rel.decompose(piece.position, piece.quaternion, piece.scale)
    const wrap = new THREE.Group()
    wrap.position.copy(holder.position)
    wrap.quaternion.copy(holder.quaternion)
    wrap.scale.copy(holder.scale)
    wrap.add(piece)
    return wrap
  })
}
