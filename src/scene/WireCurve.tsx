import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import type { Gate, Wire } from '../engine'
import { buildWireCurve, pinPosition } from './layout'
import { useCircuitStore } from '../state/circuitStore'

const SAMPLE_COUNT = 24
const PULSE_SPEED = 0.6

interface WireCurveProps {
  wire: Wire
  fromGate: Gate
  toGate: Gate
}

export function WireCurve({ wire, fromGate, toGate }: WireCurveProps) {
  const selectedWireId = useCircuitStore((s) => s.selectedWireId)
  const select = useCircuitStore((s) => s.select)
  const removeWire = useCircuitStore((s) => s.removeWire)

  const isSelected = selectedWireId === wire.id
  const active = fromGate.outputValues[wire.from.pin] ?? false

  const curve = useMemo(() => {
    const from = new THREE.Vector3(...pinPosition(fromGate, true, wire.from.pin))
    const to = new THREE.Vector3(...pinPosition(toGate, false, wire.to.pin))
    return buildWireCurve(from, to)
  }, [fromGate, toGate, wire.from.pin, wire.to.pin])

  const points = useMemo(() => curve.getPoints(SAMPLE_COUNT), [curve])
  const hitGeometry = useMemo(
    () => new THREE.TubeGeometry(curve, SAMPLE_COUNT, 0.09, 6, false),
    [curve],
  )

  const pulseRef = useRef<THREE.Mesh>(null)
  const tRef = useRef(0)

  useFrame((_, delta) => {
    if (!active || !pulseRef.current) return
    tRef.current = (tRef.current + delta * PULSE_SPEED) % 1
    curve.getPoint(tRef.current, pulseRef.current.position)
  })

  const color = isSelected ? '#facc15' : active ? '#22c55e' : '#8b93a3'

  return (
    <group
      onClick={(e) => {
        e.stopPropagation()
        select({ wireId: wire.id })
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        removeWire(wire.id)
      }}
    >
      <Line points={points} color={color} lineWidth={active ? 3 : 2} />
      <mesh geometry={hitGeometry}>
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {active && (
        <mesh ref={pulseRef}>
          <sphereGeometry args={[0.06, 12, 12]} />
          <meshStandardMaterial color="#bbf7d0" emissive="#4ade80" emissiveIntensity={2} />
        </mesh>
      )}
    </group>
  )
}
