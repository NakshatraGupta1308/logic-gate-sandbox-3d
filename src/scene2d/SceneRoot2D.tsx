import { useEffect, useRef, useState } from 'react'
import type { Gate } from '../engine'
import { useCircuitStore } from '../state/circuitStore'
import { GATE_Y } from '../state/constants'
import { pinPosition, snapToGrid } from '../scene/layout'
import { GateSymbol2D } from './GateSymbol2D'
import { Wire2D } from './Wire2D'
import { useElementSize } from './useElementSize'

const MINOR_COLOR = '#d7dce3'
const MAJOR_COLOR = '#9aa3b0'
const MINOR_SPACING = 0.5
const MAJOR_SPACING = 2
const MIN_SPAN = 3
const MAX_SPAN = 60
const DEFAULT_SPAN = 16
const PAN_CLICK_THRESHOLD = 4 // pixels

interface Camera {
  centerX: number
  centerZ: number
  span: number
}

const DEFAULT_CAMERA: Camera = { centerX: 0, centerZ: 0, span: DEFAULT_SPAN }

export function SceneRoot2D() {
  const gates = useCircuitStore((s) => s.gates)
  const wires = useCircuitStore((s) => s.wires)
  const gateById = new Map(gates.map((g) => [g.id, g]))
  const placingKind = useCircuitStore((s) => s.placingKind)
  const placeGate = useCircuitStore((s) => s.placeGate)
  const select = useCircuitStore((s) => s.select)
  const pendingWireFrom = useCircuitStore((s) => s.pendingWireFrom)
  const dragPoint = useCircuitStore((s) => s.dragPoint)
  const updateDragPoint = useCircuitStore((s) => s.updateDragPoint)
  const resetViewToken = useCircuitStore((s) => s.resetViewToken)

  const svgRef = useRef<SVGSVGElement>(null)
  const size = useElementSize(svgRef)
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA)

  // Resets pan/zoom when the toolbar's "Reset View" button bumps this
  // token, shared with the 3D scene's own camera reset. Adjusting state
  // directly during render (rather than in an effect) for a prop change is
  // React's documented pattern for this: it re-renders immediately with the
  // reset value instead of committing the stale one first.
  const [lastResetToken, setLastResetToken] = useState(resetViewToken)
  if (resetViewToken !== lastResetToken) {
    setLastResetToken(resetViewToken)
    setCamera(DEFAULT_CAMERA)
  }

  const viewHeight = camera.span * (size.height / size.width)
  const viewBoxX = camera.centerX - camera.span / 2
  const viewBoxY = camera.centerZ - viewHeight / 2

  function clientToWorld(clientX: number, clientY: number) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, z: 0 }
    return {
      x: viewBoxX + ((clientX - rect.left) / rect.width) * camera.span,
      z: viewBoxY + ((clientY - rect.top) / rect.height) * viewHeight,
    }
  }

  // Finishes or cancels a wire drag no matter where the pointer is
  // released. Registered on the capture phase (fires on the way down,
  // before any element is reached) rather than the default bubble phase:
  // a pin's own onPointerUp calls stopPropagation() after handling its
  // case, which would otherwise stop a bubble-phase window listener from
  // ever seeing the event and leave pendingWireFrom (and the enlarged
  // hover state on whatever pin was last under the cursor) stuck forever.
  useEffect(() => {
    function finishDrag() {
      const state = useCircuitStore.getState()
      if (!state.pendingWireFrom) return
      if (state.hoveredPin && !state.hoveredPin.isOutput) {
        state.completeWireDrag(state.hoveredPin)
      } else {
        state.cancelWireDrag()
      }
      state.setInteracting(false)
    }
    window.addEventListener('pointerup', finishDrag, { capture: true })
    window.addEventListener('pointercancel', finishDrag, { capture: true })
    return () => {
      window.removeEventListener('pointerup', finishDrag, { capture: true })
      window.removeEventListener('pointercancel', finishDrag, { capture: true })
    }
  }, [])

  // React's onWheel listener is attached passively, so preventDefault()
  // inside it is silently ignored; a native listener is required to stop
  // the page itself from scrolling while zooming the schematic.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    function handleWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = el!.getBoundingClientRect()
      const fx = (e.clientX - rect.left) / rect.width
      const fy = (e.clientY - rect.top) / rect.height
      setCamera((prev) => {
        const prevHeight = prev.span * (rect.height / rect.width)
        const worldX = prev.centerX - prev.span / 2 + fx * prev.span
        const worldZ = prev.centerZ - prevHeight / 2 + fy * prevHeight
        const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12
        const nextSpan = Math.min(MAX_SPAN, Math.max(MIN_SPAN, prev.span * factor))
        const nextHeight = nextSpan * (rect.height / rect.width)
        return {
          span: nextSpan,
          centerX: worldX - (fx * nextSpan - nextSpan / 2),
          centerZ: worldZ - (fy * nextHeight - nextHeight / 2),
        }
      })
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [])

  const panState = useRef({ active: false, moved: false, startClientX: 0, startClientY: 0, startCamera: DEFAULT_CAMERA })

  function handleBackgroundPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    panState.current = {
      active: true,
      moved: false,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startCamera: camera,
    }
  }

  function handleBackgroundPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (pendingWireFrom) {
      const world = clientToWorld(e.clientX, e.clientY)
      updateDragPoint([world.x, GATE_Y, world.z])
      return
    }
    if (!panState.current.active) return
    const dxPixels = e.clientX - panState.current.startClientX
    const dyPixels = e.clientY - panState.current.startClientY
    if (Math.hypot(dxPixels, dyPixels) > PAN_CLICK_THRESHOLD) {
      panState.current.moved = true
    }
    if (!panState.current.moved) return
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const start = panState.current.startCamera
    const startHeight = start.span * (rect.height / rect.width)
    setCamera({
      span: start.span,
      centerX: start.centerX - (dxPixels / rect.width) * start.span,
      centerZ: start.centerZ - (dyPixels / rect.height) * startHeight,
    })
  }

  function handleBackgroundPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    const wasPan = panState.current.moved
    panState.current.active = false
    panState.current.moved = false
    if (pendingWireFrom || wasPan) return
    const world = clientToWorld(e.clientX, e.clientY)
    if (placingKind) {
      placeGate(placingKind, [snapToGrid(world.x), GATE_Y, snapToGrid(world.z)])
    } else {
      select({})
    }
  }

  function zoomBy(factor: number) {
    setCamera((prev) => ({ ...prev, span: Math.min(MAX_SPAN, Math.max(MIN_SPAN, prev.span * factor)) }))
  }

  const pendingWireFromGate = pendingWireFrom ? gateById.get(pendingWireFrom.gateId) : null

  return (
    <div className="relative h-full w-full bg-white">
      <svg
        ref={svgRef}
        className="h-full w-full touch-none"
        viewBox={`${viewBoxX} ${viewBoxY} ${camera.span} ${viewHeight}`}
        onPointerDown={handleBackgroundPointerDown}
        onPointerMove={handleBackgroundPointerMove}
        onPointerUp={handleBackgroundPointerUp}
        style={{ cursor: placingKind ? 'copy' : 'grab' }}
      >
        <defs>
          <pattern id="grid-minor" width={MINOR_SPACING} height={MINOR_SPACING} patternUnits="userSpaceOnUse">
            <path
              d={`M ${MINOR_SPACING} 0 L 0 0 0 ${MINOR_SPACING}`}
              fill="none"
              stroke={MINOR_COLOR}
              strokeWidth={0.012}
            />
          </pattern>
          <pattern id="grid-major" width={MAJOR_SPACING} height={MAJOR_SPACING} patternUnits="userSpaceOnUse">
            <path
              d={`M ${MAJOR_SPACING} 0 L 0 0 0 ${MAJOR_SPACING}`}
              fill="none"
              stroke={MAJOR_COLOR}
              strokeWidth={0.02}
            />
          </pattern>
        </defs>
        <rect x={viewBoxX - camera.span} y={viewBoxY - viewHeight} width={camera.span * 3} height={viewHeight * 3} fill="#ffffff" />
        <rect x={viewBoxX - camera.span} y={viewBoxY - viewHeight} width={camera.span * 3} height={viewHeight * 3} fill="url(#grid-minor)" />
        <rect x={viewBoxX - camera.span} y={viewBoxY - viewHeight} width={camera.span * 3} height={viewHeight * 3} fill="url(#grid-major)" />

        {wires.map((wire) => {
          const fromGate = gateById.get(wire.from.gateId)
          const toGate = gateById.get(wire.to.gateId)
          if (!fromGate || !toGate) return null
          return <Wire2D key={wire.id} wire={wire} fromGate={fromGate} toGate={toGate} />
        })}

        {gates.map((gate) => (
          <GateSymbol2D key={gate.id} gate={gate} clientToWorld={clientToWorld} />
        ))}

        {pendingWireFrom && dragPoint && pendingWireFromGate && (
          <PendingWireLine2D fromGate={pendingWireFromGate} fromPin={pendingWireFrom.pin} to={dragPoint} />
        )}
      </svg>

      <div className="comic-card pointer-events-auto absolute bottom-4 left-4 flex gap-1 p-1.5">
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.3)}
          className="comic-btn px-2.5 py-1 text-sm font-bold"
          title="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => setCamera(DEFAULT_CAMERA)}
          className="comic-btn px-2.5 py-1 text-xs font-bold"
          title="Reset zoom"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1.3)}
          className="comic-btn px-2.5 py-1 text-sm font-bold"
          title="Zoom out"
        >
          -
        </button>
      </div>
    </div>
  )
}

function PendingWireLine2D({
  fromGate,
  fromPin,
  to,
}: {
  fromGate: Gate
  fromPin: number
  to: [number, number, number]
}) {
  const [x1, , z1] = pinPosition(fromGate, true, fromPin)
  return (
    <line
      x1={x1}
      y1={z1}
      x2={to[0]}
      y2={to[2]}
      stroke="#eab308"
      strokeWidth={0.04}
      strokeDasharray="0.1 0.08"
      pointerEvents="none"
    />
  )
}
