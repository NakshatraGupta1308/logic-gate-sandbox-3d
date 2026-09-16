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
}

export function getGateDef(kind: GateKind): GateDef {
  return GATE_DEFS[kind]
}
