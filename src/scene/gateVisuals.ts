import { GATE_DEFS, type GateKind } from '../engine'

export const GATE_SYMBOL: Record<GateKind, string> = {
  INPUT: '⏻',
  OUTPUT: '◎',
  AND: '∧',
  OR: '∨',
  NOT: '¬',
  XOR: '⊕',
  NAND: '⊼',
  NOR: '⊽',
  XNOR: '⊙',
}

export const GATE_DESCRIPTION: Record<GateKind, string> = {
  INPUT: 'A toggle you control directly. Click it to flip between 0 and 1.',
  OUTPUT: 'Displays whatever value reaches its single input pin.',
  AND: 'Outputs true only when both inputs are true.',
  OR: 'Outputs true when at least one input is true.',
  NOT: 'Flips the input: true becomes false, false becomes true.',
  XOR: 'Outputs true when exactly one input is true.',
  NAND: 'Outputs false only when both inputs are true (inverted AND).',
  NOR: 'Outputs true only when both inputs are false (inverted OR).',
  XNOR: 'Outputs true when both inputs match.',
}

/** Bright, saturated per-kind body color for the comic-book palette. */
export const GATE_BODY_COLOR: Record<GateKind, string> = {
  AND: '#3b82f6',
  OR: '#22c55e',
  NOT: '#f97316',
  XOR: '#a855f7',
  NAND: '#14b8a6',
  NOR: '#ec4899',
  XNOR: '#eab308',
  INPUT: '#f59e0b',
  OUTPUT: '#e5e7eb',
}

export interface TruthRow {
  inputs: boolean[]
  output: boolean
}

/** Enumerates every input combination for a gate, in FF/FT/TF/TT order. */
export function getTruthTable(kind: GateKind): TruthRow[] | null {
  const def = GATE_DEFS[kind]
  if (def.numInputs === 0 || def.numOutputs === 0) return null

  const rowCount = 1 << def.numInputs
  const rows: TruthRow[] = []
  for (let i = 0; i < rowCount; i++) {
    const inputs = Array.from({ length: def.numInputs }, (_, k) => {
      const bit = def.numInputs - 1 - k
      return Boolean((i >> bit) & 1)
    })
    rows.push({ inputs, output: def.evaluate(inputs)[0] })
  }
  return rows
}
