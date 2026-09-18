import { describe, expect, it } from 'vitest'
import { Circuit, simulate } from '../engine'
import { exportVhdl } from './exportVhdl'
import { importVhdl } from './importVhdl'

function connect(circuit: Circuit, fromId: string, toId: string, toPin: number, fromPin = 0) {
  const result = circuit.addWire({ gateId: fromId, pin: fromPin }, { gateId: toId, pin: toPin })
  if (!result.ok) throw new Error(`wire rejected: ${result.reason}`)
}

/** Runs every input combination through a circuit and returns each result. */
function truthTable(circuit: Circuit): boolean[][] {
  const inputs = circuit.getGates().filter((g) => g.kind === 'INPUT')
  const outputs = circuit.getGates().filter((g) => g.kind === 'OUTPUT')
  const rows: boolean[][] = []
  const rowCount = 1 << inputs.length
  for (let i = 0; i < rowCount; i++) {
    inputs.forEach((gate, k) => {
      const bit = Boolean((i >> (inputs.length - 1 - k)) & 1)
      if (gate.outputValues[0] !== bit) circuit.toggleInput(gate.id)
    })
    simulate(circuit)
    rows.push(outputs.map((o) => o.inputValues[0]))
  }
  return rows
}

function buildFullAdder(): Circuit {
  const circuit = new Circuit()
  const a = circuit.addGate('INPUT')
  const b = circuit.addGate('INPUT')
  const cin = circuit.addGate('INPUT')
  const xor1 = circuit.addGate('XOR')
  const xor2 = circuit.addGate('XOR')
  const and1 = circuit.addGate('AND')
  const and2 = circuit.addGate('AND')
  const or1 = circuit.addGate('OR')
  const sum = circuit.addGate('OUTPUT')
  const cout = circuit.addGate('OUTPUT')
  connect(circuit, a.id, xor1.id, 0)
  connect(circuit, b.id, xor1.id, 1)
  connect(circuit, xor1.id, xor2.id, 0)
  connect(circuit, cin.id, xor2.id, 1)
  connect(circuit, a.id, and1.id, 0)
  connect(circuit, b.id, and1.id, 1)
  connect(circuit, xor1.id, and2.id, 0)
  connect(circuit, cin.id, and2.id, 1)
  connect(circuit, and1.id, or1.id, 0)
  connect(circuit, and2.id, or1.id, 1)
  connect(circuit, xor2.id, sum.id, 0)
  connect(circuit, or1.id, cout.id, 0)
  return circuit
}

describe('importVhdl round-trips exportVhdl', () => {
  it('reproduces a full adder truth table exactly', () => {
    const original = buildFullAdder()
    const originalTable = truthTable(original)

    const vhdl = exportVhdl(original.getGates(), original.getWires())
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const importedTable = truthTable(result.circuit)
    expect(importedTable).toEqual(originalTable)
  })

  it('reproduces a DFF-and-mux circuit exactly, including sequential behavior', () => {
    const circuit = new Circuit()
    const d = circuit.addGate('INPUT')
    const clk = circuit.addGate('INPUT')
    const sel = circuit.addGate('INPUT')
    const dff = circuit.addGate('DFF')
    const mux = circuit.addGate('MUX2')
    const q = circuit.addGate('OUTPUT')
    const muxOut = circuit.addGate('OUTPUT')
    connect(circuit, d.id, dff.id, 0)
    connect(circuit, clk.id, dff.id, 1)
    connect(circuit, d.id, mux.id, 0)
    connect(circuit, dff.id, mux.id, 1)
    connect(circuit, sel.id, mux.id, 2)
    connect(circuit, dff.id, q.id, 0)
    connect(circuit, mux.id, muxOut.id, 0)

    const vhdl = exportVhdl(circuit.getGates(), circuit.getWires())
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const importedGates = result.circuit.getGates()
    const [iD, iClk] = importedGates.filter((g) => g.kind === 'INPUT')
    const [iQ, iMuxOut] = importedGates.filter((g) => g.kind === 'OUTPUT')

    simulate(result.circuit)
    expect(iQ.inputValues[0]).toBe(false)

    result.circuit.toggleInput(iD.id)
    result.circuit.toggleInput(iClk.id) // rising edge: latches D=1
    simulate(result.circuit)
    expect(iQ.inputValues[0]).toBe(true)
    // sel was never toggled (still false), so the mux passes through D (pin
    // 0), which is now true.
    expect(iMuxOut.inputValues[0]).toBe(true)
  })
})

describe('importVhdl on hand-written VHDL', () => {
  it('parses a simple AND-OR circuit written by hand, with different style', () => {
    const vhdl = `
      -- a small hand-written example
      library ieee;
      use ieee.std_logic_1164.all;

      ENTITY my_circuit IS
        port (
          a : in std_logic;
          b : in std_logic;
          c : in std_logic;
          y : out std_logic
        );
      END ENTITY my_circuit;

      architecture behavior of my_circuit is
        signal ab : std_logic;
      begin
        ab <= a and b;
        y <= ab or c;
      end architecture behavior;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const table = truthTable(result.circuit)
    // a, b, c -> y = (a and b) or c, in a,b,c bit order
    expect(table).toEqual([
      [false],
      [true],
      [false],
      [true],
      [false],
      [true],
      [true],
      [true],
    ])
  })

  it('accepts parenthesized nested expressions', () => {
    const vhdl = `
      entity nested is
        port (
          a : in std_logic;
          b : in std_logic;
          c : in std_logic;
          y : out std_logic
        );
      end entity nested;
      architecture rtl of nested is
      begin
        y <= (a and b) or (not c);
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const table = truthTable(result.circuit)
    expect(table).toEqual([
      [true], // a=0 b=0 c=0: (0 and 0) or (not 0) = 0 or 1 = 1
      [false], // c=1: 0 or 0
      [true],
      [false],
      [true],
      [false],
      [true],
      [true], // a=1 b=1 c=1: 1 or 0 = 1
    ])
  })

  it('handles a tied-high constant input', () => {
    const vhdl = `
      entity tied is
        port (
          a : in std_logic;
          y : out std_logic
        );
      end entity tied;
      architecture rtl of tied is
      begin
        y <= a and '1';
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // A tied-high constant becomes its own separate INPUT gate, preset to
    // true and wired in, rather than an option the truth-table sweep
    // below would itself control: "a" is declared first, so it is the
    // gate at index 0; the synthetic tied-high gate comes after it.
    const [a] = result.circuit.getGates().filter((g) => g.kind === 'INPUT')
    const [y] = result.circuit.getGates().filter((g) => g.kind === 'OUTPUT')

    simulate(result.circuit)
    expect(y.inputValues[0]).toBe(false)

    result.circuit.toggleInput(a.id)
    simulate(result.circuit)
    expect(y.inputValues[0]).toBe(true)
  })
})

describe('importVhdl error handling', () => {
  it('rejects a signal driven by two concurrent assignments', () => {
    const vhdl = `
      entity bad is
        port (a : in std_logic; y : out std_logic);
      end entity bad;
      architecture rtl of bad is
        signal s : std_logic;
      begin
        s <= a;
        s <= not a;
        y <= s;
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('more than one')
  })

  it('rejects a reference to an undefined signal', () => {
    const vhdl = `
      entity bad is
        port (a : in std_logic; y : out std_logic);
      end entity bad;
      architecture rtl of bad is
      begin
        y <= mystery_signal;
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('mystery_signal')
  })

  it('rejects a purely combinational reference cycle', () => {
    const vhdl = `
      entity bad is
        port (y : out std_logic);
      end entity bad;
      architecture rtl of bad is
        signal p : std_logic;
        signal q : std_logic;
      begin
        p <= not q;
        q <= not p;
        y <= p;
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.toLowerCase()).toContain('cycle')
  })

  it('rejects an unsupported port mode', () => {
    const vhdl = `
      entity bad is
        port (a : inout std_logic);
      end entity bad;
      architecture rtl of bad is
      begin
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(false)
  })

  it('rejects an output port that is never assigned', () => {
    const vhdl = `
      entity bad is
        port (a : in std_logic; y : out std_logic);
      end entity bad;
      architecture rtl of bad is
      begin
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('never assigned')
  })

  it('rejects malformed VHDL with a line number rather than throwing', () => {
    const vhdl = `entity bad is\n  this is not valid vhdl\nend entity bad;`
    expect(() => importVhdl(vhdl)).not.toThrow()
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/Line \d+/)
  })
})
