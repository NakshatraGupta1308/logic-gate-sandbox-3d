import type { jsPDF } from 'jspdf'
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

function setStyle(doc: jsPDF) {
  doc.setDrawColor(17, 17, 17)
  doc.setFillColor(255, 255, 255)
  doc.setLineWidth(0.5)
}

/** IEEE/ANSI "D" shape shared by AND and NAND: flat back, semicircular front. */
function drawAndBody(doc: jsPDF, { cx, cy, halfWidth: bw, halfHeight: bh }: SymbolBounds) {
  const capX = cx + bw - bh // semicircle center; radius = bh
  setStyle(doc)
  doc.moveTo(cx - bw, cy - bh)
  doc.lineTo(capX, cy - bh)
  doc.curveTo(capX + KAPPA * bh, cy - bh, capX + bh, cy - KAPPA * bh, capX + bh, cy)
  doc.curveTo(capX + bh, cy + KAPPA * bh, capX + KAPPA * bh, cy + bh, capX, cy + bh)
  doc.lineTo(cx - bw, cy + bh)
  doc.close()
  doc.fillStroke()
}

/**
 * IEEE/ANSI curved shield shared by OR and NOR: a concave back notch and two
 * convex wings meeting at a front tip. Approximated with cubic beziers
 * tuned to read clearly as the standard symbol rather than an exact
 * compass-and-straightedge construction.
 */
function drawOrBody(doc: jsPDF, { cx, cy, halfWidth: bw, halfHeight: bh }: SymbolBounds) {
  const tipX = cx + bw
  const backX = cx - bw
  const backBulge = bw * 0.6

  setStyle(doc)
  doc.moveTo(backX, cy - bh)
  // Top wing, back-top to the tip: a flat run along the back half, then a
  // steep dive into a sharp point at the tip.
  doc.curveTo(cx, cy - bh, tipX - bw * 0.15, cy - bh * 0.55, tipX, cy)
  // Bottom wing, tip back to back-bottom (mirror of the top wing).
  doc.curveTo(tipX - bw * 0.15, cy + bh * 0.55, cx, cy + bh, backX, cy + bh)
  // Concave back notch, back-bottom to back-top, bulging into the body.
  doc.curveTo(backX + backBulge, cy + bh * 0.6, backX + backBulge, cy - bh * 0.6, backX, cy - bh)
  doc.close()
  doc.fillStroke()
}

/** The extra standalone curve behind an OR body that turns it into XOR. */
function drawXorBackCurve(doc: jsPDF, { cx, cy, halfWidth: bw, halfHeight: bh }: SymbolBounds) {
  const gap = bw * 0.22
  const backX = cx - bw - gap
  const backBulge = bw * 0.6

  setStyle(doc)
  doc.moveTo(backX, cy - bh)
  doc.curveTo(backX + backBulge, cy - bh * 0.5, backX + backBulge, cy + bh * 0.5, backX, cy + bh)
  doc.stroke()
}

/** IEEE/ANSI triangle used for the inverter (NOT gate always has the bubble). */
function drawTriangleBody(doc: jsPDF, { cx, cy, halfWidth: bw, halfHeight: bh }: SymbolBounds) {
  setStyle(doc)
  doc.moveTo(cx - bw, cy - bh)
  doc.lineTo(cx + bw, cy)
  doc.lineTo(cx - bw, cy + bh)
  doc.close()
  doc.fillStroke()
}

function drawBubble(doc: jsPDF, x: number, y: number, radius: number) {
  setStyle(doc)
  doc.circle(x, y, radius, 'FD')
}

/**
 * Draws the schematic symbol for a gate kind inside the given bounds and
 * returns the x-coordinate its output stub should start from (past any
 * inversion bubble).
 */
export function drawGateSymbol(doc: jsPDF, kind: GateKind, bounds: SymbolBounds): number {
  const { cx, cy, halfWidth: bw, halfHeight: bh } = bounds
  const bubbleRadius = Math.min(bw, bh) * 0.18

  switch (kind) {
    case 'AND':
    case 'NAND': {
      drawAndBody(doc, bounds)
      const tipX = cx + bw
      if (kind === 'NAND') {
        drawBubble(doc, tipX + bubbleRadius, cy, bubbleRadius)
        return tipX + bubbleRadius * 2
      }
      return tipX
    }
    case 'OR':
    case 'NOR': {
      drawOrBody(doc, bounds)
      const tipX = cx + bw
      if (kind === 'NOR') {
        drawBubble(doc, tipX + bubbleRadius, cy, bubbleRadius)
        return tipX + bubbleRadius * 2
      }
      return tipX
    }
    case 'XOR':
    case 'XNOR': {
      drawXorBackCurve(doc, bounds)
      drawOrBody(doc, bounds)
      const tipX = cx + bw
      if (kind === 'XNOR') {
        drawBubble(doc, tipX + bubbleRadius, cy, bubbleRadius)
        return tipX + bubbleRadius * 2
      }
      return tipX
    }
    case 'NOT': {
      drawTriangleBody(doc, bounds)
      const tipX = cx + bw
      drawBubble(doc, tipX + bubbleRadius, cy, bubbleRadius)
      return tipX + bubbleRadius * 2
    }
    case 'INPUT':
    case 'OUTPUT': {
      // Not IEEE gate symbols: these are I/O terminals, conventionally
      // drawn as a plain labeled box rather than a logic shape.
      setStyle(doc)
      doc.roundedRect(cx - bw, cy - bh, bw * 2, bh * 2, bh * 0.3, bh * 0.3, 'FD')
      return cx + bw
    }
    default:
      return cx + bw
  }
}
