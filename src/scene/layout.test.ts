import { describe, expect, it } from 'vitest'
import { Circuit } from '../engine'
import { computeSceneExtent } from './layout'

describe('computeSceneExtent', () => {
  it('never goes below the default size for an empty or small circuit', () => {
    expect(computeSceneExtent([])).toBe(10)

    const circuit = new Circuit()
    circuit.addGate('AND', [1, 0.4, -1])
    expect(computeSceneExtent(circuit.getGates())).toBe(10)
  })

  it('grows to fit a gate placed far from the origin, with padding', () => {
    const circuit = new Circuit()
    circuit.addGate('AND', [20, 0.4, 0])
    expect(computeSceneExtent(circuit.getGates())).toBe(23)
  })

  it('considers both axes independently', () => {
    const circuit = new Circuit()
    circuit.addGate('AND', [0, 0.4, -30])
    expect(computeSceneExtent(circuit.getGates())).toBe(33)
  })
})
