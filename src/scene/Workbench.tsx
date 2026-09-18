import type { ThreeEvent } from '@react-three/fiber'
import { GATE_Y } from '../state/circuitStore'
import { useCircuitStore } from '../state/circuitStore'
import { computeSceneExtent, snapToGrid } from './layout'
import { GridLines, GridSurface } from './GridSurface'

const WALL_HEIGHT = 7

export function Workbench() {
  const placingKind = useCircuitStore((s) => s.placingKind)
  const pendingWireFrom = useCircuitStore((s) => s.pendingWireFrom)
  const placeGate = useCircuitStore((s) => s.placeGate)
  const select = useCircuitStore((s) => s.select)
  const updateDragPoint = useCircuitStore((s) => s.updateDragPoint)
  const cancelWireDrag = useCircuitStore((s) => s.cancelWireDrag)
  const setInteracting = useCircuitStore((s) => s.setInteracting)
  // Grows to fit every gate (see computeSceneExtent) rather than a fixed
  // size, so a large built or imported circuit is not cramped into a
  // small room. SceneRoot's CameraRig computes the same value for its
  // OrbitControls maxDistance, so the two always stay in sync.
  const boxHalfSize = useCircuitStore((s) => computeSceneExtent(s.gates))

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

  const size = boxHalfSize * 2

  return (
    <group>
      {/* Floor: flat, unshaded, and the only surface that handles gate
          placement and wire-drag clicks. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        onClick={handleClick}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <GridLines width={size} height={size} />
      </group>

      {/* Four walls enclosing the workbench so the scene reads as a room
          rather than a floor floating in an infinite white void. Each
          panel's local +Z, after its rotation below, points back toward
          the box's interior. No ceiling: it would block the top-down
          orbit view for no visual benefit, since the sky and the walls
          are already the same white. */}
      <GridSurface
        width={size}
        height={WALL_HEIGHT}
        position={[0, WALL_HEIGHT / 2, -boxHalfSize]}
      />
      <GridSurface
        width={size}
        height={WALL_HEIGHT}
        position={[0, WALL_HEIGHT / 2, boxHalfSize]}
        rotation={[0, Math.PI, 0]}
      />
      <GridSurface
        width={size}
        height={WALL_HEIGHT}
        position={[boxHalfSize, WALL_HEIGHT / 2, 0]}
        rotation={[0, -Math.PI / 2, 0]}
      />
      <GridSurface
        width={size}
        height={WALL_HEIGHT}
        position={[-boxHalfSize, WALL_HEIGHT / 2, 0]}
        rotation={[0, Math.PI / 2, 0]}
      />
    </group>
  )
}
