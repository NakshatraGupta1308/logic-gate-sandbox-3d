import { jsPDF } from 'jspdf'
import { getGateDef } from '../engine'
import type { Gate, GateKind, Wire } from '../engine'
import { GATE_HEIGHT, GATE_WIDTH, PIN_STANDOFF, pinPosition } from '../scene/layout'
import { drawGateSymbol, type SymbolBounds } from './gateSymbols'

const MARGIN = 15
const TITLE_SPACE = 14
const LEGEND_SPACE = 20
const MIN_SCALE = 10
const MAX_SCALE = 26
const HALF_WIDTH = GATE_WIDTH / 2
const HALF_HEIGHT = GATE_HEIGHT / 2
const PAD_X = HALF_WIDTH + PIN_STANDOFF

const LEGEND_ORDER: GateKind[] = [
  'AND',
  'OR',
  'NOT',
  'XOR',
  'NAND',
  'NOR',
  'XNOR',
  'BUFFER',
  'MUX2',
  'DFF',
]

function drawTitle(doc: jsPDF, pageWidth: number) {
  doc.setTextColor(17, 17, 17)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text('Logic Gate Sandbox 3D - Circuit Schematic', MARGIN, MARGIN)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(90, 90, 90)
  doc.text(new Date().toLocaleString(), pageWidth - MARGIN, MARGIN, { align: 'right' })
}

function drawElbowWire(doc: jsPDF, x1: number, y1: number, x2: number, y2: number) {
  if (Math.abs(y1 - y2) < 1e-6) {
    doc.line(x1, y1, x2, y2)
    return
  }
  const midX = (x1 + x2) / 2
  doc.line(x1, y1, midX, y1)
  doc.line(midX, y1, midX, y2)
  doc.line(midX, y2, x2, y2)
}

function drawLegend(doc: jsPDF, kinds: GateKind[], pageWidth: number, top: number) {
  if (kinds.length === 0) return
  const cellWidth = Math.min(38, (pageWidth - MARGIN * 2) / kinds.length)
  const bw = 7
  const bh = 4
  const cy = top + 9

  doc.setFontSize(8)
  kinds.forEach((kind, i) => {
    const cx = MARGIN + cellWidth * i + cellWidth / 2
    const bounds: SymbolBounds = { cx: cx - 2, cy, halfWidth: bw, halfHeight: bh }
    drawGateSymbol(doc, kind, bounds)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(17, 17, 17)
    doc.text(getGateDef(kind).label, cx + bw, cy + 1.5, { align: 'left' })
  })
}

interface ExportOptions {
  filename?: string
}

/** How far (in mm) a gate can be positioned outside the current tile's window before its symbol is guaranteed to be fully off-page and safe to skip drawing entirely. */
const CULL_MARGIN = 40

/**
 * Renders the current circuit as a vector PDF schematic using standard
 * IEEE/ANSI gate symbols, laid out directly from each gate's existing
 * (x, z) position in the 3D scene (a lossless top-down projection, since
 * every gate sits at the same height) rather than an auto-layout that
 * would reflow the user's own arrangement.
 *
 * A circuit that fits on one page at a legible scale (between MIN_SCALE
 * and MAX_SCALE) is centered on a single page, as before. A bigger one is
 * never shrunk past MIN_SCALE to force-fit it (that just crams gates and
 * labels into an unreadable overlapping mess) - instead the drawing is
 * tiled across as many pages as it takes at MIN_SCALE, arranged in a grid
 * (row-major, left to right then top to bottom) so it can be reassembled
 * by laying the printed sheets out next to each other.
 */
export function exportSchematicPdf(gates: Gate[], wires: Wire[], options: ExportOptions = {}) {
  const filename = options.filename ?? 'circuit-schematic.pdf'
  const usedKinds = LEGEND_ORDER.filter((kind) => gates.some((g) => g.kind === kind))

  if (gates.length === 0) {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    drawTitle(doc, 297)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(12)
    doc.setTextColor(17, 17, 17)
    doc.text('No gates placed yet. Build a circuit, then export.', MARGIN, 40)
    doc.save(filename)
    return
  }

  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const gate of gates) {
    minX = Math.min(minX, gate.position[0] - PAD_X)
    maxX = Math.max(maxX, gate.position[0] + PAD_X)
    minZ = Math.min(minZ, gate.position[2] - HALF_HEIGHT)
    maxZ = Math.max(maxZ, gate.position[2] + HALF_HEIGHT)
  }
  const worldW = Math.max(maxX - minX, 1)
  const worldH = Math.max(maxZ - minZ, 1)

  const orientation: 'landscape' | 'portrait' = worldW >= worldH ? 'landscape' : 'portrait'
  const pageW = orientation === 'landscape' ? 297 : 210
  const pageH = orientation === 'landscape' ? 210 : 297

  const availW = pageW - MARGIN * 2
  const availH = pageH - MARGIN * 2 - TITLE_SPACE - LEGEND_SPACE

  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(availW / worldW, availH / worldH)))

  const drawW = worldW * scale
  const drawH = worldH * scale
  const cols = Math.max(1, Math.ceil(drawW / availW))
  const rows = Math.max(1, Math.ceil(drawH / availH))
  const singlePage = cols === 1 && rows === 1

  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' })
  const gateById = new Map(gates.map((g) => [g.id, g]))
  const totalPages = rows * cols

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (row > 0 || col > 0) doc.addPage()

      // A single page keeps the drawing centered, exactly as before a
      // bigger circuit could ever need tiling; a tiled page instead anchors
      // each one to the top-left corner of its own slice of the drawing, so
      // together they cover it with no gaps or double-counted overlap.
      const offsetX = singlePage ? MARGIN + Math.max(0, (availW - drawW) / 2) : MARGIN - col * availW
      const offsetY = singlePage
        ? MARGIN + TITLE_SPACE + Math.max(0, (availH - drawH) / 2)
        : MARGIN + TITLE_SPACE - row * availH

      function toPage(x: number, z: number): [number, number] {
        return [offsetX + (x - minX) * scale, offsetY + (z - minZ) * scale]
      }

      drawTitle(doc, pageW)
      if (!singlePage) {
        const pageNumber = row * cols + col + 1
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.setTextColor(90, 90, 90)
        doc.text(
          `Sheet ${pageNumber} of ${totalPages} (row ${row + 1}/${rows}, col ${col + 1}/${cols})`,
          MARGIN,
          MARGIN + 5,
        )
      }

      // Cheap visibility check: a gate whose symbol cannot possibly reach
      // this tile's window is skipped, so a many-page export does not pay
      // for drawing every gate on every one of its pages.
      const isVisible = (px: number, py: number) =>
        px > -CULL_MARGIN && px < pageW + CULL_MARGIN && py > -CULL_MARGIN && py < pageH + CULL_MARGIN

      doc.setDrawColor(60, 60, 60)
      doc.setLineWidth(0.35)
      for (const wire of wires) {
        const fromGate = gateById.get(wire.from.gateId)
        const toGate = gateById.get(wire.to.gateId)
        if (!fromGate || !toGate) continue
        const [fx, , fz] = pinPosition(fromGate, true, wire.from.pin)
        const [tx, , tz] = pinPosition(toGate, false, wire.to.pin)
        const [px1, py1] = toPage(fx, fz)
        const [px2, py2] = toPage(tx, tz)
        if (!isVisible(px1, py1) && !isVisible(px2, py2)) continue
        drawElbowWire(doc, px1, py1, px2, py2)
      }

      for (const gate of gates) {
        const [px, py] = toPage(gate.position[0], gate.position[2])
        if (!isVisible(px, py)) continue
        const bounds: SymbolBounds = {
          cx: px,
          cy: py,
          halfWidth: HALF_WIDTH * scale,
          halfHeight: HALF_HEIGHT * scale,
        }
        doc.setLineWidth(0.4)
        doc.setDrawColor(17, 17, 17)
        const stubs = drawGateSymbol(doc, gate.kind, bounds)

        const def = getGateDef(gate.kind)
        for (let i = 0; i < def.numInputs; i++) {
          const [wx, , wz] = pinPosition(gate, false, i)
          const [pinX, pinY] = toPage(wx, wz)
          doc.line(pinX, pinY, stubs.inputStubX, pinY)
        }
        for (let i = 0; i < def.numOutputs; i++) {
          const [wx, , wz] = pinPosition(gate, true, i)
          const [pinX, pinY] = toPage(wx, wz)
          doc.line(stubs.outputStubX, pinY, pinX, pinY)
        }

        if (gate.kind === 'INPUT' || gate.kind === 'OUTPUT') {
          const value = gate.kind === 'INPUT' ? gate.outputValues[0] : gate.inputValues[0]
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(Math.max(7, scale * 0.35))
          doc.setTextColor(17, 17, 17)
          doc.text(value ? '1' : '0', px, py, { align: 'center', baseline: 'middle' })
        }

        doc.setFont('helvetica', 'normal')
        doc.setFontSize(Math.max(5, scale * 0.16))
        doc.setTextColor(90, 90, 90)
        doc.text(def.label, px, py + bounds.halfHeight + scale * 0.22, { align: 'center' })
      }

      drawLegend(doc, usedKinds, pageW, pageH - MARGIN - LEGEND_SPACE + 4)
    }
  }

  doc.save(filename)
}
