import { Environment, Lightformer } from '@react-three/drei'

/**
 * Soft studio reflections so textured scans read well (metal, plastic, paint).
 * Rendered once into a small cube map: no HDR download, no per-frame cost.
 */
export default function StudioLighting() {
  return (
    <Environment resolution={128} frames={1}>
      <Lightformer intensity={2} position={[0, 5, -5]} scale={[10, 5, 1]} />
      <Lightformer intensity={1.2} position={[-5, 2, 1]} rotation-y={Math.PI / 2} scale={[10, 3, 1]} />
      <Lightformer intensity={1.2} position={[5, 2, 1]} rotation-y={-Math.PI / 2} scale={[10, 3, 1]} />
      <Lightformer intensity={0.6} position={[0, -4, 0]} rotation-x={-Math.PI / 2} scale={[10, 10, 1]} />
    </Environment>
  )
}
