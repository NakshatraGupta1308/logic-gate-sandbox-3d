import type { GateDef, GateKind } from './types'

const all = (inputs: boolean[]) => inputs.every(Boolean)
const any = (inputs: boolean[]) => inputs.some(Boolean)

export const GATE_DEFS: Record<GateKind, GateDef> = {
  INPUT: {
    kind: 'INPUT',
    label: 'INPUT',
    numInputs: 0,
    numOutputs: 1,
    // An INPUT has no upstream logic; its value is set directly by toggling,
    // so evaluate just passes the stored output value through unchanged.
    evaluate: () => [false],
  },
  OUTPUT: {
    kind: 'OUTPUT',
    label: 'OUTPUT',
    numInputs: 1,
    numOutputs: 0,
    evaluate: (inputs) => [inputs[0] ?? false],
  },
  AND: {
    kind: 'AND',
    label: 'AND',
    numInputs: 2,
    numOutputs: 1,
    evaluate: (inputs) => [all(inputs)],
  },
  OR: {
    kind: 'OR',
    label: 'OR',
    numInputs: 2,
    numOutputs: 1,
    evaluate: (inputs) => [any(inputs)],
  },
  NOT: {
    kind: 'NOT',
    label: 'NOT',
    numInputs: 1,
    numOutputs: 1,
    evaluate: (inputs) => [!(inputs[0] ?? false)],
  },
  XOR: {
    kind: 'XOR',
    label: 'XOR',
    numInputs: 2,
    numOutputs: 1,
    evaluate: (inputs) => [Boolean(inputs[0]) !== Boolean(inputs[1])],
  },
  NAND: {
    kind: 'NAND',
    label: 'NAND',
    numInputs: 2,
    numOutputs: 1,
    evaluate: (inputs) => [!all(inputs)],
  },
  NOR: {
    kind: 'NOR',
    label: 'NOR',
    numInputs: 2,
    numOutputs: 1,
    evaluate: (inputs) => [!any(inputs)],
  },
  XNOR: {
    kind: 'XNOR',
    label: 'XNOR',
    numInputs: 2,
    numOutputs: 1,
    evaluate: (inputs) => [Boolean(inputs[0]) === Boolean(inputs[1])],
  },
  BUFFER: {
    kind: 'BUFFER',
    label: 'BUFFER',
    numInputs: 1,
    numOutputs: 1,
    evaluate: (inputs) => [inputs[0] ?? false],
  },
  MUX2: {
    kind: 'MUX2',
    label: 'MUX',
    // Pin 0: input A, pin 1: input B, pin 2: select. Select low (false)
    // passes A through, select high (true) passes B, matching the
    // conventional "sel='0' -> a, sel='1' -> b" reading used by the VHDL
    // export's `when/else` codegen.
    numInputs: 3,
    numOutputs: 1,
    evaluate: (inputs) => [inputs[2] ? (inputs[1] ?? false) : (inputs[0] ?? false)],
  },
  DFF: {
    kind: 'DFF',
    label: 'D-FF',
    // Pin 0: D, pin 1: CLK. Outputs: pin 0 Q, pin 1 the inverted Q.
    numInputs: 2,
    numOutputs: 2,
    sequential: true,
    // Never actually drives the outputs (updateState does, gated by a
    // clock edge); this is only a reasonable fallback for any code that
    // might call evaluate() on every gate uniformly.
    evaluate: (inputs) => [inputs[0] ?? false, !(inputs[0] ?? false)],
    updateState: (gate) => {
      const d = gate.inputValues[0] ?? false
      const clk = gate.inputValues[1] ?? false
      const risingEdge = clk && !(gate.prevClock ?? false)
      if (risingEdge) gate.outputValues = [d, !d]
      gate.prevClock = clk
    },
  },
}

export function getGateDef(kind: GateKind): GateDef {
  return GATE_DEFS[kind]
}
