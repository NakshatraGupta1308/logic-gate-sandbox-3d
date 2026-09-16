import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Gate, Wire } from '../engine'
import { buildWireCurve, pinPosition } from './layout'
import { useCircuitStore } from '../state/circuitStore'

const SAMPLE_COUNT = 24
const PULSE_SPEED = 0.6
const OUTLINE_RADIUS = 0.055
const CORE_RADIUS = 0.032

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

  const outlineGeometry = useMemo(
    () => new THREE.TubeGeometry(curve, SAMPLE_COUNT, OUTLINE_RADIUS, 8, false),
    [curve],
  )
  const coreGeometry = useMemo(
    () => new THREE.TubeGeometry(curve, SAMPLE_COUNT, CORE_RADIUS, 8, false),
    [curve],
  )
  // A separate invisible tube (full outline radius) is the actual click
  // target: the visible outline mesh uses BackSide so the colored core
  // shows through, which would otherwise shrink the clickable area down
  // to the thin rim.
  const hitGeometry = useMemo(
    () => new THREE.TubeGeometry(curve, SAMPLE_COUNT, OUTLINE_RADIUS, 8, false),
    [curve],
  )

  const pulseGroupRef = useRef<THREE.Group>(null)
  const tRef = useRef(0)

  useFrame((_, delta) => {
    if (!active || !pulseGroupRef.current) return
    tRef.current = (tRef.current + delta * PULSE_SPEED) % 1
    curve.getPoint(tRef.current, pulseGroupRef.current.position)
  })

  const coreColor = isSelected ? '#facc15' : active ? '#22c55e' : '#c7cbd1'

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
      <mesh geometry={hitGeometry}>
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {/* Same inverted-hull trick as the gate outlines: a larger BackSide
          black tube shows only where it pokes out past the colored core,
          reading as an inked border instead of hiding the core entirely. */}
      <mesh geometry={outlineGeometry} raycast={() => null}>
        <meshBasicMaterial color="#161616" side={THREE.BackSide} />
      </mesh>
      <mesh geometry={coreGeometry} raycast={() => null}>
        <meshBasicMaterial color={coreColor} />
      </mesh>
      {active && (
        <group ref={pulseGroupRef}>
          <mesh raycast={() => null} scale={1.5}>
            <sphereGeometry args={[0.06, 12, 12]} />
            <meshBasicMaterial color="#161616" side={THREE.BackSide} />
          </mesh>
          <mesh raycast={() => null}>
            <sphereGeometry args={[0.06, 12, 12]} />
            <meshBasicMaterial color="#bbf7d0" />
          </mesh>
        </group>
      )}
    </group>
  )
}
