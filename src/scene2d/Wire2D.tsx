import { memo } from 'react'
import type { Gate, Wire } from '../engine'
import { pinPosition } from '../scene/layout'
import { useCircuitStore } from '../state/circuitStore'

interface Wire2DProps {
  wire: Wire
  fromGate: Gate
  toGate: Gate
}

/** Orthogonal (Manhattan-style) elbow path between two points, schematic style. */
function elbowPath(x1: number, y1: number, x2: number, y2: number): string {
  if (Math.abs(y1 - y2) < 1e-6) return `M ${x1} ${y1} L ${x2} ${y2}`
  const midX = (x1 + x2) / 2
  return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`
}

function Wire2DComponent({ wire, fromGate, toGate }: Wire2DProps) {
  const selectedWireId = useCircuitStore((s) => s.selectedWireId)
  const selectedWireIds = useCircuitStore((s) => s.selectedWireIds)
  const select = useCircuitStore((s) => s.select)
  const removeWire = useCircuitStore((s) => s.removeWire)

  const isSelected = selectedWireId === wire.id || selectedWireIds.includes(wire.id)
  const active = fromGate.outputValues[wire.from.pin] ?? false

  const [x1, , z1] = pinPosition(fromGate, true, wire.from.pin)
  const [x2, , z2] = pinPosition(toGate, false, wire.to.pin)
  const d = elbowPath(x1, z1, x2, z2)
  const color = isSelected ? '#eab308' : active ? '#22c55e' : '#9aa3b0'

  return (
    <g
      onClick={(e) => {
        e.stopPropagation()
        select({ wireId: wire.id })
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        removeWire(wire.id)
      }}
    >
      {/* Wide transparent path underneath widens the click/double-click hit
          target well past the thin visible stroke. */}
      <path d={d} fill="none" stroke="transparent" strokeWidth={0.32} style={{ cursor: 'pointer' }} />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={active ? 0.05 : 0.036}
        strokeLinejoin="round"
        pointerEvents="none"
      />
      {active && (
        <circle r={0.05} fill="#166534" pointerEvents="none">
          <animateMotion dur="1.1s" repeatCount="indefinite" path={d} />
        </circle>
      )}
    </g>
  )
}

export const Wire2D = memo(Wire2DComponent)
