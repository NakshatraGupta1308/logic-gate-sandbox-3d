import { memo, useRef } from 'react'
import { getGateDef, type Gate } from '../engine'
import { buildGateOutline } from '../export/gateOutline'
import { GATE_HEIGHT, GATE_WIDTH, PIN_RADIUS, pinPosition, snapToGrid } from '../scene/layout'
import { useCircuitStore } from '../state/circuitStore'
import { GATE_Y } from '../state/constants'
import { pathCommandsToSvg } from './svgPath'

const HALF_WIDTH = GATE_WIDTH / 2
const HALF_HEIGHT = GATE_HEIGHT / 2
const DRAG_THRESHOLD = 0.05
// A pin's visible dot (PIN_RADIUS) is tiny at typical zoom levels, so its
// click/drop target is a separate, much larger invisible circle: without
// this, a wire drag that lands just barely off the dot falls through to
// the gate body or background instead of completing on the pin.
const PIN_HIT_RADIUS = 0.22

interface GateSymbol2DProps {
  gate: Gate
  clientToWorld: (clientX: number, clientY: number) => { x: number; z: number }
}

function GateSymbol2DComponent({ gate, clientToWorld }: GateSymbol2DProps) {
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
  const pushHistory = useCircuitStore((s) => s.pushHistory)

  const isSelected = selectedGateId === gate.id
  const isDragging = useRef(false)
  const dragMoved = useRef(false)
  const dragStartWorld = useRef({ x: 0, z: 0 })
  const dragStartGatePos = useRef({ x: 0, z: 0 })

  const [cx, , cz] = gate.position
  const outline = buildGateOutline(gate.kind, { cx, cy: cz, halfWidth: HALF_WIDTH, halfHeight: HALF_HEIGHT })

  const isOn = gate.kind === 'INPUT' ? gate.outputValues[0] : (gate.inputValues[0] ?? false)
  const bodyFill =
    gate.kind === 'INPUT' && isOn
      ? '#fde68a'
      : gate.kind === 'OUTPUT'
        ? isOn
          ? '#bbf7d0'
          : '#ffffff'
        : '#ffffff'
  const strokeColor = isSelected ? '#eab308' : '#111111'
  const strokeWidth = isSelected ? 0.045 : 0.028

  function handlePointerDown(e: React.PointerEvent) {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    isDragging.current = true
    dragMoved.current = false
    dragStartWorld.current = clientToWorld(e.clientX, e.clientY)
    dragStartGatePos.current = { x: gate.position[0], z: gate.position[2] }
    setInteracting(true)
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!isDragging.current) return
    const world = clientToWorld(e.clientX, e.clientY)
    const dx = world.x - dragStartWorld.current.x
    const dz = world.z - dragStartWorld.current.z
    if (Math.hypot(dx, dz) > DRAG_THRESHOLD) {
      if (!dragMoved.current) pushHistory()
      dragMoved.current = true
    }
    if (!dragMoved.current) return
    moveGate(gate.id, [
      snapToGrid(dragStartGatePos.current.x + dx),
      GATE_Y,
      snapToGrid(dragStartGatePos.current.z + dz),
    ])
  }

  function handlePointerUp(e: React.PointerEvent) {
    e.stopPropagation()
    isDragging.current = false
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    setInteracting(false)
  }

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (dragMoved.current) {
      dragMoved.current = false
      return
    }
    select({ gateId: gate.id })
    if (gate.kind === 'INPUT') toggleInput(gate.id)
  }

  const valueLabel = gate.kind === 'INPUT' ? (isOn ? '1' : '0') : gate.kind === 'OUTPUT' ? (isOn ? '1' : '0') : null

  return (
    <g>
      {outline.backCurve && (
        <path d={pathCommandsToSvg(outline.backCurve)} fill="none" stroke="#111111" strokeWidth={0.028} />
      )}

      <path
        d={pathCommandsToSvg(outline.body)}
        fill={bodyFill}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={handleClick}
        style={{ cursor: 'pointer' }}
      />

      {outline.bubble && (
        <circle
          cx={outline.bubble.cx}
          cy={outline.bubble.cy}
          r={outline.bubble.r}
          fill="#ffffff"
          stroke="#111111"
          strokeWidth={0.024}
        />
      )}

      {valueLabel && (
        <text
          x={cx}
          y={cz}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={0.32}
          fontWeight={800}
          fill="#111111"
          pointerEvents="none"
        >
          {valueLabel}
        </text>
      )}

      <text
        x={cx}
        y={cz + HALF_HEIGHT + 0.28}
        textAnchor="middle"
        fontSize={0.2}
        fontWeight={700}
        fill="#4b5563"
        pointerEvents="none"
      >
        {def.label}
      </text>

      {Array.from({ length: def.numInputs }, (_, pin) => {
        const [px, , pz] = pinPosition(gate, false, pin)
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
          <g key={`in-${pin}`}>
            <line x1={px} y1={pz} x2={outline.inputStubX} y2={pz} stroke="#111111" strokeWidth={0.022} />
            <circle
              cx={px}
              cy={pz}
              r={isHovered ? PIN_RADIUS * 1.6 : PIN_RADIUS}
              fill={color}
              stroke="#111111"
              strokeWidth={0.018}
              pointerEvents="none"
            />
            <circle
              cx={px}
              cy={pz}
              r={PIN_HIT_RADIUS}
              fill="transparent"
              style={{ cursor: 'crosshair' }}
              onPointerDown={(e) => {
                // Without this, a plain click here (no wire being dragged)
                // bubbles unstopped to the background, which grabs pointer
                // capture on this tiny circle; the release below then stops
                // propagation before the background ever sees the matching
                // pointerup to release it, leaving capture (and every
                // future click) stuck on this pin.
                e.stopPropagation()
              }}
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
                  setInteracting(false)
                }
              }}
            />
          </g>
        )
      })}

      {Array.from({ length: def.numOutputs }, (_, pin) => {
        const [px, , pz] = pinPosition(gate, true, pin)
        const value = gate.outputValues[pin] ?? false
        const color = value ? '#22c55e' : '#6b7280'
        return (
          <g key={`out-${pin}`}>
            <line x1={outline.outputStubX} y1={pz} x2={px} y2={pz} stroke="#111111" strokeWidth={0.022} />
            <circle
              cx={px}
              cy={pz}
              r={PIN_RADIUS}
              fill={color}
              stroke="#111111"
              strokeWidth={0.018}
              pointerEvents="none"
            />
            <circle
              cx={px}
              cy={pz}
              r={PIN_HIT_RADIUS}
              fill="transparent"
              style={{ cursor: 'crosshair' }}
              onPointerDown={(e) => {
                e.stopPropagation()
                beginWireDrag({ gateId: gate.id, pin, isOutput: true })
                setInteracting(true)
              }}
            />
          </g>
        )
      })}
    </g>
  )
}

export const GateSymbol2D = memo(GateSymbol2DComponent)
