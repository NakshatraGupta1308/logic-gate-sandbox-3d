import type { Gate, GateKind, Wire } from '../engine'

/**
 * Dataflow-style VHDL, one concurrent signal assignment (or a single
 * clocked process, for a DFF) per gate. This exact shape, kept simple and
 * fixed on purpose, is what importVhdl.ts is written to parse back
 * reliably; see its module comment for the supported grammar.
 */
export function exportVhdl(gates: Gate[], wires: Wire[], entityName = 'circuit'): string {
  const gateById = new Map(gates.map((g) => [g.id, g]))
  const wiresInto = (gateId: string, pin: number) =>
    wires.find((w) => w.to.gateId === gateId && w.to.pin === pin)

  const names = assignNames(gates)

  /** VHDL text for whatever drives a gate's Nth input pin: a name, or '0' if unwired. */
  function operandFor(gate: Gate, pin: number): string {
    const wire = wiresInto(gate.id, pin)
    if (!wire) return "'0'"
    const source = gateById.get(wire.from.gateId)
    if (!source) return "'0'"
    return names.outputName(source, wire.from.pin)
  }

  const ports: string[] = []
  const signals: string[] = []
  const assignments: string[] = []
  const processes: string[] = []

  // Deterministic order: inputs first (top to bottom, then left to right),
  // matching how a person reads the visual layout, then everything else in
  // whatever order the circuit stores it (assignment order does not matter
  // in VHDL's concurrent statements, so this is just for readable output).
  const sortedInputs = gates
    .filter((g) => g.kind === 'INPUT')
    .sort((a, b) => a.position[2] - b.position[2] || a.position[0] - b.position[0])
  const sortedOutputs = gates
    .filter((g) => g.kind === 'OUTPUT')
    .sort((a, b) => a.position[2] - b.position[2] || a.position[0] - b.position[0])

  for (const gate of sortedInputs) {
    ports.push(`        ${names.outputName(gate, 0)} : in std_logic`)
  }
  for (const gate of sortedOutputs) {
    ports.push(`        ${names.portName(gate)} : out std_logic`)
  }

  for (const gate of gates) {
    if (gate.kind === 'INPUT') continue // ports need no signal or assignment

    if (gate.kind === 'OUTPUT') {
      assignments.push(`    ${names.portName(gate)} <= ${operandFor(gate, 0)};`)
      continue
    }

    const qName = names.outputName(gate, 0)
    signals.push(`    signal ${qName} : std_logic;`)

    if (gate.kind === 'DFF') {
      const d = operandFor(gate, 0)
      const clk = operandFor(gate, 1)
      const qnName = names.outputName(gate, 1)
      signals.push(`    signal ${qnName} : std_logic;`)
      processes.push(
        [
          `    process(${clk})`,
          '    begin',
          `        if rising_edge(${clk}) then`,
          `            ${qName} <= ${d};`,
          '        end if;',
          '    end process;',
          `    ${qnName} <= not ${qName};`,
        ].join('\n'),
      )
      continue
    }

    assignments.push(`    ${qName} <= ${expressionFor(gate.kind, operandFor(gate, 0), operandFor(gate, 1), operandFor(gate, 2))};`)
  }

  const lines = [
    'library ieee;',
    'use ieee.std_logic_1164.all;',
    '',
    `entity ${entityName} is`,
    ...(ports.length > 0 ? ['    port (', ports.join(';\n'), '    );'] : []),
    `end entity ${entityName};`,
    '',
    'architecture rtl of ' + entityName + ' is',
    ...signals,
    'begin',
    ...assignments,
    ...processes,
    `end architecture rtl;`,
    '',
  ]
  return lines.join('\n')
}

/** Builds the right-hand side of a concurrent assignment for a gate kind. */
function expressionFor(kind: GateKind, a: string, b: string, c: string): string {
  switch (kind) {
    case 'AND':
      return `${a} and ${b}`
    case 'OR':
      return `${a} or ${b}`
    case 'NAND':
      return `${a} nand ${b}`
    case 'NOR':
      return `${a} nor ${b}`
    case 'XOR':
      return `${a} xor ${b}`
    case 'XNOR':
      return `${a} xnor ${b}`
    case 'NOT':
      return `not ${a}`
    case 'BUFFER':
      return a
    case 'MUX2':
      // Pin 0 is A, pin 1 is B, pin 2 is select: select low chooses A,
      // matching MUX2's own evaluate() in the engine.
      return `${b} when ${c} = '1' else ${a}`
    default:
      return a
  }
}

interface NameTable {
  outputName: (gate: Gate, pin: number) => string
  portName: (gate: Gate) => string
}

const KIND_PREFIX: Record<GateKind, string> = {
  INPUT: 'in',
  OUTPUT: 'out',
  AND: 'and',
  OR: 'or',
  NOT: 'not_g',
  XOR: 'xor',
  NAND: 'nand',
  NOR: 'nor',
  XNOR: 'xnor',
  BUFFER: 'buf',
  MUX2: 'mux',
  DFF: 'dff',
}

/**
 * Assigns every gate a stable, always-valid VHDL identifier: sequential
 * per-kind counters (and1, and2, ...), with a DFF's second output getting
 * an _n suffix for its inverted Q. Deterministic by gate id order, not
 * gate.position, so re-running this on an unchanged circuit always
 * produces the same names regardless of how gates were dragged around.
 */
function assignNames(gates: Gate[]): NameTable {
  const counters = new Map<GateKind, number>()
  const outputNames = new Map<string, string[]>()

  for (const gate of gates) {
    const prefix = KIND_PREFIX[gate.kind]
    const next = (counters.get(gate.kind) ?? 0) + 1
    counters.set(gate.kind, next)
    const base = `${prefix}${next}`
    outputNames.set(gate.id, gate.kind === 'DFF' ? [base, `${base}_n`] : [base])
  }

  return {
    outputName: (gate, pin) => outputNames.get(gate.id)?.[pin] ?? `sig_${gate.id}_${pin}`,
    portName: (gate) => outputNames.get(gate.id)?.[0] ?? `sig_${gate.id}`,
  }
}
