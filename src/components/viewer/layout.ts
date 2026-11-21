import * as THREE from 'three'
import type { Layout } from '../../shared/types'

/**
 * SAM 3D pose → three.js matrix. Mesh vertices are glTF Y-up; the pose maps Z-up object space
 * into PyTorch3D camera space (+X left, +Y up, +Z away from the camera), with row-vector
 * rotation (p · R). Checked against the photo: parts lower/left in the image land lower/left.
 */
export function layoutMatrix(l: Layout): THREE.Matrix4 {
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
