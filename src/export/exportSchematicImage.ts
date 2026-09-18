import { getGateDef } from '../engine'
import type { Gate, GateKind, Wire } from '../engine'
import { GATE_HEIGHT, GATE_WIDTH, PIN_RADIUS, PIN_STANDOFF, pinPosition } from '../scene/layout'
import { buildGateOutline, type SymbolBounds } from './gateOutline'
import { pathCommandsToSvg } from './svgPath'

const HALF_WIDTH = GATE_WIDTH / 2
const HALF_HEIGHT = GATE_HEIGHT / 2
const PAD_X = HALF_WIDTH + PIN_STANDOFF
const MARGIN_UNITS = 2.4
const TITLE_SPACE_UNITS = 1.1
const LEGEND_SPACE_UNITS = 1.6

const LEGEND_ORDER: GateKind[] = ['AND', 'OR', 'NOT', 'XOR', 'NAND', 'NOR', 'XNOR', 'BUFFER', 'MUX2', 'DFF']

/** Comfortable on-screen legibility, in pixels per world unit, for a circuit small enough that the result stays under MAX_DIMENSION_PX. */
const DESIRED_PX_PER_UNIT = 40
/** A hard ceiling on either raster dimension, safely inside every mainstream browser's canvas size limit; a bigger circuit is scaled down just enough to fit it, rather than losing legibility (like the PDF export used to) or being split across multiple images. */
const MAX_DIMENSION_PX = 8000

function elbowPath(x1: number, y1: number, x2: number, y2: number): string {
  if (Math.abs(y1 - y2) < 1e-6) return `M ${x1} ${y1} L ${x2} ${y2}`
  const midX = (x1 + x2) / 2
  return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export interface SchematicSvg {
  svg: string
  pxWidth: number
  pxHeight: number
}

/**
 * Builds a complete, self-contained SVG document for the whole circuit at
 * once, sized to its full extent with no page-size limit to tile across
 * (unlike the PDF export, which must fit a fixed sheet and so may need
 * several for a big circuit). Gate symbols are the exact same
 * renderer-agnostic outlines the live 2D scene and the PDF export both
 * draw (see gateOutline.ts). Pure string-building with no DOM/browser
 * dependency, so it is directly testable; exportSchematicImage below does
 * the browser-only work of rasterizing this into a PNG.
 */
export function buildSchematicSvg(gates: Gate[], wires: Wire[]): SchematicSvg {
  const usedKinds = LEGEND_ORDER.filter((kind) => gates.some((g) => g.kind === kind))

  if (gates.length === 0) {
    const w = 40
    const h = 12
    const pxWidth = w * DESIRED_PX_PER_UNIT
    const pxHeight = h * DESIRED_PX_PER_UNIT
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${pxWidth}" height="${pxHeight}">` +
      `<rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff" />` +
      `<text x="1" y="2.2" font-family="Helvetica, Arial, sans-serif" font-size="1" font-weight="700" fill="#111111">Logic Gate Sandbox 3D - Circuit Schematic</text>` +
      `<text x="1" y="5" font-family="Helvetica, Arial, sans-serif" font-size="0.6" fill="#111111">No gates placed yet. Build a circuit, then export.</text>` +
      `</svg>`
    return { svg, pxWidth, pxHeight }
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

  const viewMinX = minX - MARGIN_UNITS
  const viewMinY = minZ - MARGIN_UNITS - TITLE_SPACE_UNITS
  const viewW = worldW + MARGIN_UNITS * 2
  const viewH = worldH + MARGIN_UNITS * 2 + TITLE_SPACE_UNITS + LEGEND_SPACE_UNITS

  const naturalW = viewW * DESIRED_PX_PER_UNIT
  const naturalH = viewH * DESIRED_PX_PER_UNIT
  const shrink = Math.min(1, MAX_DIMENSION_PX / naturalW, MAX_DIMENSION_PX / naturalH)
  const pxWidth = Math.round(naturalW * shrink)
  const pxHeight = Math.round(naturalH * shrink)

  const gateById = new Map(gates.map((g) => [g.id, g]))
  const parts: string[] = []

  parts.push(`<rect x="${viewMinX}" y="${viewMinY}" width="${viewW}" height="${viewH}" fill="#ffffff" />`)
  parts.push(
    `<text x="${viewMinX + 0.6}" y="${viewMinY + 0.9}" font-family="Helvetica, Arial, sans-serif" font-size="0.8" font-weight="700" fill="#111111">Logic Gate Sandbox 3D - Circuit Schematic</text>`,
  )
  parts.push(
    `<text x="${viewMinX + viewW - 0.6}" y="${viewMinY + 0.9}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="0.45" fill="#5a5a5a">${escapeXml(new Date().toLocaleString())}</text>`,
  )

  for (const wire of wires) {
    const fromGate = gateById.get(wire.from.gateId)
    const toGate = gateById.get(wire.to.gateId)
    if (!fromGate || !toGate) continue
    const [x1, , z1] = pinPosition(fromGate, true, wire.from.pin)
    const [x2, , z2] = pinPosition(toGate, false, wire.to.pin)
    const active = fromGate.outputValues[wire.from.pin] ?? false
    const d = elbowPath(x1, z1, x2, z2)
    parts.push(
      `<path d="${d}" fill="none" stroke="${active ? '#16a34a' : '#6b7280'}" stroke-width="${active ? 0.05 : 0.036}" stroke-linejoin="round" />`,
    )
  }

  for (const gate of gates) {
    const [cx, , cz] = gate.position
    const bounds: SymbolBounds = { cx, cy: cz, halfWidth: HALF_WIDTH, halfHeight: HALF_HEIGHT }
    const outline = buildGateOutline(gate.kind, bounds)
    const def = getGateDef(gate.kind)

    if (outline.backCurve) {
      parts.push(`<path d="${pathCommandsToSvg(outline.backCurve)}" fill="none" stroke="#111111" stroke-width="0.028" />`)
    }
    if (outline.body.length > 0) {
      parts.push(
        `<path d="${pathCommandsToSvg(outline.body)}" fill="#ffffff" stroke="#111111" stroke-width="0.032" stroke-linejoin="round" />`,
      )
    }
    if (outline.bubble) {
      parts.push(
        `<circle cx="${outline.bubble.cx}" cy="${outline.bubble.cy}" r="${outline.bubble.r}" fill="#ffffff" stroke="#111111" stroke-width="0.024" />`,
      )
    }

    for (let i = 0; i < def.numInputs; i++) {
      const [px, , pz] = pinPosition(gate, false, i)
      const value = gate.inputValues[i] ?? false
      parts.push(`<line x1="${px}" y1="${pz}" x2="${outline.inputStubX}" y2="${pz}" stroke="#111111" stroke-width="0.022" />`)
      parts.push(`<circle cx="${px}" cy="${pz}" r="${PIN_RADIUS}" fill="${value ? '#22c55e' : '#6b7280'}" stroke="#111111" stroke-width="0.018" />`)
    }
    for (let i = 0; i < def.numOutputs; i++) {
      const [px, , pz] = pinPosition(gate, true, i)
      const value = gate.outputValues[i] ?? false
      parts.push(`<line x1="${outline.outputStubX}" y1="${pz}" x2="${px}" y2="${pz}" stroke="#111111" stroke-width="0.022" />`)
      parts.push(`<circle cx="${px}" cy="${pz}" r="${PIN_RADIUS}" fill="${value ? '#22c55e' : '#6b7280'}" stroke="#111111" stroke-width="0.018" />`)
    }

    if (gate.kind === 'INPUT' || gate.kind === 'OUTPUT') {
      const value = gate.kind === 'INPUT' ? gate.outputValues[0] : gate.inputValues[0]
      parts.push(
        `<text x="${cx}" y="${cz}" text-anchor="middle" dominant-baseline="central" font-family="Helvetica, Arial, sans-serif" font-size="0.32" font-weight="800" fill="#111111">${value ? '1' : '0'}</text>`,
      )
    }

    parts.push(
      `<text x="${cx}" y="${cz + HALF_HEIGHT + 0.28}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="0.2" font-weight="700" fill="#4b5563">${escapeXml(def.label)}</text>`,
    )
  }

  if (usedKinds.length > 0) {
    const legendY = maxZ + MARGIN_UNITS + LEGEND_SPACE_UNITS * 0.55
    const cellWidth = Math.min(6, viewW / usedKinds.length)
    usedKinds.forEach((kind, i) => {
      const symbolCx = viewMinX + 0.6 + cellWidth * i + cellWidth * 0.22
      const bounds: SymbolBounds = { cx: symbolCx, cy: legendY, halfWidth: 1.1, halfHeight: 0.6 }
      const outline = buildGateOutline(kind, bounds)
      if (outline.backCurve) {
        parts.push(`<path d="${pathCommandsToSvg(outline.backCurve)}" fill="none" stroke="#111111" stroke-width="0.028" />`)
      }
      parts.push(`<path d="${pathCommandsToSvg(outline.body)}" fill="#ffffff" stroke="#111111" stroke-width="0.032" />`)
      if (outline.bubble) {
        parts.push(
          `<circle cx="${outline.bubble.cx}" cy="${outline.bubble.cy}" r="${outline.bubble.r}" fill="#ffffff" stroke="#111111" stroke-width="0.024" />`,
        )
      }
      parts.push(
        `<text x="${symbolCx + 1.5}" y="${legendY + 0.15}" font-family="Helvetica, Arial, sans-serif" font-size="0.4" fill="#111111">${escapeXml(getGateDef(kind).label)}</text>`,
      )
    })
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewMinX} ${viewMinY} ${viewW} ${viewH}" width="${pxWidth}" height="${pxHeight}">${parts.join('')}</svg>`
  return { svg, pxWidth, pxHeight }
}

interface ExportOptions {
  filename?: string
}

/**
 * Renders the current circuit as a single PNG image covering the whole
 * circuit at once, at whatever resolution its size calls for (see
 * buildSchematicSvg) - a browser-only Image/canvas rasterization step on
 * top of that pure SVG string, so a viewer can open, zoom, and pan one
 * image instead of reassembling several PDF pages.
 */
export function exportSchematicImage(gates: Gate[], wires: Wire[], options: ExportOptions = {}): Promise<void> {
  const filename = options.filename ?? 'circuit-schematic.png'
  const { svg, pxWidth, pxHeight } = buildSchematicSvg(gates, wires)

  return new Promise((resolve, reject) => {
    const svgBlob = new Blob([svg], { type: 'image/svg+xml' })
    const svgUrl = URL.createObjectURL(svgBlob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(svgUrl)
      const canvas = document.createElement('canvas')
      canvas.width = pxWidth
      canvas.height = pxHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Could not get a 2D canvas context'))
        return
      }
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, pxWidth, pxHeight)
      ctx.drawImage(img, 0, 0, pxWidth, pxHeight)
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Could not encode the schematic as a PNG'))
          return
        }
        const pngUrl = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = pngUrl
        link.download = filename
        link.click()
        URL.revokeObjectURL(pngUrl)
        resolve()
      }, 'image/png')
    }
    img.onerror = () => {
      URL.revokeObjectURL(svgUrl)
      reject(new Error('Could not rasterize the schematic SVG'))
    }
    img.src = svgUrl
  })
}
