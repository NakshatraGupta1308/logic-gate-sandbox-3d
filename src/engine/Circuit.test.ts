import { beforeEach, describe, expect, it } from 'vitest'
import { Circuit, resetIdCounter } from './Circuit'

beforeEach(() => resetIdCounter())

describe('Circuit', () => {
  it('adds gates with pin counts derived from the gate kind', () => {
    const circuit = new Circuit()
    const and = circuit.addGate('AND')
    expect(and.inputValues).toHaveLength(2)
    expect(and.outputValues).toHaveLength(1)

    const not = circuit.addGate('NOT')
    expect(not.inputValues).toHaveLength(1)

    const input = circuit.addGate('INPUT')
    expect(input.inputValues).toHaveLength(0)
    expect(input.outputValues).toHaveLength(1)
  })

  it('connects an output pin to an input pin', () => {
    const circuit = new Circuit()
    const input = circuit.addGate('INPUT')
    const output = circuit.addGate('OUTPUT')

    const result = circuit.addWire({ gateId: input.id, pin: 0 }, { gateId: output.id, pin: 0 })

    expect(result.ok).toBe(true)
    expect(circuit.getWires()).toHaveLength(1)
  })

  it('rejects a second driver for the same input pin', () => {
    const circuit = new Circuit()
    const a = circuit.addGate('INPUT')
    const b = circuit.addGate('INPUT')
    const output = circuit.addGate('OUTPUT')

    circuit.addWire({ gateId: a.id, pin: 0 }, { gateId: output.id, pin: 0 })
    const second = circuit.addWire({ gateId: b.id, pin: 0 }, { gateId: output.id, pin: 0 })

    expect(second).toEqual({ ok: false, reason: 'target-occupied' })
  })

  it('rejects wiring an input pin as a source', () => {
    const circuit = new Circuit()
    const output = circuit.addGate('OUTPUT')
    const and = circuit.addGate('AND')

    const result = circuit.addWire({ gateId: output.id, pin: 0 }, { gateId: and.id, pin: 0 })

    expect(result).toEqual({ ok: false, reason: 'source-not-output' })
  })

  it('rejects wires that would create a feedback loop', () => {
    const circuit = new Circuit()
    const not1 = circuit.addGate('NOT')
    const not2 = circuit.addGate('NOT')

    circuit.addWire({ gateId: not1.id, pin: 0 }, { gateId: not2.id, pin: 0 })
    const loop = circuit.addWire({ gateId: not2.id, pin: 0 }, { gateId: not1.id, pin: 0 })

    expect(loop).toEqual({ ok: false, reason: 'would-cycle' })
  })

  it('rejects a gate wiring to itself', () => {
    const circuit = new Circuit()
    const not = circuit.addGate('NOT')

    const result = circuit.addWire({ gateId: not.id, pin: 0 }, { gateId: not.id, pin: 0 })

    expect(result).toEqual({ ok: false, reason: 'same-gate' })
  })

  it('removing a gate also removes wires touching it', () => {
    const circuit = new Circuit()
    const input = circuit.addGate('INPUT')
    const output = circuit.addGate('OUTPUT')
    circuit.addWire({ gateId: input.id, pin: 0 }, { gateId: output.id, pin: 0 })

    circuit.removeGate(input.id)

    expect(circuit.getWires()).toHaveLength(0)
    expect(circuit.getGate(input.id)).toBeUndefined()
  })

  it('toggling an INPUT flips its output value', () => {
    const circuit = new Circuit()
    const input = circuit.addGate('INPUT')
    expect(input.outputValues[0]).toBe(false)

    circuit.toggleInput(input.id)
    expect(circuit.getGate(input.id)?.outputValues[0]).toBe(true)

    circuit.toggleInput(input.id)
    expect(circuit.getGate(input.id)?.outputValues[0]).toBe(false)
  })
})
