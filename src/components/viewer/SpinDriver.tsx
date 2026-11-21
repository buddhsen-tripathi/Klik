import { useFrame, useThree } from '@react-three/fiber'
import { useEffect } from 'react'

/** With frameloop="demand", keep requesting frames only while the turntable is on. */
export default function SpinDriver({ on }: { on: boolean }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    if (on) invalidate()
  }, [on, invalidate])
  useFrame(() => {
    if (on) invalidate()
  })
  return null
}

// ---------------- Blockout: Gemini's simple-shape model ----------------
