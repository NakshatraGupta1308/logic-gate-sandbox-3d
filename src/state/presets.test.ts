import { describe, expect, it } from 'vitest'
import { Circuit, simulate } from '../engine'
import { PRESETS } from './presets'

function setInputs(circuit: Circuit, values: boolean[]) {
  const inputs = circuit.getGates().filter((g) => g.kind === 'INPUT')
  inputs.forEach((gate, i) => {
    if (gate.outputValues[0] !== values[i]) circuit.toggleInput(gate.id)
  })
}

function readOutputs(circuit: Circuit): boolean[] {
  return circuit.getGates()
    .filter((g) => g.kind === 'OUTPUT')
    .map((g) => g.inputValues[0])
}

describe('half-adder preset', () => {
  it('matches the half adder truth table', () => {
    const cases: [boolean, boolean, boolean, boolean][] = [
      [false, false, false, false],
      [false, true, true, false],
      [true, false, true, false],
      [true, true, false, true],
    ]
    for (const [a, b, sum, carry] of cases) {
      const circuit = new Circuit()
      PRESETS['half-adder'].build(circuit)
      setInputs(circuit, [a, b])
      simulate(circuit)
      expect(readOutputs(circuit)).toEqual([sum, carry])
    }
  })
})

describe('full-adder preset', () => {
  it('matches the full adder truth table', () => {
    const cases: [boolean, boolean, boolean, boolean, boolean][] = [
      [false, false, false, false, false],
      [false, false, true, true, false],
      [false, true, false, true, false],
      [false, true, true, false, true],
      [true, false, false, true, false],
      [true, false, true, false, true],
      [true, true, false, false, true],
      [true, true, true, true, true],
    ]
    for (const [a, b, cin, sum, cout] of cases) {
      const circuit = new Circuit()
      PRESETS['full-adder'].build(circuit)
      setInputs(circuit, [a, b, cin])
      simulate(circuit)
      expect(readOutputs(circuit)).toEqual([sum, cout])
    }
  })
})

describe('2-to-1 mux preset', () => {
  it('passes through A when select is low, B when select is high', () => {
    const cases: [boolean, boolean, boolean, boolean][] = [
      [false, false, false, false],
      [true, false, false, true],
      [false, true, false, false],
      [true, true, false, true],
      [false, false, true, false],
      [true, false, true, false],
      [false, true, true, true],
      [true, true, true, true],
    ]
    for (const [a, b, sel, out] of cases) {
      const circuit = new Circuit()
      PRESETS['mux2to1'].build(circuit)
      setInputs(circuit, [a, b, sel])
      simulate(circuit)
      expect(readOutputs(circuit)).toEqual([out])
    }
  })
})
