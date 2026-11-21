import { Grid, OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Suspense, useMemo } from 'react'
import AutoFrame from './AutoFrame'
import { blockFrame, blockTraySlots } from './tray'
import BlockoutModel from './BlockoutModel'
import ModelErrorBoundary from './ModelErrorBoundary'
import ScannedModel from './ScannedModel'
import SpinDriver from './SpinDriver'
import StudioLighting from './StudioLighting'
import type { ViewerProps } from './types'

export type { SizeCheck, Source, ViewerProps } from './types'

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

  // Frame the object plus the tray spots that are in use right now (approximated with the block sizes).
  const slots = useMemo(() => blockTraySlots(analysis), [analysis])
  const { box, frameKey } = useMemo(() => blockFrame(analysis, props.states, slots), [analysis, slots, props.states])
  const showingScan = props.source === 'scan' && props.modelFiles.length > 0
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
        // Keyed on the files + retry count, so a new part or a retry gets a fresh attempt instead of staying on boxes.
        <ModelErrorBoundary key={`${props.retryKey ?? 0}:${props.modelFiles.length}`} fallback={blockout} onError={props.onScanError}>
          <StudioLighting />
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
      {/* The scanned model frames its own (real-size) tray layout. */}
      {!showingScan && <AutoFrame box={box} frameKey={frameKey} />}
    </Canvas>
  )
}
