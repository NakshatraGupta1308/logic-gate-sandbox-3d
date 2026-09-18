import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { getGateDef, type Gate, type Vec3 } from '../engine'
import { GATE_HEIGHT, PIN_RADIUS, pinPosition, snapToGrid } from './layout'
import { GATE_BODY_COLOR, GATE_SYMBOL } from './gateVisuals'
import { getGateShape3D } from './gateShape3d'
import { GateTooltip } from './GateTooltip'
import { usePopScale } from './usePopScale'
import { useCircuitStore } from '../state/circuitStore'

const OUTLINE_COLOR = '#161616'
const OUTLINE_SCALE = 1.09
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const DRAG_THRESHOLD = 0.05

interface GateMeshProps {
  gate: Gate
}

function GateMeshComponent({ gate }: GateMeshProps) {
  const def = getGateDef(gate.kind)
  const selectedGateId = useCircuitStore((s) => s.selectedGateId)
  const selectedGateIds = useCircuitStore((s) => s.selectedGateIds)
  const isInteracting = useCircuitStore((s) => s.isInteracting)
  const pendingWireFrom = useCircuitStore((s) => s.pendingWireFrom)
  const hoveredPin = useCircuitStore((s) => s.hoveredPin)
  const circuit = useCircuitStore((s) => s.circuit)
  const select = useCircuitStore((s) => s.select)
  const moveGate = useCircuitStore((s) => s.moveGate)
  const moveGatesBatch = useCircuitStore((s) => s.moveGatesBatch)
  const toggleInput = useCircuitStore((s) => s.toggleInput)
  const setInteracting = useCircuitStore((s) => s.setInteracting)
  const beginWireDrag = useCircuitStore((s) => s.beginWireDrag)
  const setHoveredPin = useCircuitStore((s) => s.setHoveredPin)
  const completeWireDrag = useCircuitStore((s) => s.completeWireDrag)
  const pushHistory = useCircuitStore((s) => s.pushHistory)

  const isGroupSelected = selectedGateIds.length > 1 && selectedGateIds.includes(gate.id)
  const isSelected = selectedGateId === gate.id || isGroupSelected
  const isDragging = useRef(false)
  const dragMoved = useRef(false)
  const downPoint = useRef(new THREE.Vector3())
  const groupStartPositions = useRef<Map<string, Vec3>>(new Map())
  const [isHoveredBody, setIsHoveredBody] = useState(false)
  const { geometry, bubble, backCurveGeometry } = useMemo(() => getGateShape3D(gate.kind), [gate.kind])

  const { groupRef: popRef, pop } = usePopScale()
  const currentValue = gate.kind === 'OUTPUT' ? (gate.inputValues[0] ?? false) : (gate.outputValues[0] ?? false)
  const previousValue = useRef(currentValue)
  useEffect(() => {
    if (previousValue.current !== currentValue) {
      previousValue.current = currentValue
      pop()
    }
  }, [currentValue, pop])

  const isOn = gate.kind === 'INPUT' ? gate.outputValues[0] : (gate.inputValues[0] ?? false)
  const bodyColor = GATE_BODY_COLOR[gate.kind]
  const outlineColor =
    gate.kind === 'OUTPUT' ? (isOn ? '#22c55e' : OUTLINE_COLOR) : OUTLINE_COLOR

  function handleBodyPointerDown(e: ThreeEvent<PointerEvent>) {
    e.stopPropagation()
    const target = e.target as Element & { setPointerCapture?: (id: number) => void }
    target.setPointerCapture?.(e.pointerId)
    isDragging.current = true
    dragMoved.current = false
    dragPlane.constant = -gate.position[1]
    e.ray.intersectPlane(dragPlane, downPoint.current)
    if (isGroupSelected) {
      const { gates, selectedGateIds: ids } = useCircuitStore.getState()
      const starts = new Map<string, Vec3>()
      for (const id of ids) {
        const g = gates.find((candidate) => candidate.id === id)
        if (g) starts.set(id, g.position)
      }
      groupStartPositions.current = starts
    }
    setInteracting(true)
  }

  function handleBodyPointerMove(e: ThreeEvent<PointerEvent>) {
    if (!isDragging.current) return
    const point = new THREE.Vector3()
    dragPlane.constant = -gate.position[1]
    if (!e.ray.intersectPlane(dragPlane, point)) return
    if (point.distanceTo(downPoint.current) > DRAG_THRESHOLD) {
      // Record one undo step for the whole drag, right before it actually
      // starts moving, rather than one per pointermove.
      if (!dragMoved.current) pushHistory()
      dragMoved.current = true
    }
    if (isGroupSelected && groupStartPositions.current.size > 0) {
      const dx = point.x - downPoint.current.x
      const dz = point.z - downPoint.current.z
      const moves = Array.from(groupStartPositions.current.entries()).map(([id, position]) => ({
        id,
        position: [snapToGrid(position[0] + dx), position[1], snapToGrid(position[2] + dz)] as Vec3,
      }))
      moveGatesBatch(moves)
    } else {
      moveGate(gate.id, [snapToGrid(point.x), gate.position[1], snapToGrid(point.z)])
    }
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

  function handleBodyPointerOver(e: ThreeEvent<PointerEvent>) {
    e.stopPropagation()
    setIsHoveredBody(true)
  }

  function handleBodyPointerOut(e: ThreeEvent<PointerEvent>) {
    e.stopPropagation()
    setIsHoveredBody(false)
  }

  return (
    <group position={gate.position}>
      <group ref={popRef}>
        {/* Inverted-hull outline: a larger black backface-only copy behind
            the body, the standard toon-outline trick without postprocessing. */}
        <mesh geometry={geometry} scale={OUTLINE_SCALE} raycast={() => null}>
          <meshBasicMaterial color={outlineColor} side={THREE.BackSide} />
        </mesh>

        <mesh
          geometry={geometry}
          onPointerDown={handleBodyPointerDown}
          onPointerMove={handleBodyPointerMove}
          onPointerUp={handleBodyPointerUp}
          onClick={handleBodyClick}
          onPointerOver={handleBodyPointerOver}
          onPointerOut={handleBodyPointerOut}
        >
          <meshToonMaterial
            color={bodyColor}
            emissive={isSelected ? '#facc15' : gate.kind === 'INPUT' && isOn ? '#fde68a' : '#000000'}
            emissiveIntensity={isSelected ? 0.6 : gate.kind === 'INPUT' && isOn ? 0.7 : 0}
          />
        </mesh>

        {/* Inversion bubble (NAND/NOR/XNOR/NOT), matching the 2D symbol. */}
        {bubble && (
          <group position={bubble.position}>
            <mesh scale={1.3} raycast={() => null}>
              <sphereGeometry args={[bubble.radius, 12, 12]} />
              <meshBasicMaterial color={outlineColor} side={THREE.BackSide} />
            </mesh>
            <mesh raycast={() => null}>
              <sphereGeometry args={[bubble.radius, 12, 12]} />
              <meshToonMaterial color="#ffffff" />
            </mesh>
          </group>
        )}

        {/* XOR/XNOR's extra back curve, stroke-only like the 2D symbol. */}
        {backCurveGeometry && (
          <mesh geometry={backCurveGeometry} raycast={() => null}>
            <meshBasicMaterial color={outlineColor} />
          </mesh>
        )}
      </group>

      {/* No `occlude`: with occlude={true}, drei raycasts against the
          whole scene on every camera move to decide visibility, which is
          O(gate count) per label and O(gate count squared) in total since
          every gate has one of these - catastrophic once a circuit has more
          than a few dozen gates. The label floating just above its own gate
          is worth showing unconditionally in exchange for staying smooth. */}
      <Html position={[0, GATE_HEIGHT / 2 + 0.34, 0]} center distanceFactor={8}>
        <div className="pointer-events-none flex select-none flex-col items-center">
          <div className="rounded-md border-2 border-black bg-white px-1.5 py-0.5 text-center leading-none shadow-[2px_2px_0_#000]">
            <span className="text-base font-extrabold">{GATE_SYMBOL[gate.kind]}</span>
          </div>
          <div className="mt-0.5 whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {gate.kind === 'INPUT' ? (isOn ? 'IN: 1' : 'IN: 0') : def.label}
          </div>
        </div>
      </Html>

      {isHoveredBody && !pendingWireFrom && !isInteracting && (
        <Html position={[0, -GATE_HEIGHT / 2 - 0.2, 0]} center distanceFactor={8} occlude>
          <GateTooltip gate={gate} />
        </Html>
      )}

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
            <meshToonMaterial
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
            <meshToonMaterial color={color} emissive={color} emissiveIntensity={value ? 0.8 : 0.1} />
          </mesh>
        )
      })}
    </group>
  )
}

// The scene layer keeps a stable `gate` reference for gates whose visible
// fields haven't changed since the last simulation pass (see refresh() in
// circuitStore.ts), so memoizing here skips re-rendering every other gate
// in the circuit whenever one gate's value flips.
export const GateMesh = memo(GateMeshComponent)
