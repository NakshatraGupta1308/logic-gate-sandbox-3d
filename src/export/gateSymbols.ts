import type { jsPDF } from 'jspdf'
import type { GateKind } from '../engine'
import { buildGateOutline, type PathCommand, type SymbolBounds } from './gateOutline'

export type { SymbolBounds } from './gateOutline'

function setStyle(doc: jsPDF) {
  doc.setDrawColor(17, 17, 17)
  doc.setFillColor(255, 255, 255)
  doc.setLineWidth(0.5)
}

function playPath(doc: jsPDF, commands: PathCommand[]) {
  for (const cmd of commands) {
    switch (cmd.op) {
      case 'M':
        doc.moveTo(cmd.x, cmd.y)
        break
      case 'L':
        doc.lineTo(cmd.x, cmd.y)
        break
      case 'C':
        doc.curveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y)
        break
      case 'Z':
        doc.close()
        break
    }
  }
}

/**
 * Draws the schematic symbol for a gate kind inside the given bounds and
 * returns the x-coordinate its output stub should start from (past any
 * inversion bubble).
 */
export function drawGateSymbol(doc: jsPDF, kind: GateKind, bounds: SymbolBounds): number {
  const outline = buildGateOutline(kind, bounds)

  setStyle(doc)
  if (outline.body.length > 0) {
    playPath(doc, outline.body)
    doc.fillStroke()
  }
  if (outline.backCurve) {
    setStyle(doc)
    playPath(doc, outline.backCurve)
    doc.stroke()
  }
  if (outline.bubble) {
    setStyle(doc)
    doc.circle(outline.bubble.cx, outline.bubble.cy, outline.bubble.r, 'FD')
  }
  return outline.outputStubX
}
