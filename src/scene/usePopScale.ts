import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'

const DURATION = 0.35

function easeOutBack(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

/**
 * A scale-only "pop" bounce for a group: starts small and overshoots past 1
 * before settling, used both for the initial placement animation (elapsed
 * starts at 0) and re-triggered via `pop()` whenever a gate's value flips.
 */
export function usePopScale() {
  const groupRef = useRef<Group>(null)
  const elapsedRef = useRef(0)

  function pop() {
    elapsedRef.current = 0
  }

  useFrame((_, delta) => {
    const group = groupRef.current
    if (!group) return
    if (elapsedRef.current >= DURATION) {
      group.scale.setScalar(1)
      return
    }
    elapsedRef.current += delta
    const t = Math.min(1, elapsedRef.current / DURATION)
    group.scale.setScalar(Math.max(0.05, easeOutBack(t)))
  })

  return { groupRef, pop }
}
