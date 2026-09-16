import { beforeEach, describe, expect, it } from 'vitest'
import { Circuit, resetIdCounter } from './Circuit'
import { simulate } from './simulate'

beforeEach(() => resetIdCounter())

function connect(circuit: Circuit, fromId: string, toId: string, toPin = 0) {
  const result = circuit.addWire({ gateId: fromId, pin: 0 }, { gateId: toId, pin: toPin })
  if (!result.ok) throw new Error(`wire rejected: ${result.reason}`)
  return result.wire
}

describe('simulate', () => {
  it('propagates a single INPUT through to an OUTPUT', () => {
    const circuit = new Circuit()
    const input = circuit.addGate('INPUT')
    const output = circuit.addGate('OUTPUT')
    connect(circuit, input.id, output.id)

    simulate(circuit)
    expect(circuit.getGate(output.id)?.outputValues[0]).toBe(false)

    circuit.toggleInput(input.id)
    simulate(circuit)
    expect(circuit.getGate(output.id)?.outputValues[0]).toBe(true)
  })

  it('evaluates an AND gate from two inputs', () => {
    const circuit = new Circuit()
    const a = circuit.addGate('INPUT')
    const b = circuit.addGate('INPUT')
    const and = circuit.addGate('AND')
    const output = circuit.addGate('OUTPUT')
    connect(circuit, a.id, and.id, 0)
    connect(circuit, b.id, and.id, 1)
    connect(circuit, and.id, output.id)

    simulate(circuit)
    expect(circuit.getGate(output.id)?.outputValues[0]).toBe(false)

    circuit.toggleInput(a.id)
    simulate(circuit)
    expect(circuit.getGate(output.id)?.outputValues[0]).toBe(false)

    circuit.toggleInput(b.id)
    simulate(circuit)
    expect(circuit.getGate(output.id)?.outputValues[0]).toBe(true)
  })

  it('evaluates a NOT gate', () => {
    const circuit = new Circuit()
    const input = circuit.addGate('INPUT')
    const not = circuit.addGate('NOT')
    connect(circuit, input.id, not.id)

    simulate(circuit)
    expect(circuit.getGate(not.id)?.outputValues[0]).toBe(true)

    circuit.toggleInput(input.id)
    simulate(circuit)
    expect(circuit.getGate(not.id)?.outputValues[0]).toBe(false)
  })

  it('treats an unconnected input pin as false', () => {
    const circuit = new Circuit()
    const and = circuit.addGate('AND')
    const a = circuit.addGate('INPUT')
    connect(circuit, a.id, and.id, 0)
    circuit.toggleInput(a.id)

    simulate(circuit)
    expect(circuit.getGate(and.id)?.outputValues[0]).toBe(false)
  })

  it('builds a half adder from XOR and AND gates', () => {
    const circuit = new Circuit()
    const a = circuit.addGate('INPUT')
    const b = circuit.addGate('INPUT')
    const xor = circuit.addGate('XOR')
    const and = circuit.addGate('AND')
    const sum = circuit.addGate('OUTPUT')
    const carry = circuit.addGate('OUTPUT')

    connect(circuit, a.id, xor.id, 0)
    connect(circuit, b.id, xor.id, 1)
    connect(circuit, a.id, and.id, 0)
    connect(circuit, b.id, and.id, 1)
    connect(circuit, xor.id, sum.id)
    connect(circuit, and.id, carry.id)

    circuit.toggleInput(a.id)
    circuit.toggleInput(b.id)
    simulate(circuit)

    expect(circuit.getGate(sum.id)?.outputValues[0]).toBe(false)
    expect(circuit.getGate(carry.id)?.outputValues[0]).toBe(true)
  })

  it('propagates through chained NOT gates regardless of add order', () => {
    const circuit = new Circuit()
    const input = circuit.addGate('INPUT')
    const not1 = circuit.addGate('NOT')
    const not2 = circuit.addGate('NOT')
    connect(circuit, not1.id, not2.id)
    connect(circuit, input.id, not1.id)
    circuit.toggleInput(input.id)

    simulate(circuit)

    expect(circuit.getGate(not1.id)?.outputValues[0]).toBe(false)
    expect(circuit.getGate(not2.id)?.outputValues[0]).toBe(true)
  })
})
