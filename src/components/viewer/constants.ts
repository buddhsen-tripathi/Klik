import * as THREE from 'three'
import type { PartState } from '../../explode'

export const ACTIVE_COLOR = new THREE.Color('#d87943')
export const BLACK = new THREE.Color('#000000')
export const deg = (d: number) => (d * Math.PI) / 180
export const ORIENTS = [0, -Math.PI / 2, Math.PI / 2, Math.PI]
export const NO_STATE: PartState = { offset: 0, tray: false, active: false }
export const EASE = 6 // higher = snappier animation
export const EPS = 0.01
