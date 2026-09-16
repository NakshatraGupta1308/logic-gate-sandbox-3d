import * as THREE from 'three'
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

export function buildWireCurve(from: THREE.Vector3, to: THREE.Vector3): THREE.QuadraticBezierCurve3 {
  const distance = from.distanceTo(to)
  // Capped so cables droop visibly without dipping through the workbench
  // floor, since pins sit only GATE_HEIGHT/2 above it.
  const lowestPin = Math.min(from.y, to.y)
  const sag = Math.min(0.3, lowestPin * 0.8, 0.06 + distance * 0.05)
  const mid = new THREE.Vector3((from.x + to.x) / 2, lowestPin - sag, (from.z + to.z) / 2)
  return new THREE.QuadraticBezierCurve3(from, mid, to)
}
