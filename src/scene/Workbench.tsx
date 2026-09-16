import type { ThreeEvent } from '@react-three/fiber'
import { Grid } from '@react-three/drei'
import { GATE_Y } from '../state/circuitStore'
import { useCircuitStore } from '../state/circuitStore'
import { snapToGrid } from './layout'

const HALF_SIZE = 12

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
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        onClick={handleClick}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        receiveShadow
      >
        <planeGeometry args={[HALF_SIZE * 2, HALF_SIZE * 2]} />
        <meshStandardMaterial color="#12141a" />
      </mesh>
      <Grid
        position={[0, 0.01, 0]}
        args={[HALF_SIZE * 2, HALF_SIZE * 2]}
        cellSize={0.5}
        cellThickness={0.5}
        cellColor="#2a2d38"
        sectionSize={2.5}
        sectionThickness={1}
        sectionColor="#3b3f4d"
        fadeDistance={20}
        infiniteGrid={false}
      />
    </group>
  )
}
