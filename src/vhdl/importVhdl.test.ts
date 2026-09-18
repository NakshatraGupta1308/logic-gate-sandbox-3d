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

/**
 * Like truthTable, but only sweeps the first `declaredCount` INPUT gates
 * (in port-declaration order), leaving any further ones untouched. A
 * VHDL literal '1' tied to a signal becomes an extra synthetic INPUT gate
 * preset to true (see buildCircuitFromVhdl.ts); sweeping it too, as plain
 * truthTable does, would flip it off for half the rows and break every
 * literal it feeds.
 */
function truthTableForDeclared(circuit: Circuit, declaredCount: number): boolean[][] {
  const inputs = circuit.getGates().filter((g) => g.kind === 'INPUT').slice(0, declaredCount)
  const outputs = circuit.getGates().filter((g) => g.kind === 'OUTPUT')
  const rows: boolean[][] = []
  const rowCount = 1 << declaredCount
  for (let i = 0; i < rowCount; i++) {
    inputs.forEach((gate, k) => {
      const bit = Boolean((i >> (declaredCount - 1 - k)) & 1)
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

describe('importVhdl: comma-separated declarations', () => {
  it('accepts multiple port names sharing one mode and type', () => {
    const vhdl = `
      entity multi is
        port (
          a, b, c : in std_logic;
          y : out std_logic
        );
      end entity multi;
      architecture rtl of multi is
      begin
        y <= a and b and c;
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.circuit.getGates().filter((g) => g.kind === 'INPUT')).toHaveLength(3)
    expect(truthTable(result.circuit).at(-1)).toEqual([true]) // 1 and 1 and 1
  })

  it('accepts multiple signal names sharing one declaration', () => {
    const vhdl = `
      entity multi is
        port (a : in std_logic; y : out std_logic);
      end entity multi;
      architecture rtl of multi is
        signal s1, s2 : std_logic;
      begin
        s1 <= a;
        s2 <= not s1;
        y <= s2;
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(truthTable(result.circuit)).toEqual([[true], [false]])
  })
})

describe('importVhdl: combinational process (if/elsif/else)', () => {
  it('compiles a simple if/else to the right priority logic', () => {
    const vhdl = `
      entity t is
        port (a : in std_logic; b : in std_logic; y : out std_logic);
      end entity t;
      architecture rtl of t is
      begin
        process(a, b)
        begin
          if (a = '1' and b = '0') then
            y <= '1';
          else
            y <= '0';
          end if;
        end process;
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(truthTableForDeclared(result.circuit, 2)).toEqual([[false], [false], [true], [false]])
  })

  it('resolves an elsif chain in priority order, first match wins', () => {
    const vhdl = `
      entity t is
        port (a : in std_logic; b : in std_logic; y : out std_logic);
      end entity t;
      architecture rtl of t is
      begin
        process(a, b)
        begin
          if (a = '1') then
            y <= '1';
          elsif (b = '1') then
            y <= '1';
          else
            y <= '0';
          end if;
        end process;
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(truthTableForDeclared(result.circuit, 2)).toEqual([[false], [true], [true], [true]])
  })

  it('handles three outputs assigned across a multi-branch if/elsif/else (regression: each output must resolve independently)', () => {
    const vhdl = `
      entity t is
        port (a : in std_logic; b : in std_logic;
              p : out std_logic; q : out std_logic; j : out std_logic);
      end entity t;
      architecture rtl of t is
      begin
        process(a, b)
        begin
          if (a = '1') then
            p <= '1'; q <= '0'; j <= '0';
          elsif (b = '1') then
            p <= '0'; q <= '1'; j <= '0';
          else
            p <= '0'; q <= '0'; j <= '1';
          end if;
        end process;
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(truthTableForDeclared(result.circuit, 2)).toEqual([
      [false, false, true],
      [false, true, false],
      [true, false, false],
      [true, false, false],
    ])
  })

  it('folds a literal comparison directly to the signal (or its negation) instead of building an extra gate', () => {
    const vhdl = `
      entity t is
        port (a : in std_logic; y : out std_logic);
      end entity t;
      architecture rtl of t is
      begin
        process(a)
        begin
          if (a = '1') then
            y <= '1';
          else
            y <= '0';
          end if;
        end process;
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The "a" INPUT, the "y" OUTPUT, one MUX2 for the priority chain
    // (no extra gate for "a = '1'" itself, since that folds directly to
    // "a"), and one synthetic tied-high INPUT for the "y <= '1'" branch.
    expect(result.circuit.getGates()).toHaveLength(4)
  })

  it('supports a "<=" relational comparison (always true here, since std_logic has only two values)', () => {
    const vhdl = `
      entity t is
        port (a : in std_logic; y : out std_logic);
      end entity t;
      architecture rtl of t is
      begin
        process(a)
        begin
          if (a <= '1') then
            y <= '1';
          else
            y <= '0';
          end if;
        end process;
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // a <= '1' is always true for a 2-valued signal, so y is always '1'
    // regardless of "a" - it folds to a constant and never even wires "a".
    expect(truthTableForDeclared(result.circuit, 1)).toEqual([[true], [true]])
  })

  it('a clocked process is still recognized as a DFF, not a combinational process', () => {
    const vhdl = `
      entity t is
        port (d : in std_logic; clk : in std_logic; q : out std_logic);
      end entity t;
      architecture rtl of t is
        signal qs : std_logic;
      begin
        process(clk)
        begin
          if rising_edge(clk) then
            qs <= d;
          end if;
        end process;
        q <= qs;
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.circuit.getGates().some((g) => g.kind === 'DFF')).toBe(true)
  })

  it('rejects a process whose if/else does not assign every signal in every branch', () => {
    const vhdl = `
      entity t is
        port (a : in std_logic; p : out std_logic; q : out std_logic);
      end entity t;
      architecture rtl of t is
      begin
        process(a)
        begin
          if (a = '1') then
            p <= '1';
            q <= '0';
          else
            p <= '0';
          end if;
        end process;
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('q')
  })

  it('rejects a combinational process with no final "else" branch', () => {
    const vhdl = `
      entity t is
        port (a : in std_logic; y : out std_logic);
      end entity t;
      architecture rtl of t is
      begin
        process(a)
        begin
          if (a = '1') then
            y <= '1';
          elsif (a = '0') then
            y <= '0';
          end if;
        end process;
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.toLowerCase()).toContain('else')
  })
})

describe('importVhdl: a real-world hand-written file', () => {
  it('imports a 5-input magnitude-comparator-style circuit end to end', () => {
    const vhdl = `
      library IEEE;
      use IEEE.STD_LOGIC_1164.ALL;

      entity MagComp01 is
          Port ( A : in  STD_LOGIC;
                 B : in  STD_LOGIC;
                 P : out  STD_LOGIC;
                 Q : out  STD_LOGIC;
                 J : out  STD_LOGIC;
                 C1 ,C2 ,C3 : IN STD_LOGIC
                 );
      end MagComp01;

      architecture Behavioral of MagComp01 is

      begin
      PROCESS( A,B, C1,C2,C3)
      BEGIN
      IF ( (A ='1' AND B ='0'))THEN
        P<= '1' ;
        Q<='0';
        j<='0';
            ELSIF ((A ='0' AND B ='1')) THEN
                P<= '0' ;
            Q <= '1';
                j<= '0' ;
            ELSIF (((A ='0' AND B ='0') or (a='1' AND B='1'))AND(C1 ='1')AND (C2 ='0')AND(C3 = '0')) THEN
              P<='1';
              Q <= '0';
              J<='0';
               ELSIF (((A ='0' AND B ='0') or (a='1' AND B='1'))AND(C1 ='0')AND(C2='1')AND(C3 = '0')) THEN
              P<='0';
             Q<='1';
              J<='0';
               ELSIF (((A ='0' AND B ='0') or (a='1' AND B='1'))AND(C1 ='0')AND(C2 ='0')AND(C3 = '1')) THEN
              P<='0';
              Q <= '0';
              J<='1';
               ELSIF (((A ='0' AND B ='0') or (a='1' AND B='1'))AND(C3 <= '1')) THEN
              P<='0';
              Q <= '0';
              J<='1';
              ELSE
              P  <='0';
              Q  <= '0';
              J  <= '0';
              END IF;
      END PROCESS;
      end Behavioral;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const inputs = result.circuit.getGates().filter((g) => g.kind === 'INPUT')
    const outputs = result.circuit.getGates().filter((g) => g.kind === 'OUTPUT')
    expect(inputs.length).toBeGreaterThanOrEqual(5) // A, B, C1, C2, C3 (+ a synthetic tied-high input)
    expect(outputs).toHaveLength(3) // P, Q, J

    const circuit = result.circuit

    function setDeclaredInputs(a: boolean, b: boolean, c1: boolean, c2: boolean, c3: boolean) {
      const [gA, gB, gC1, gC2, gC3] = inputs
      for (const [gate, value] of [
        [gA, a],
        [gB, b],
        [gC1, c1],
        [gC2, c2],
        [gC3, c3],
      ] as const) {
        if (gate.outputValues[0] !== value) circuit.toggleInput(gate.id)
      }
      simulate(circuit)
      return outputs.map((o) => o.inputValues[0])
    }

    expect(setDeclaredInputs(true, false, false, false, false)).toEqual([true, false, false])
    expect(setDeclaredInputs(false, true, false, false, false)).toEqual([false, true, false])
    expect(setDeclaredInputs(false, false, true, false, false)).toEqual([true, false, false])
    expect(setDeclaredInputs(false, false, false, false, true)).toEqual([false, false, true])
  })
})
