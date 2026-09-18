import { describe, expect, it } from 'vitest'
import type { GateKind } from '../engine'
import { buildGateOutline, type SymbolBounds } from './gateOutline'

const BOUNDS: SymbolBounds = { cx: 10, cy: 5, halfWidth: 0.7, halfHeight: 0.4 }
const ALL_KINDS: GateKind[] = [
  'INPUT',
  'OUTPUT',
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

describe('buildGateOutline', () => {
  it('gives every gate kind a non-empty, closed body path', () => {
    for (const kind of ALL_KINDS) {
      const outline = buildGateOutline(kind, BOUNDS)
      expect(outline.body.length).toBeGreaterThan(0)
      expect(outline.body[0].op).toBe('M')
      expect(outline.body[outline.body.length - 1].op).toBe('Z')
    }
  })

  it('only adds an inversion bubble for NAND, NOR, XNOR, and NOT', () => {
    const withBubble: GateKind[] = ['NAND', 'NOR', 'XNOR', 'NOT']
    for (const kind of ALL_KINDS) {
      const outline = buildGateOutline(kind, BOUNDS)
      expect(Boolean(outline.bubble)).toBe(withBubble.includes(kind))
    }
  })

  it('only adds the extra back curve for XOR and XNOR', () => {
    const withBackCurve: GateKind[] = ['XOR', 'XNOR']
    for (const kind of ALL_KINDS) {
      const outline = buildGateOutline(kind, BOUNDS)
      expect(Boolean(outline.backCurve)).toBe(withBackCurve.includes(kind))
    }
  })

  it('places the output stub past the bubble when one is present', () => {
    const withBubble = buildGateOutline('NAND', BOUNDS)
    const withoutBubble = buildGateOutline('AND', BOUNDS)
    expect(withBubble.outputStubX).toBeGreaterThan(withoutBubble.outputStubX)
  })
})
