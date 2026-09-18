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

  it('passes a value straight through a BUFFER', () => {
    const circuit = new Circuit()
    const input = circuit.addGate('INPUT')
    const buffer = circuit.addGate('BUFFER')
    connect(circuit, input.id, buffer.id)

    simulate(circuit)
    expect(circuit.getGate(buffer.id)?.outputValues[0]).toBe(false)

    circuit.toggleInput(input.id)
    simulate(circuit)
    expect(circuit.getGate(buffer.id)?.outputValues[0]).toBe(true)
  })

  it('MUX2 selects A when select is low and B when select is high', () => {
    const circuit = new Circuit()
    const a = circuit.addGate('INPUT')
    const b = circuit.addGate('INPUT')
    const sel = circuit.addGate('INPUT')
    const mux = circuit.addGate('MUX2')
    connect(circuit, a.id, mux.id, 0)
    connect(circuit, b.id, mux.id, 1)
    connect(circuit, sel.id, mux.id, 2)
    circuit.toggleInput(a.id) // a = true, b = false, sel = false

    simulate(circuit)
    expect(circuit.getGate(mux.id)?.outputValues[0]).toBe(true)

    circuit.toggleInput(sel.id)
    simulate(circuit)
    expect(circuit.getGate(mux.id)?.outputValues[0]).toBe(false)
  })

  it('DFF only latches D into Q on a rising clock edge, and holds otherwise', () => {
    const circuit = new Circuit()
    const d = circuit.addGate('INPUT')
    const clk = circuit.addGate('INPUT')
    const dff = circuit.addGate('DFF')
    connect(circuit, d.id, dff.id, 0)
    connect(circuit, clk.id, dff.id, 1)

    simulate(circuit)
    expect(circuit.getGate(dff.id)?.outputValues).toEqual([false, true])

    // Raising D alone, with the clock still low, must not latch.
    circuit.toggleInput(d.id)
    simulate(circuit)
    expect(circuit.getGate(dff.id)?.outputValues).toEqual([false, true])

    // Rising clock edge latches the current D.
    circuit.toggleInput(clk.id)
    simulate(circuit)
    expect(circuit.getGate(dff.id)?.outputValues).toEqual([true, false])

    // Changing D while the clock stays high must not re-latch.
    circuit.toggleInput(d.id)
    simulate(circuit)
    expect(circuit.getGate(dff.id)?.outputValues).toEqual([true, false])
  })

  it('a NOT fed back from Q to D toggles the DFF on every rising edge', () => {
    const circuit = new Circuit()
    const clk = circuit.addGate('INPUT')
    const dff = circuit.addGate('DFF')
    const not = circuit.addGate('NOT')
    connect(circuit, dff.id, not.id, 0)
    connect(circuit, not.id, dff.id, 0)
    connect(circuit, clk.id, dff.id, 1)

    simulate(circuit)
    expect(circuit.getGate(dff.id)?.outputValues[0]).toBe(false)

    circuit.toggleInput(clk.id) // rising edge: latches NOT(false) = true
    simulate(circuit)
    expect(circuit.getGate(dff.id)?.outputValues[0]).toBe(true)

    circuit.toggleInput(clk.id) // falling edge: no change
    simulate(circuit)
    expect(circuit.getGate(dff.id)?.outputValues[0]).toBe(true)

    circuit.toggleInput(clk.id) // rising edge: latches NOT(true) = false
    simulate(circuit)
    expect(circuit.getGate(dff.id)?.outputValues[0]).toBe(false)
  })
})
