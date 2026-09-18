import { getGateDef } from '../engine'
import type { Gate, Vec3 } from '../engine'

export const GATE_WIDTH = 1.4
export const GATE_HEIGHT = 0.8
export const GATE_DEPTH = 0.7
export const PIN_RADIUS = 0.08
export const PIN_STANDOFF = 0.22
export const GRID_SIZE = 0.5

function pinOffsets(count: number): number[] {
  if (count === 0) return []
  if (count === 1) return [0]
  const spacing = 0.32
  const start = -((count - 1) * spacing) / 2
  return Array.from({ length: count }, (_, i) => start + i * spacing)
}

/**
 * World position of a gate's Nth input or output pin. Multiple pins on the
 * same side are spread along depth (Z) so every pin sits at the same
 * height, letting wires between them sag naturally along Y like real cable.
 */
export function pinPosition(gate: Gate, isOutput: boolean, pin: number): Vec3 {
  const def = getGateDef(gate.kind)
  const count = isOutput ? def.numOutputs : def.numInputs
  const offsets = pinOffsets(count)
  const x = gate.position[0] + (isOutput ? 1 : -1) * (GATE_WIDTH / 2 + PIN_STANDOFF)
  const y = gate.position[1]
  const z = gate.position[2] + (offsets[pin] ?? 0)
  return [x, y, z]
}

export function snapToGrid(value: number, size = GRID_SIZE): number {
  return Math.round(value / size) * size
}

const MIN_SCENE_HALF_SIZE = 10
const MIN_SCENE_PADDING = 3
// The margin past the farthest gate scales with the circuit's own size
// rather than staying a fixed +3: since the 3D camera's max distance and
// the workbench walls are both sized off this same extent, a fixed margin
// left almost no room to pull the camera back and frame a gate near the
// edge of a big circuit (the wall/max-distance was only ~3 units past it).
const SCENE_PADDING_RATIO = 0.5

/**
 * Half-extent the workbench (3D box walls, camera max distance, the 2D
 * view's default zoom) needs to comfortably fit every gate, so a large
 * built or imported circuit is not cramped into (or clipped by) a
 * fixed-size room. Never shrinks below the original fixed size, so small
 * circuits keep the same cozy default they always had.
 */
export function computeSceneExtent(gates: Gate[]): number {
  let maxCoord = 0
  for (const gate of gates) {
    maxCoord = Math.max(maxCoord, Math.abs(gate.position[0]), Math.abs(gate.position[2]))
  }
  const padding = Math.max(MIN_SCENE_PADDING, maxCoord * SCENE_PADDING_RATIO)
  return Math.max(MIN_SCENE_HALF_SIZE, maxCoord + padding)
}
