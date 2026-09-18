import type { GateKind } from '../engine'

// Cubic-bezier control-point ratio for approximating a quarter circle.
const KAPPA = 0.5523

export interface SymbolBounds {
  cx: number
  cy: number
  /** Half the symbol's back-to-tip extent (excludes any output bubble). */
  halfWidth: number
  /** Half the symbol's back-edge height. */
  halfHeight: number
}

export type PathCommand =
  | { op: 'M'; x: number; y: number }
  | { op: 'L'; x: number; y: number }
  | { op: 'C'; x1: number; y1: number; y2: number; x2: number; x: number; y: number }
  | { op: 'Z' }

export interface GateOutline {
  /** Main filled+stroked body (D-shape, shield, triangle, or I/O box). */
  body: PathCommand[]
  /** XOR/XNOR's extra stroke-only curve behind the body. */
  backCurve?: PathCommand[]
  /** Inversion bubble for NAND/NOR/XNOR/NOT, if any. */
  bubble?: { cx: number; cy: number; r: number }
  /** X coordinate where the output stub line should begin, past any bubble. */
  outputStubX: number
  /**
   * X coordinate where an input stub line should end. For a flat back
   * (AND/NAND, the triangle, the I/O box) this is just the back edge. For
   * the concave OR/NOR/XOR/XNOR shield the back curve bulges inward, so a
   * stub drawn only to the outer corner (`cx - halfWidth`) would visibly
   * stop short of the curve for pins nearer the vertical center; this is
   * the curve's deepest point, guaranteeing the stub always reaches it.
   */
  inputStubX: number
}

/** IEEE/ANSI "D" shape shared by AND and NAND: flat back, semicircular front. */
function andBody({ cx, cy, halfWidth: bw, halfHeight: bh }: SymbolBounds): PathCommand[] {
  const capX = cx + bw - bh // semicircle center; radius = bh
  return [
    { op: 'M', x: cx - bw, y: cy - bh },
    { op: 'L', x: capX, y: cy - bh },
    { op: 'C', x1: capX + KAPPA * bh, y1: cy - bh, x2: capX + bh, y2: cy - KAPPA * bh, x: capX + bh, y: cy },
    { op: 'C', x1: capX + bh, y1: cy + KAPPA * bh, x2: capX + KAPPA * bh, y2: cy + bh, x: capX, y: cy + bh },
    { op: 'L', x: cx - bw, y: cy + bh },
    { op: 'Z' },
  ]
}

/**
 * IEEE/ANSI curved shield shared by OR and NOR: a concave back notch and two
 * convex wings meeting at a front tip. Approximated with cubic beziers tuned
 * to read clearly as the standard symbol rather than an exact
 * compass-and-straightedge construction.
 */
function orBody({ cx, cy, halfWidth: bw, halfHeight: bh }: SymbolBounds): PathCommand[] {
  const tipX = cx + bw
  const backX = cx - bw
  const backBulge = bw * 0.6
  return [
    { op: 'M', x: backX, y: cy - bh },
    // Top wing, back-top to the tip: a flat run along the back half, then a
    // steep dive into a sharp point at the tip.
    { op: 'C', x1: cx, y1: cy - bh, x2: tipX - bw * 0.15, y2: cy - bh * 0.55, x: tipX, y: cy },
    // Bottom wing, tip back to back-bottom (mirror of the top wing).
    { op: 'C', x1: tipX - bw * 0.15, y1: cy + bh * 0.55, x2: cx, y2: cy + bh, x: backX, y: cy + bh },
    // Concave back notch, back-bottom to back-top, bulging into the body.
    {
      op: 'C',
      x1: backX + backBulge,
      y1: cy + bh * 0.6,
      x2: backX + backBulge,
      y2: cy - bh * 0.6,
      x: backX,
      y: cy - bh,
    },
    { op: 'Z' },
  ]
}

/** The extra standalone curve behind an OR body that turns it into XOR. */
function xorBackCurve({ cx, cy, halfWidth: bw, halfHeight: bh }: SymbolBounds): PathCommand[] {
  const gap = bw * 0.22
  const backX = cx - bw - gap
  const backBulge = bw * 0.6
  return [
    { op: 'M', x: backX, y: cy - bh },
    { op: 'C', x1: backX + backBulge, y1: cy - bh * 0.5, x2: backX + backBulge, y2: cy + bh * 0.5, x: backX, y: cy + bh },
  ]
}

/** IEEE/ANSI triangle used for the inverter (NOT gate always has the bubble). */
function triangleBody({ cx, cy, halfWidth: bw, halfHeight: bh }: SymbolBounds): PathCommand[] {
  return [
    { op: 'M', x: cx - bw, y: cy - bh },
    { op: 'L', x: cx + bw, y: cy },
    { op: 'L', x: cx - bw, y: cy + bh },
    { op: 'Z' },
  ]
}

/** Trapezoid used for the 2-to-1 multiplexer: flat back, narrower flat front. */
function muxBody({ cx, cy, halfWidth: bw, halfHeight: bh }: SymbolBounds): PathCommand[] {
  const frontX = cx + bw * 0.5
  const frontHalfHeight = bh * 0.55
  return [
    { op: 'M', x: cx - bw, y: cy - bh },
    { op: 'L', x: frontX, y: cy - frontHalfHeight },
    { op: 'L', x: frontX, y: cy + frontHalfHeight },
    { op: 'L', x: cx - bw, y: cy + bh },
    { op: 'Z' },
  ]
}

function ioBox({ cx, cy, halfWidth: bw, halfHeight: bh }: SymbolBounds): PathCommand[] {
  const r = bh * 0.3
  // Rounded rect as an explicit path (rather than a native rounded-rect
  // primitive) so both the jsPDF and SVG renderers can draw every gate kind
  // through the same generic path playback.
  return [
    { op: 'M', x: cx - bw + r, y: cy - bh },
    { op: 'L', x: cx + bw - r, y: cy - bh },
    { op: 'C', x1: cx + bw - r + KAPPA * r, y1: cy - bh, x2: cx + bw, y2: cy - bh + r - KAPPA * r, x: cx + bw, y: cy - bh + r },
    { op: 'L', x: cx + bw, y: cy + bh - r },
    { op: 'C', x1: cx + bw, y1: cy + bh - r + KAPPA * r, x2: cx + bw - r + KAPPA * r, y2: cy + bh, x: cx + bw - r, y: cy + bh },
    { op: 'L', x: cx - bw + r, y: cy + bh },
    { op: 'C', x1: cx - bw + r - KAPPA * r, y1: cy + bh, x2: cx - bw, y2: cy + bh - r + KAPPA * r, x: cx - bw, y: cy + bh - r },
    { op: 'L', x: cx - bw, y: cy - bh + r },
    { op: 'C', x1: cx - bw, y1: cy - bh + r - KAPPA * r, x2: cx - bw + r - KAPPA * r, y2: cy - bh, x: cx - bw + r, y: cy - bh },
    { op: 'Z' },
  ]
}

/**
 * Builds the schematic symbol for a gate kind inside the given bounds, as a
 * renderer-agnostic set of path commands. Shared by the jsPDF export and the
 * live 2D scene so both draw the exact same shapes.
 */
export function buildGateOutline(kind: GateKind, bounds: SymbolBounds): GateOutline {
  const { cx, cy, halfWidth: bw, halfHeight: bh } = bounds
  const bubbleRadius = Math.min(bw, bh) * 0.18
  const tipX = cx + bw
  const flatBackX = cx - bw
  // Mirrors orBody/xorBackCurve's own backBulge/gap constants so the stub
  // depth always matches whichever curve is actually the outermost one.
  const shieldBackX = flatBackX + bw * 0.6
  const xorBackX = flatBackX - bw * 0.22 + bw * 0.6

  switch (kind) {
    case 'AND':
    case 'NAND': {
      const bubble = kind === 'NAND' ? { cx: tipX + bubbleRadius, cy, r: bubbleRadius } : undefined
      return {
        body: andBody(bounds),
        bubble,
        outputStubX: bubble ? tipX + bubbleRadius * 2 : tipX,
        inputStubX: flatBackX,
      }
    }
    case 'OR':
    case 'NOR': {
      const bubble = kind === 'NOR' ? { cx: tipX + bubbleRadius, cy, r: bubbleRadius } : undefined
      return {
        body: orBody(bounds),
        bubble,
        outputStubX: bubble ? tipX + bubbleRadius * 2 : tipX,
        inputStubX: shieldBackX,
      }
    }
    case 'XOR':
    case 'XNOR': {
      const bubble = kind === 'XNOR' ? { cx: tipX + bubbleRadius, cy, r: bubbleRadius } : undefined
      return {
        body: orBody(bounds),
        backCurve: xorBackCurve(bounds),
        bubble,
        outputStubX: bubble ? tipX + bubbleRadius * 2 : tipX,
        inputStubX: xorBackX,
      }
    }
    case 'NOT': {
      return {
        body: triangleBody(bounds),
        bubble: { cx: tipX + bubbleRadius, cy, r: bubbleRadius },
        outputStubX: tipX + bubbleRadius * 2,
        inputStubX: flatBackX,
      }
    }
    case 'BUFFER': {
      // Same triangle as the inverter, just without the bubble: a buffer
      // is a NOT gate that does not invert.
      return { body: triangleBody(bounds), outputStubX: tipX, inputStubX: flatBackX }
    }
    case 'MUX2': {
      const frontX = cx + bw * 0.5
      return { body: muxBody(bounds), outputStubX: frontX, inputStubX: flatBackX }
    }
    case 'DFF':
    case 'INPUT':
    case 'OUTPUT':
      return { body: ioBox(bounds), outputStubX: tipX, inputStubX: flatBackX }
    default:
      return { body: [], outputStubX: tipX, inputStubX: flatBackX }
  }
}
