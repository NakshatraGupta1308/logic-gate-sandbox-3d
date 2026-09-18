import { describe, expect, it } from 'vitest'
import { Circuit, getGateDef } from '../engine'
import { PRESETS } from '../state/presets'
import { buildSchematicSvg } from './exportSchematicImage'

describe('buildSchematicSvg', () => {
  it('produces a placeholder SVG for an empty circuit', () => {
    const { svg, pxWidth, pxHeight } = buildSchematicSvg([], [])
    expect(svg).toContain('No gates placed yet')
    expect(pxWidth).toBeGreaterThan(0)
    expect(pxHeight).toBeGreaterThan(0)
  })

  it('produces one <svg> covering the whole circuit, not split across several', () => {
    const circuit = new Circuit()
    PRESETS['full-adder'].build(circuit)
    const { svg } = buildSchematicSvg(circuit.getGates(), circuit.getWires())
    expect(svg.match(/<svg /g)).toHaveLength(1)
    // Every gate kind used should have its label drawn somewhere in the
    // single document (a stand-in for "every gate got rendered").
    const kinds = new Set(circuit.getGates().map((g) => g.kind))
    for (const kind of kinds) {
      expect(svg).toContain(`>${getGateDef(kind).label}<`)
    }
  })

  it('scales resolution up to a comfortable size for a small circuit, without exceeding the safety ceiling for a huge one', () => {
    const small = new Circuit()
    small.addGate('AND', [0, 0, 0])
    const { pxWidth: smallW, pxHeight: smallH } = buildSchematicSvg(small.getGates(), small.getWires())
    expect(smallW).toBeLessThan(2000)
    expect(smallH).toBeLessThan(2000)

    const huge = new Circuit()
    for (let i = 0; i < 40; i++) {
      huge.addGate('AND', [i * 40, 0, (i % 5) * 40])
    }
    const { pxWidth: hugeW, pxHeight: hugeH } = buildSchematicSvg(huge.getGates(), huge.getWires())
    expect(hugeW).toBeLessThanOrEqual(8000)
    expect(hugeH).toBeLessThanOrEqual(8000)
  })

  it('does not throw for the half adder, full adder, and mux presets', () => {
    for (const name of ['half-adder', 'full-adder', 'mux2to1'] as const) {
      const circuit = new Circuit()
      PRESETS[name].build(circuit)
      expect(() => buildSchematicSvg(circuit.getGates(), circuit.getWires())).not.toThrow()
    }
  })
})
