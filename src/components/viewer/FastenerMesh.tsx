import { useLayoutEffect, useMemo, type MutableRefObject } from 'react'
import * as THREE from 'three'
import type { Part } from '../../shared/types'

/**
 * Screws, bolts, nuts, washers and dowels drawn from their spec ("M4 × 12 mm Phillips pan head"),
 * at real size (scene units are cm), one copy per piece in a neat row. Exact and instant: no
 * generated mesh can get a 3 mm screw right.
 */
type Kind = 'screw' | 'bolt' | 'nut' | 'washer' | 'dowel'
type Head = 'pan' | 'flat' | 'hex' | 'button' | 'socket'

export function parseFastener(part: Part): { kind: Kind; head: Head; d: number; len: number } {
  const text = `${part.spec ?? ''} ${part.name}`.toLowerCase()
  const metric = text.match(/\bm(\d+(?:\.\d+)?)/)
  const dia = text.match(/[ø⌀]\s*(\d+(?:\.\d+)?)/)
  const len = text.match(/[x×]\s*(\d+(?:\.\d+)?)\s*mm/)
  const kind: Kind = /washer/.test(text) ? 'washer' : /\bnut\b/.test(text) ? 'nut' : /dowel|pin\b/.test(text) ? 'dowel' : /bolt/.test(text) ? 'bolt' : 'screw'
  const head: Head = /flat|countersunk|csk/.test(text) ? 'flat' : /hex(?! key)|bolt/.test(text) ? 'hex' : /button/.test(text) ? 'button' : /socket|allen|cap/.test(text) ? 'socket' : 'pan'
  const dMm = Number(metric?.[1] ?? dia?.[1] ?? (kind === 'dowel' ? 8 : 4))
  const lenMm = Number(len?.[1] ?? (kind === 'nut' ? dMm * 0.8 : kind === 'washer' ? dMm * 0.2 : dMm * 3))
  return { kind, head, d: dMm / 10, len: lenMm / 10 }
}

function pieceGeometry({ kind, head, d, len }: ReturnType<typeof parseFastener>): THREE.BufferGeometry[] {
  const r = d / 2
  if (kind === 'washer') return [new THREE.TorusGeometry(r * 1.4, r * 0.55, 8, 24).rotateX(Math.PI / 2).scale(1, 0.4, 1)]
  if (kind === 'nut') return [new THREE.CylinderGeometry(r * 1.8, r * 1.8, len, 6)]
  if (kind === 'dowel') return [new THREE.CapsuleGeometry(r, Math.max(len - d, 0.01), 4, 16)]
  // Shank pointing down from y = 0, head on top, with a few thread rings for read-at-a-glance.
  const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(r, r * 0.85, len, 16).translate(0, -len / 2, 0)]
  const rings = Math.min(12, Math.max(3, Math.round(len / (d * 0.6))))
  for (let i = 1; i < rings; i++) parts.push(new THREE.TorusGeometry(r * 0.98, r * 0.12, 4, 16).rotateX(Math.PI / 2).translate(0, -(len * i) / rings, 0))
  const hh = d * 0.6
  if (head === 'flat') parts.push(new THREE.CylinderGeometry(d, r, hh, 20).translate(0, hh / 2, 0))
  else if (head === 'hex') parts.push(new THREE.CylinderGeometry(d * 0.95, d * 0.95, hh, 6).translate(0, hh / 2, 0))
  else if (head === 'button') parts.push(new THREE.SphereGeometry(d * 0.95, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1))
  else if (head === 'socket') parts.push(new THREE.CylinderGeometry(d * 0.75, d * 0.75, d, 20).translate(0, d / 2, 0))
  else parts.push(new THREE.CylinderGeometry(d * 0.9, d, hh, 20).translate(0, hh / 2, 0))
  return parts
}

export default function FastenerMesh({ part, material, onClick }: { part: Part; material: MutableRefObject<THREE.MeshStandardMaterial | null>; onClick: (e: never) => void }) {
  const spec = useMemo(() => parseFastener(part), [part])
  const geometries = useMemo(() => pieceGeometry(spec), [spec])
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#b8bcc4', metalness: 0.85, roughness: 0.35, transparent: true }), [])
  useLayoutEffect(() => {
    material.current = mat
  }, [mat, material])
  useLayoutEffect(
    () => () => {
      geometries.forEach((g) => g.dispose())
      mat.dispose()
    },
    [geometries, mat],
  )
  const count = Math.max(1, Math.min(part.quantity ?? 1, 24))
  const gap = Math.max(spec.d * 3, (part.size[0] || spec.d * 3 * count) / count)
  return (
    <group onClick={onClick}>
      {Array.from({ length: count }, (_, i) => (
        <group key={i} position={[(i - (count - 1) / 2) * gap, 0, 0]}>
          {geometries.map((g, k) => (
            <mesh key={k} geometry={g} material={mat} />
          ))}
        </group>
      ))}
    </group>
  )
}
