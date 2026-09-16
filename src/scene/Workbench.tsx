import type { ThreeEvent } from '@react-three/fiber'
import { GATE_Y } from '../state/circuitStore'
import { useCircuitStore } from '../state/circuitStore'
import { snapToGrid } from './layout'

const HALF_SIZE = 12
const MINOR_SPACING = 0.5
const MAJOR_SPACING = 2

export function Workbench() {
  const placingKind = useCircuitStore((s) => s.placingKind)
  const pendingWireFrom = useCircuitStore((s) => s.pendingWireFrom)
  const placeGate = useCircuitStore((s) => s.placeGate)
  const select = useCircuitStore((s) => s.select)
  const updateDragPoint = useCircuitStore((s) => s.updateDragPoint)
  const cancelWireDrag = useCircuitStore((s) => s.cancelWireDrag)
  const setInteracting = useCircuitStore((s) => s.setInteracting)

  function handleClick(e: ThreeEvent<MouseEvent>) {
    e.stopPropagation()
    if (placingKind) {
      placeGate(placingKind, [snapToGrid(e.point.x), GATE_Y, snapToGrid(e.point.z)])
      return
    }
    select({})
  }

  function handlePointerMove(e: ThreeEvent<PointerEvent>) {
    if (!pendingWireFrom) return
    updateDragPoint([e.point.x, GATE_Y, e.point.z])
  }

  function handlePointerUp(e: ThreeEvent<PointerEvent>) {
    if (!pendingWireFrom) return
    e.stopPropagation()
    cancelWireDrag()
    setInteracting(false)
  }

  return (
    <group>
      {/* Flat, unshaded plane so the workbench reads like a sheet of paper. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        onClick={handleClick}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <planeGeometry args={[HALF_SIZE * 2, HALF_SIZE * 2]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>

      {/* Graph-paper grid: fine minor lines under bold major lines. */}
      <gridHelper
        position={[0, 0.001, 0]}
        args={[HALF_SIZE * 2, (HALF_SIZE * 2) / MINOR_SPACING, '#d7dce3', '#d7dce3']}
      />
      <gridHelper
        position={[0, 0.002, 0]}
        args={[HALF_SIZE * 2, (HALF_SIZE * 2) / MAJOR_SPACING, '#9aa3b0', '#9aa3b0']}
      />
    </group>
  )
}
