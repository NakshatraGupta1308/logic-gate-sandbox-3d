import * as THREE from 'three'
import type { GateKind } from '../engine'
import { buildGateOutline, type PathCommand } from '../export/gateOutline'
import { GATE_DEPTH, GATE_HEIGHT, GATE_WIDTH } from './layout'

// The outline is built in its own local x/y plane, centered on the origin:
// x is the front-back (input/output) axis, y is the pin-spread axis. Those
// become the body's X and Z once extruded, matching pinPosition exactly, so
// halfHeight uses GATE_DEPTH (the pin-spread axis) rather than GATE_HEIGHT
// (the vertical axis extrusion supplies).
const BOUNDS = { cx: 0, cy: 0, halfWidth: GATE_WIDTH / 2, halfHeight: GATE_DEPTH / 2 }

function pathToShape(commands: PathCommand[]): THREE.Shape {
  const shape = new THREE.Shape()
  for (const cmd of commands) {
    if (cmd.op === 'M') shape.moveTo(cmd.x, cmd.y)
    else if (cmd.op === 'L') shape.lineTo(cmd.x, cmd.y)
    else if (cmd.op === 'C') shape.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y)
    else shape.closePath()
  }
  return shape
}

export interface GateShape3D {
  /** Solid body extruded from the 2D schematic outline. */
  geometry: THREE.ExtrudeGeometry
  /** Local position + radius for the inversion bubble, if this kind has one. */
  bubble: { position: [number, number, number]; radius: number } | null
  /** XOR/XNOR's extra back curve, as a thin tube. */
  backCurveGeometry: THREE.TubeGeometry | null
}

const cache = new Map<GateKind, GateShape3D>()

/**
 * Builds (and caches per kind, since every gate of a kind is identical) a
 * solid extruded from the same renderer-agnostic outline the 2D view and
 * PDF/PNG export use, so the 3D view reads as the real IEEE/ANSI symbol
 * instead of a generic box. The outline's x/y plane becomes the body's
 * horizontal footprint (X/Z); extrusion supplies the vertical Y axis.
 */
export function getGateShape3D(kind: GateKind): GateShape3D {
  const cached = cache.get(kind)
  if (cached) return cached

  const outline = buildGateOutline(kind, BOUNDS)

  const shape = pathToShape(outline.body)
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: GATE_HEIGHT, bevelEnabled: false, curveSegments: 16 })
  // ExtrudeGeometry extrudes the shape's x/y plane along +Z; rotating it
  // onto the horizontal plane turns that extrusion into the vertical (Y)
  // axis instead, then re-center it vertically like the old RoundedBox.
  geometry.rotateX(Math.PI / 2)
  geometry.translate(0, GATE_HEIGHT / 2, 0)

  const bubble = outline.bubble
    ? { position: [outline.bubble.cx, 0, outline.bubble.cy] as [number, number, number], radius: outline.bubble.r }
    : null

  let backCurveGeometry: THREE.TubeGeometry | null = null
  if (outline.backCurve) {
    const backShape = pathToShape(outline.backCurve)
    const points = backShape.getPoints(12).map((p) => new THREE.Vector3(p.x, 0, p.y))
    backCurveGeometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 12, 0.02, 6, false)
  }

  const built: GateShape3D = { geometry, bubble, backCurveGeometry }
  cache.set(kind, built)
  return built
}
