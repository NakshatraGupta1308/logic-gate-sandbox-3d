import { describe, expect, it } from 'vitest'
import { GATE_DEFS, type GateKind } from '../engine'
import { getGateShape3D } from './gateShape3d'

const KINDS = Object.keys(GATE_DEFS) as GateKind[]

describe('getGateShape3D', () => {
  it('builds a non-empty extruded geometry for every gate kind', () => {
    for (const kind of KINDS) {
      const shape = getGateShape3D(kind)
      expect(shape.geometry.attributes.position.count).toBeGreaterThan(0)
    }
  })

  it('caches by kind so every gate of the same kind shares one geometry', () => {
    const first = getGateShape3D('AND')
    const second = getGateShape3D('AND')
    expect(first).toBe(second)
    expect(first.geometry).toBe(second.geometry)
  })

  it('only gives an inversion bubble to the inverted kinds', () => {
    for (const kind of ['NAND', 'NOR', 'XNOR', 'NOT'] as GateKind[]) {
      expect(getGateShape3D(kind).bubble).not.toBeNull()
    }
    for (const kind of ['AND', 'OR', 'XOR', 'BUFFER', 'MUX2', 'DFF', 'INPUT', 'OUTPUT'] as GateKind[]) {
      expect(getGateShape3D(kind).bubble).toBeNull()
    }
  })

  it('only gives a back curve to XOR/XNOR', () => {
    expect(getGateShape3D('XOR').backCurveGeometry).not.toBeNull()
    expect(getGateShape3D('XNOR').backCurveGeometry).not.toBeNull()
    expect(getGateShape3D('AND').backCurveGeometry).toBeNull()
  })
})
