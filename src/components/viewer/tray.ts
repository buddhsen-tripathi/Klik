import * as THREE from 'three'
import { removalOrder, type PartState } from '../../explode'
import type { Analysis } from '../../shared/types'

/**
 * The parts tray: every part that comes off gets its own spot on the ground in front of the
 * object, in the order the guide takes them off, so the layout never shuffles between steps.
 * All sizes in scene cm; x = width, z = depth.
 */
export interface TrayItem {
  key: string
  w: number
  d: number
}
export type Slot = { x: number; z: number }

export interface Footprint {
  w: number
  d: number
}

export function layoutTray(items: TrayItem[], object: Footprint): Map<string, { x: number; z: number }> {
  const big = Math.max(object.w, object.d, 1)
  const gap = Math.max(1, big * 0.06)
  const rowWidth = Math.max(object.w * 1.3, big, ...items.map((i) => i.w))
  const rows: { items: TrayItem[]; width: number; depth: number }[] = []
  for (const item of items) {
    const row = rows[rows.length - 1]
    if (row && row.width + gap + item.w <= rowWidth) {
      row.items.push(item)
      row.width += gap + item.w
      row.depth = Math.max(row.depth, item.d)
    } else rows.push({ items: [item], width: item.w, depth: item.d })
  }
  const slots = new Map<string, { x: number; z: number }>()
  let z = object.d / 2 + gap * 2
  for (const row of rows) {
    let x = -row.width / 2
    for (const item of row.items) {
      slots.set(item.key, { x: x + item.w / 2, z: z + row.depth / 2 })
      x += item.w + gap
    }
    z += row.depth + gap
  }
  return slots
}

/** Tray spots for the boxes, in the order the guide takes the parts off. */
export function blockTraySlots(analysis: Analysis): Map<string, Slot> {
  const order = removalOrder(analysis)
  const items = analysis.parts
    .filter((p) => order.has(p.id))
    .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
    .map((p) => ({ key: p.id, w: p.size[0], d: p.shape === 'cylinder' ? p.size[0] : p.size[2] }))
  return layoutTray(items, { w: analysis.dimensions[0], d: analysis.dimensions[2] })
}

/** Size of a part's box on the ground (cylinders stand upright). */
export const blockFootprint = (p: Analysis['parts'][number]) => ({ w: p.size[0], h: p.size[1], d: p.shape === 'cylinder' ? p.size[0] : p.size[2] })

/** Box around `base` plus every tray spot in use, and a key that changes when that set does (for AutoFrame). */
export function frameWithTray(
  base: THREE.Box3,
  spots: { key: string; x: number; z: number; w: number; h: number; d: number; inUse: boolean }[],
): { box: THREE.Box3; frameKey: string } {
  const box = base.clone()
  const used: string[] = []
  for (const s of spots) {
    if (!s.inUse) continue
    used.push(s.key)
    box.union(new THREE.Box3(new THREE.Vector3(s.x - s.w / 2, 0, s.z - s.d / 2), new THREE.Vector3(s.x + s.w / 2, s.h, s.z + s.d / 2)))
  }
  return { box, frameKey: `${base.min.toArray().join()}|${base.max.toArray().join()}|${used.join()}` }
}

/** Framing for the block model: the object's dimensions plus the parts on the tray. */
export function blockFrame(analysis: Analysis, states: Map<string, PartState>, slots: Map<string, Slot>) {
  const [w, h, d] = analysis.dimensions
  const base = new THREE.Box3(new THREE.Vector3(-w / 2, 0, -d / 2), new THREE.Vector3(w / 2, h, d / 2))
  return frameWithTray(
    base,
    analysis.parts.flatMap((p) => {
      const slot = slots.get(p.id)
      return slot ? [{ key: p.id, ...slot, ...blockFootprint(p), inUse: !!states.get(p.id)?.tray }] : []
    }),
  )
}
