import { useRef } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { getGateDef, type Gate, type GateKind } from '../engine'
import { GATE_DEPTH, GATE_HEIGHT, GATE_WIDTH, PIN_RADIUS, pinPosition, snapToGrid } from './layout'
import { useCircuitStore } from '../state/circuitStore'

const GATE_COLORS: Partial<Record<GateKind, string>> = {
  AND: '#2563eb',
  OR: '#7c3aed',
  NOT: '#db2777',
  XOR: '#0891b2',
  NAND: '#65a30d',
  NOR: '#ea580c',
  XNOR: '#4f46e5',
}

const OFF_COLOR = '#374151'
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const DRAG_THRESHOLD = 0.05

interface GateMeshProps {
  gate: Gate
}

export function GateMesh({ gate }: GateMeshProps) {
  const def = getGateDef(gate.kind)
  const selectedGateId = useCircuitStore((s) => s.selectedGateId)
  const pendingWireFrom = useCircuitStore((s) => s.pendingWireFrom)
  const hoveredPin = useCircuitStore((s) => s.hoveredPin)
  const circuit = useCircuitStore((s) => s.circuit)
  const select = useCircuitStore((s) => s.select)
  const moveGate = useCircuitStore((s) => s.moveGate)
  const toggleInput = useCircuitStore((s) => s.toggleInput)
  const setInteracting = useCircuitStore((s) => s.setInteracting)
  const beginWireDrag = useCircuitStore((s) => s.beginWireDrag)
  const setHoveredPin = useCircuitStore((s) => s.setHoveredPin)
  const completeWireDrag = useCircuitStore((s) => s.completeWireDrag)

  const isSelected = selectedGateId === gate.id
  const isDragging = useRef(false)
  const dragMoved = useRef(false)
  const downPoint = useRef(new THREE.Vector3())

  const isOn = gate.kind === 'INPUT' ? gate.outputValues[0] : (gate.inputValues[0] ?? false)

  const bodyColor =
    gate.kind === 'INPUT'
      ? isOn
        ? '#22c55e'
        : OFF_COLOR
      : gate.kind === 'OUTPUT'
        ? isOn
          ? '#f59e0b'
          : OFF_COLOR
        : (GATE_COLORS[gate.kind] ?? OFF_COLOR)

  function handleBodyPointerDown(e: ThreeEvent<PointerEvent>) {
    e.stopPropagation()
    const target = e.target as Element & { setPointerCapture?: (id: number) => void }
    target.setPointerCapture?.(e.pointerId)
    isDragging.current = true
    dragMoved.current = false
    dragPlane.constant = -gate.position[1]
    e.ray.intersectPlane(dragPlane, downPoint.current)
    setInteracting(true)
  }

  function handleBodyPointerMove(e: ThreeEvent<PointerEvent>) {
    if (!isDragging.current) return
    const point = new THREE.Vector3()
    dragPlane.constant = -gate.position[1]
    if (!e.ray.intersectPlane(dragPlane, point)) return
    if (point.distanceTo(downPoint.current) > DRAG_THRESHOLD) dragMoved.current = true
    moveGate(gate.id, [snapToGrid(point.x), gate.position[1], snapToGrid(point.z)])
  }

  function handleBodyPointerUp(e: ThreeEvent<PointerEvent>) {
    isDragging.current = false
    const target = e.target as Element & { releasePointerCapture?: (id: number) => void }
    target.releasePointerCapture?.(e.pointerId)
    setInteracting(false)
  }

  function handleBodyClick(e: ThreeEvent<MouseEvent>) {
    e.stopPropagation()
    if (dragMoved.current) {
      dragMoved.current = false
      return
    }
    select({ gateId: gate.id })
    if (gate.kind === 'INPUT') toggleInput(gate.id)
  }

  return (
    <group position={gate.position}>
      <mesh
        onPointerDown={handleBodyPointerDown}
        onPointerMove={handleBodyPointerMove}
        onPointerUp={handleBodyPointerUp}
        onClick={handleBodyClick}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[GATE_WIDTH, GATE_HEIGHT, GATE_DEPTH]} />
        <meshStandardMaterial
          color={bodyColor}
          emissive={isSelected ? '#facc15' : '#000000'}
          emissiveIntensity={isSelected ? 0.5 : 0}
          roughness={0.4}
          metalness={0.15}
        />
      </mesh>

      <Html position={[0, GATE_HEIGHT / 2 + 0.3, 0]} center distanceFactor={8} occlude>
        <div className="select-none whitespace-nowrap rounded bg-black/50 px-1.5 py-0.5 text-xs font-medium text-white">
          {gate.kind === 'INPUT' ? (isOn ? 'IN: 1' : 'IN: 0') : def.label}
        </div>
      </Html>

      {Array.from({ length: def.numInputs }, (_, pin) => {
        const world = pinPosition(gate, false, pin)
        const local: [number, number, number] = [
          world[0] - gate.position[0],
          world[1] - gate.position[1],
          world[2] - gate.position[2],
        ]
        const value = gate.inputValues[pin] ?? false
        const isHovered = hoveredPin?.gateId === gate.id && hoveredPin.pin === pin && !hoveredPin.isOutput
        let color = value ? '#22c55e' : '#6b7280'
        if (pendingWireFrom && isHovered) {
          const check = circuit.canAddWire(
            { gateId: pendingWireFrom.gateId, pin: pendingWireFrom.pin },
            { gateId: gate.id, pin },
          )
          color = check.ok ? '#4ade80' : '#f87171'
        }
        return (
          <mesh
            key={`in-${pin}`}
            position={local}
            onPointerOver={(e) => {
              e.stopPropagation()
              setHoveredPin({ gateId: gate.id, pin, isOutput: false })
            }}
            onPointerOut={(e) => {
              e.stopPropagation()
              const current = useCircuitStore.getState().hoveredPin
              if (current?.gateId === gate.id && current.pin === pin && !current.isOutput) {
                setHoveredPin(null)
              }
            }}
            onPointerUp={(e) => {
              e.stopPropagation()
              if (useCircuitStore.getState().pendingWireFrom) {
                completeWireDrag({ gateId: gate.id, pin, isOutput: false })
              }
            }}
          >
            <sphereGeometry args={[isHovered ? PIN_RADIUS * 1.5 : PIN_RADIUS, 12, 12]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={value || isHovered ? 0.8 : 0.1}
            />
          </mesh>
        )
      })}

      {Array.from({ length: def.numOutputs }, (_, pin) => {
        const world = pinPosition(gate, true, pin)
        const local: [number, number, number] = [
          world[0] - gate.position[0],
          world[1] - gate.position[1],
          world[2] - gate.position[2],
        ]
        const value = gate.outputValues[pin] ?? false
        const color = value ? '#22c55e' : '#6b7280'
        return (
          <mesh
            key={`out-${pin}`}
            position={local}
            onPointerDown={(e) => {
              e.stopPropagation()
              beginWireDrag({ gateId: gate.id, pin, isOutput: true })
              setInteracting(true)
            }}
          >
            <sphereGeometry args={[PIN_RADIUS, 12, 12]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={value ? 0.8 : 0.1} />
          </mesh>
        )
      })}
    </group>
  )
}
