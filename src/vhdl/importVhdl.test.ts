import { describe, expect, it } from 'vitest'
import { Circuit, simulate, type Gate } from '../engine'
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

describe('importVhdl: std_logic_vector ports and signals', () => {
  it('expands a vector port into one gate per bit, and wires indexed references', () => {
    const vhdl = `
      entity t is
        port (a : in std_logic_vector(1 downto 0); y : out std_logic_vector(1 downto 0));
      end entity t;
      architecture rtl of t is
      begin
        y(0) <= a(1);
        y(1) <= a(0);
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const inputs = result.circuit.getGates().filter((g) => g.kind === 'INPUT')
    const outputs = result.circuit.getGates().filter((g) => g.kind === 'OUTPUT')
    expect(inputs).toHaveLength(2)
    expect(outputs).toHaveLength(2)

    const [a1] = inputs // declaration order for "downto" is high-to-low: a(1), a(0)
    result.circuit.toggleInput(a1.id) // a(1) = 1, a(0) = 0
    simulate(result.circuit)
    // y(0) <= a(1) = 1; y(1) <= a(0) = 0. outputs are created in port-declared
    // order too, so outputs[0] is y(1) and outputs[1] is y(0).
    expect(outputs.map((o) => o.inputValues[0])).toEqual([false, true])
  })

  it('accepts an ascending "to" range', () => {
    const vhdl = `
      entity t is
        port (a : in std_logic_vector(0 to 1); y : out std_logic);
      end entity t;
      architecture rtl of t is
      begin
        y <= a(0) and a(1);
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(truthTable(result.circuit)).toEqual([[false], [false], [false], [true]])
  })

  it('drives a whole vector target from a bit-string literal', () => {
    const vhdl = `
      entity t is
        port (y : out std_logic_vector(1 downto 0));
      end entity t;
      architecture rtl of t is
      begin
        y <= "10";
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    simulate(result.circuit)
    const outputs = result.circuit.getGates().filter((g) => g.kind === 'OUTPUT')
    expect(outputs.map((o) => o.inputValues[0])).toEqual([true, false]) // y(1)=1, y(0)=0
  })

  it('drives a whole vector target from another vector signal', () => {
    const vhdl = `
      entity t is
        port (a : in std_logic_vector(1 downto 0); y : out std_logic_vector(1 downto 0));
      end entity t;
      architecture rtl of t is
      begin
        y <= a;
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [a1, a0] = result.circuit.getGates().filter((g) => g.kind === 'INPUT')
    result.circuit.toggleInput(a0.id)
    simulate(result.circuit)
    const outputs = result.circuit.getGates().filter((g) => g.kind === 'OUTPUT')
    expect(outputs.map((o) => o.inputValues[0])).toEqual([false, true])
    expect(a1).toBeDefined()
  })

  it('compares a vector against a bit-string literal as a single equality (AND of per-bit equality)', () => {
    const vhdl = `
      entity t is
        port (a : in std_logic_vector(1 downto 0); y : out std_logic);
      end entity t;
      architecture rtl of t is
      begin
        y <= '1' when a = "10" else '0';
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // "a" is a 2-bit port; the '1'/'0' mux branches add a synthetic
    // tied-high input, so sweep only the declared 2 bits, not all 3 inputs.
    expect(truthTableForDeclared(result.circuit, 2)).toEqual([[false], [false], [true], [false]])
  })

  it('rejects indexing a name that was not declared as a vector', () => {
    const vhdl = `
      entity t is
        port (a : in std_logic; y : out std_logic);
      end entity t;
      architecture rtl of t is
      begin
        y <= a(0);
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('not declared as a std_logic_vector')
  })

  it('rejects an out-of-range index', () => {
    const vhdl = `
      entity t is
        port (a : in std_logic_vector(1 downto 0); y : out std_logic);
      end entity t;
      architecture rtl of t is
      begin
        y <= a(3);
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('out of range')
  })

  it('rejects a relational comparison other than "=" between vectors', () => {
    const vhdl = `
      entity t is
        port (a : in std_logic_vector(1 downto 0); b : in std_logic_vector(1 downto 0); y : out std_logic);
      end entity t;
      architecture rtl of t is
      begin
        y <= '1' when a < b else '0';
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('multi-bit vectors')
  })

  it('drives each bit of a vector output independently via indexed targets (PASCLA-style ip(0) <= b(0) xor cin)', () => {
    const vhdl = `
      entity t is
        port (a : in std_logic_vector(1 downto 0); y : out std_logic_vector(1 downto 0));
      end entity t;
      architecture rtl of t is
      begin
        y(0) <= a(1);
        y(1) <= a(0);
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [a1] = result.circuit.getGates().filter((g) => g.kind === 'INPUT') // decl order: a(1), a(0)
    result.circuit.toggleInput(a1.id) // a(1)=1, a(0)=0
    simulate(result.circuit)
    const outputs = result.circuit.getGates().filter((g) => g.kind === 'OUTPUT')
    // y(1) is declared before y(0), so outputs[0]=y(1)<=a(0)=0, outputs[1]=y(0)<=a(1)=1.
    expect(outputs.map((o) => o.inputValues[0])).toEqual([false, true])
  })

  it('rejects a vector with some bits assigned individually but not all of them', () => {
    const vhdl = `
      entity t is
        port (a : in std_logic; y : out std_logic_vector(1 downto 0));
      end entity t;
      architecture rtl of t is
      begin
        y(0) <= a;
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('not all of them')
  })

  it('rejects assigning a single bit of a vector inside a clocked process', () => {
    const vhdl = `
      entity t is
        port (a : in std_logic; clk : in std_logic; q : out std_logic_vector(1 downto 0));
      end entity t;
      architecture rtl of t is
        signal qs : std_logic_vector(1 downto 0);
      begin
        process(clk)
        begin
          if rising_edge(clk) then
            qs(0) <= a;
          end if;
        end process;
        q <= qs;
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('clocked process')
  })
})

describe('importVhdl: case/when statements', () => {
  it('compiles case/when to the same priority logic as if/elsif/else, with "when others" as the default', () => {
    const vhdl = `
      entity t is
        port (s : in std_logic_vector(1 downto 0); y : out std_logic);
      end entity t;
      architecture rtl of t is
      begin
        process(s)
        begin
          case s is
            when "00" => y <= '0';
            when "01" => y <= '1';
            when others => y <= '1';
          end case;
        end process;
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // "s" is a 2-bit port; the '0'/'1' branch values add a synthetic
    // tied-high input, so sweep only the declared 2 bits, not all 3 inputs.
    expect(truthTableForDeclared(result.circuit, 2)).toEqual([[false], [true], [true], [true]])
  })

  it('rejects a case statement with no "when others" default', () => {
    const vhdl = `
      entity t is
        port (s : in std_logic; y : out std_logic);
      end entity t;
      architecture rtl of t is
      begin
        process(s)
        begin
          case s is
            when '0' => y <= '0';
            when '1' => y <= '1';
          end case;
        end process;
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.toLowerCase()).toContain('else')
  })
})

describe("importVhdl: clk'event idiom and nested if inside a process", () => {
  it("recognizes \"clk'event and clk = '1'\" as equivalent to rising_edge(clk)", () => {
    const vhdl = `
      entity t is
        port (d : in std_logic; clk : in std_logic; q : out std_logic);
      end entity t;
      architecture rtl of t is
        signal qs : std_logic;
      begin
        process(clk)
        begin
          if (clk'event and clk = '1') then
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

    const [d, clk] = result.circuit.getGates().filter((g) => g.kind === 'INPUT')
    const [q] = result.circuit.getGates().filter((g) => g.kind === 'OUTPUT')
    simulate(result.circuit)
    expect(q.inputValues[0]).toBe(false)
    result.circuit.toggleInput(d.id)
    result.circuit.toggleInput(clk.id) // rising edge
    simulate(result.circuit)
    expect(q.inputValues[0]).toBe(true)
  })

  it('supports a synchronous reset written as a nested if inside the clocked branch', () => {
    const vhdl = `
      entity t is
        port (d : in std_logic; clk : in std_logic; rst : in std_logic; q : out std_logic);
      end entity t;
      architecture rtl of t is
        signal qs : std_logic;
      begin
        process(clk)
        begin
          if rising_edge(clk) then
            if (rst = '1') then
              qs <= '0';
            else
              qs <= d;
            end if;
          end if;
        end process;
        q <= qs;
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const circuit = result.circuit

    const [d, clk, rst] = circuit.getGates().filter((g) => g.kind === 'INPUT')
    const [q] = circuit.getGates().filter((g) => g.kind === 'OUTPUT')

    function pulseClock() {
      circuit.toggleInput(clk.id)
      simulate(circuit)
      circuit.toggleInput(clk.id)
      simulate(circuit)
    }

    circuit.toggleInput(d.id) // d = 1
    pulseClock()
    expect(q.inputValues[0]).toBe(true)

    circuit.toggleInput(rst.id) // rst = 1
    pulseClock()
    expect(q.inputValues[0]).toBe(false) // reset wins over d, even though d is still 1
  })

  it('holds a flip-flop\'s own current value on a path a clocked process leaves untouched (register with enable)', () => {
    const vhdl = `
      entity t is
        port (clk : in std_logic; rst : in std_logic; q : out std_logic);
      end entity t;
      architecture rtl of t is
        signal qs : std_logic;
      begin
        process(clk)
        begin
          if rising_edge(clk) then
            if (rst = '1') then
              qs <= '0';
            end if;
          end if;
        end process;
        q <= qs;
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const circuit = result.circuit
    const [clk, rst] = circuit.getGates().filter((g) => g.kind === 'INPUT')
    const [q] = circuit.getGates().filter((g) => g.kind === 'OUTPUT')

    function setBit(gate: Gate, value: boolean) {
      if (gate.outputValues[0] !== value) circuit.toggleInput(gate.id)
    }
    function pulseClock() {
      setBit(clk, false)
      simulate(circuit)
      setBit(clk, true)
      simulate(circuit)
    }

    setBit(rst, true)
    pulseClock()
    expect(q.inputValues[0]).toBe(false)

    setBit(rst, false)
    pulseClock() // rst not asserted: qs is never assigned this edge, so it holds (stays false)
    expect(q.inputValues[0]).toBe(false)
  })

  it('still rejects a nested if inside a combinational process that does not assign the target in every branch', () => {
    const vhdl = `
      entity t is
        port (a : in std_logic; b : in std_logic; y : out std_logic);
      end entity t;
      architecture rtl of t is
      begin
        process(a, b)
        begin
          if (a = '1') then
            if (b = '1') then
              y <= '0';
            end if;
          else
            y <= '1';
          end if;
        end process;
      end architecture rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('y')
  })
})

describe('importVhdl: a real-world hand-written sequential file (Moore/Mealy state machine)', () => {
  it('imports a "detect 010 on x" sequence detector end to end, matching its expected Mealy trace', () => {
    const vhdl = `
      Library IEEE;
      Use IEEE.std_logic_1164.all;

      Entity SeqDet010 is
      Port (x   : in std_logic;
            clk : in std_logic;
            rst : in std_logic;
            z   : out std_logic
            );
      End SeqDet010;

      Architecture arch01 of SeqDet010 is

      signal pstate, nstate :std_logic_vector(1 downto 0);

      Begin
      Process(nstate,rst,clk)
      Begin
           if (clk'event and clk = '1')then
           if (rst='1')then
           pstate<="00";
           else
           pstate<=nstate;
           End if;
           End if;
      End process;

      process(x,pstate)
      begin case pstate is
           when "00" => if (x='0') then
                           nstate <="01";
                           else
                           nstate <="00";
                           end if;
           when "01" => if (x='1') then
                           nstate <="10";
                           else
                           nstate <="01";
                           end if;
           when "10" => if (x='0') then
                           nstate <="01";
                           else
                           nstate <="00";
                           end if;
           When others =>nstate<="00";
      End case;
      End process;

      Process (x,pstate)
      Begin
           case pstate is
           when "00" =>z<='0';
           when "01" =>z<='0';
           when "10" => if (x='0') then
                        z<='1';
                        else
                        z<='0';
                        End if;
           When others => z <='0';
      End case;
      End Process;

      End arch01;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const circuit = result.circuit
    const [x, clk, rst] = circuit.getGates().filter((g) => g.kind === 'INPUT')
    const [z] = circuit.getGates().filter((g) => g.kind === 'OUTPUT')

    function setBit(gate: Gate, value: boolean) {
      if (gate.outputValues[0] !== value) circuit.toggleInput(gate.id)
    }
    function pulseClock() {
      setBit(clk, false)
      simulate(circuit)
      setBit(clk, true)
      simulate(circuit)
    }

    setBit(rst, true)
    pulseClock()
    setBit(rst, false)
    simulate(circuit)

    // Mealy machine: z depends on the current state and x combinationally,
    // so it is read right after setting x/before the clock edge that would
    // advance pstate. "010" is detected with overlap allowed.
    const sequence = [0, 1, 0, 1, 0, 0, 1, 0]
    const expectedZ = [0, 0, 1, 0, 1, 0, 0, 1]
    const actualZ: number[] = []
    for (const bit of sequence) {
      setBit(x, Boolean(bit))
      simulate(circuit)
      actualZ.push(z.inputValues[0] ? 1 : 0)
      pulseClock()
    }
    expect(actualZ).toEqual(expectedZ)
  })
})

describe('importVhdl: structural component instantiation', () => {
  it('inlines a component instantiated by positional port map', () => {
    const vhdl = `
      entity sub is
        port (x : in std_logic; y : in std_logic; z : out std_logic);
      end sub;
      architecture rtl of sub is
      begin
        z <= x and y;
      end rtl;

      entity top is
        port (p : in std_logic; q : in std_logic; r : out std_logic);
      end top;
      architecture rtl of top is
      begin
        u1: sub port map (p, q, r);
      end rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(truthTable(result.circuit)).toEqual([[false], [false], [false], [true]])
  })

  it('inlines a component instantiated by named port map, in any association order', () => {
    const vhdl = `
      entity sub is
        port (x : in std_logic; y : in std_logic; z : out std_logic);
      end sub;
      architecture rtl of sub is
      begin
        z <= x and y;
      end rtl;

      entity top is
        port (p : in std_logic; q : in std_logic; r : out std_logic);
      end top;
      architecture rtl of top is
      begin
        u1: sub port map (x => p, z => r, y => q);
      end rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(truthTable(result.circuit)).toEqual([[false], [false], [false], [true]])
  })

  it('gives each instance of the same component its own independent internal state', () => {
    const vhdl = `
      entity inv is
        port (x : in std_logic; y : out std_logic);
      end inv;
      architecture rtl of inv is
      begin
        y <= not x;
      end rtl;

      entity top is
        port (a : in std_logic; b : out std_logic; c : out std_logic);
      end top;
      architecture rtl of top is
      begin
        u1: inv port map (a, b);
        u2: inv port map (b, c);
      end rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // b = not a, c = not b = a: two independent inverter instances chained,
    // not one shared gate aliasing both instantiations' internals.
    expect(truthTable(result.circuit)).toEqual([
      [true, false],
      [false, true],
    ])
  })

  it('treats an inout port as an ordinary output', () => {
    const vhdl = `
      entity t is
        port (a : in std_logic; y : inout std_logic);
      end t;
      architecture rtl of t is
      begin
        y <= a;
      end rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(truthTable(result.circuit)).toEqual([[false], [true]])
  })

  it('reproduces a 4-bit carry-lookahead adder/subtractor built from four instantiated full-adder cells (PASCLA-style)', () => {
    const vhdl = `
      library IEEE;
      use IEEE.STD_LOGIC_1164.ALL;

      entity PFA is
      Port ( A : in STD_LOGIC;
             B : in STD_LOGIC;
             Cin : in STD_LOGIC;
             S : out STD_LOGIC;
             P : out STD_LOGIC;
             G : out STD_LOGIC);
      end PFA;

      architecture Behavioral of PFA is
      begin
        S <= A xor B xor Cin;
        P <= A xor B;
        G <= A and B;
      end Behavioral;

      library IEEE;
      use IEEE.STD_LOGIC_1164.ALL;

      entity PASCLA is
      Port ( A : in STD_LOGIC_VECTOR (3 downto 0);
             B : in STD_LOGIC_VECTOR (3 downto 0);
             Cin : in STD_LOGIC;
             S : out STD_LOGIC_VECTOR (3 downto 0);
             Overflo: OUT STD_LOGIC ;
             Cout : inout STD_LOGIC);
      end PASCLA;

      architecture Behavioral of PASCLA is
      component PFA is
      Port ( A : in STD_LOGIC;
             B : in STD_LOGIC;
             Cin : in STD_LOGIC;
             S : out STD_LOGIC;
             P : out STD_LOGIC;
             G : out STD_LOGIC);
      end component;
      signal c1,c2,c3,c4: STD_LOGIC;
      signal p,g,ip: STD_LOGIC_VECTOR(3 downto 0);
      begin
      ip(0)<= b(0) xor cin;
      ip(1)<= b(1) xor cin;
      ip(2)<= b(2) xor cin;
      ip(3)<= b(3) xor cin;

      U1: PFA port map( a(0), ip(0), cin, S(0), p(0), g(0));
      U2: PFA port map( a(1), ip(1), c1, S(1), p(1), g(1));
      U3: PFA port map( a(2), ip(2), c2, S(2), p(2), g(2));
      U4: PFA port map( a(3), ip(3), c3, S(3), p(3), g(3));

      c1 <= g(0) or (p(0) and cin);
      c2 <= g(1) or (p(1) and c1);
      c3 <= g(2) or (p(2) and c2);
      c4 <= g(3) or (p(3) and c3);
      overflo <= c3 xor c4;
      cout<=c4;
      end behavioral;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const circuit = result.circuit

    const inputs = circuit.getGates().filter((g) => g.kind === 'INPUT')
    const [a3, a2, a1, a0, b3, b2, b1, b0, cin] = inputs
    const outputs = circuit.getGates().filter((g) => g.kind === 'OUTPUT')
    const [s3, s2, s1, s0] = outputs

    function setBit(gate: Gate, value: boolean) {
      if (gate.outputValues[0] !== value) circuit.toggleInput(gate.id)
    }
    function toBits(n: number): string {
      return n.toString(2).padStart(4, '0')
    }
    function add(aVal: number, bVal: number, cinVal: 0 | 1): number {
      const aBits = toBits(aVal)
      const bBits = toBits(bVal)
      ;[a3, a2, a1, a0].forEach((gate, i) => setBit(gate, aBits[i] === '1'))
      ;[b3, b2, b1, b0].forEach((gate, i) => setBit(gate, bBits[i] === '1'))
      setBit(cin, cinVal === 1)
      simulate(circuit)
      return parseInt([s3, s2, s1, s0].map((gate) => (gate.inputValues[0] ? '1' : '0')).join(''), 2)
    }

    // cin=0: plain addition mod 16.
    expect(add(0, 5, 0)).toBe(5)
    expect(add(15, 13, 0)).toBe(12) // 28 mod 16
    expect(add(11, 11, 0)).toBe(6) // 22 mod 16

    // cin=1: b(i) xor cin inverts B, and cin also feeds the LSB carry-in,
    // giving two's-complement subtraction A - B mod 16.
    expect(add(11, 10, 1)).toBe(1)
    expect(add(0, 15, 1)).toBe(1) // 0 - 15 = -15 = 1 mod 16
    expect(add(2, 1, 1)).toBe(1)
  })

  it('rejects a component with no matching entity/architecture anywhere in the file', () => {
    const vhdl = `
      entity top is
        port (a : in std_logic; y : out std_logic);
      end top;
      architecture rtl of top is
      begin
        u1: missing_thing port map (a, y);
      end rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('missing_thing')
    expect(result.error).toContain('no matching entity')
  })

  it('rejects a positional port map with the wrong number of connections', () => {
    const vhdl = `
      entity sub is
        port (x : in std_logic; y : in std_logic; z : out std_logic);
      end sub;
      architecture rtl of sub is
      begin
        z <= x and y;
      end rtl;

      entity top is
        port (a : in std_logic; b : out std_logic);
      end top;
      architecture rtl of top is
      begin
        u1: sub port map (a, b);
      end rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('u1')
  })

  it('rejects mixing named and positional associations in one instantiation', () => {
    const vhdl = `
      entity sub is
        port (x : in std_logic; y : in std_logic; z : out std_logic);
      end sub;
      architecture rtl of sub is
      begin
        z <= x and y;
      end rtl;

      entity top is
        port (a : in std_logic; b : in std_logic; c : out std_logic);
      end top;
      architecture rtl of top is
      begin
        u1: sub port map (a, y => b, z => c);
      end rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.toLowerCase()).toContain('mixes named')
  })

  it('rejects a lone entity that only ever instantiates itself (no valid top-level candidate)', () => {
    const vhdl = `
      entity loopy is
        port (a : in std_logic; y : out std_logic);
      end loopy;
      architecture rtl of loopy is
      begin
        u1: loopy port map (a, y);
      end rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.toLowerCase()).toContain('top-level')
  })

  it('rejects an indirect instantiation cycle reachable from a valid top-level entity', () => {
    const vhdl = `
      entity a is
        port (x : in std_logic; y : out std_logic);
      end a;
      architecture rtl of a is
      begin
        u1: b port map (x, y);
      end rtl;

      entity b is
        port (x : in std_logic; y : out std_logic);
      end b;
      architecture rtl of b is
      begin
        u1: a port map (x, y);
      end rtl;

      entity top is
        port (p : in std_logic; q : out std_logic);
      end top;
      architecture rtl of top is
      begin
        u1: a port map (p, q);
      end rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.toLowerCase()).toContain('itself')
  })

  it('rejects a duplicate instance label', () => {
    const vhdl = `
      entity sub is
        port (x : in std_logic; y : out std_logic);
      end sub;
      architecture rtl of sub is
      begin
        y <= not x;
      end rtl;

      entity top is
        port (a : in std_logic; b : out std_logic);
      end top;
      architecture rtl of top is
      begin
        u1: sub port map (a, b);
        u1: sub port map (a, b);
      end rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('u1')
  })

  it('rejects a file where no entity is unambiguously the top-level design', () => {
    const vhdl = `
      entity a is
        port (x : in std_logic; y : out std_logic);
      end a;
      architecture rtl of a is
      begin
        y <= x;
      end rtl;

      entity b is
        port (x : in std_logic; y : out std_logic);
      end b;
      architecture rtl of b is
      begin
        y <= x;
      end rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.toLowerCase()).toContain('top-level')
  })
})

describe('importVhdl: hex literals and "with ... select" (selected signal assignment)', () => {
  it('parses a X".." hex literal as its 4-bit expansion', () => {
    const vhdl = `
      entity t is
        port (y : out std_logic_vector(3 downto 0));
      end t;
      architecture rtl of t is
      begin
        y <= X"b";
      end rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    simulate(result.circuit)
    const outputs = result.circuit.getGates().filter((g) => g.kind === 'OUTPUT')
    expect(outputs.map((o) => (o.inputValues[0] ? '1' : '0')).join('')).toBe('1011') // 0xb
  })

  it('treats std_ulogic "don\'t care" characters (X, U, Z, W, -) in a bit string as 0', () => {
    const vhdl = `
      entity t is
        port (y : out std_logic_vector(3 downto 0));
      end t;
      architecture rtl of t is
      begin
        y <= "1XZ0";
      end rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    simulate(result.circuit)
    const outputs = result.circuit.getGates().filter((g) => g.kind === 'OUTPUT')
    expect(outputs.map((o) => (o.inputValues[0] ? '1' : '0')).join('')).toBe('1000')
  })

  it('compiles a "with ... select" statement the same way as case/when', () => {
    const vhdl = `
      entity t is
        port (s : in std_logic_vector(1 downto 0); y : out std_logic);
      end t;
      architecture rtl of t is
      begin
        with s select y <=
          '0' when "00",
          '1' when "01",
          '1' when others;
      end rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // "s" is a 2-bit port; the '0'/'1' branch values add a synthetic
    // tied-high input, so sweep only the declared 2 bits, not all 3 inputs.
    expect(truthTableForDeclared(result.circuit, 2)).toEqual([[false], [true], [true], [true]])
  })

  it('rejects a "with ... select" statement with no "when others" default', () => {
    const vhdl = `
      entity t is
        port (s : in std_logic; y : out std_logic);
      end t;
      architecture rtl of t is
      begin
        with s select y <=
          '0' when '0',
          '1' when '1';
      end rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.toLowerCase()).toContain('others')
  })

  it('imports a real 4-to-4-bit S-box built entirely from a "with ... select" statement and hex literals (Piccolo cipher S-box)', () => {
    const vhdl = `
      library IEEE;
      use IEEE.STD_LOGIC_1164.ALL;
      use IEEE.NUMERIC_STD.ALL;

      entity piccolo_sbox is
          Port ( a : in  STD_LOGIC_VECTOR (3 downto 0);
                 o : out  STD_LOGIC_VECTOR (3 downto 0));
      end piccolo_sbox;

      architecture Behavioral of piccolo_sbox is
      begin
      with a select o <=
          X"e" when X"0",
          X"4" when X"1",
          X"b" when X"2",
          X"2" when X"3",
          X"3" when X"4",
          X"8" when X"5",
          X"0" when X"6",
          X"9" when X"7",
          X"1" when X"8",
          X"a" when X"9",
          X"7" when X"a",
          X"f" when X"b",
          X"6" when X"c",
          X"c" when X"d",
          X"5" when X"e",
          X"d" when X"f",
          "XXXX" when others;
      end Behavioral;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const circuit = result.circuit
    // "a" is declared first (4 bits); the '1' bits inside the hex literals
    // add a synthetic tied-high input after it, so take only the first 4.
    const inputs = circuit.getGates().filter((g) => g.kind === 'INPUT').slice(0, 4)
    const outputs = circuit.getGates().filter((g) => g.kind === 'OUTPUT')
    expect(outputs).toHaveLength(4)

    function setBit(gate: Gate, value: boolean) {
      if (gate.outputValues[0] !== value) circuit.toggleInput(gate.id)
    }

    const sbox = ['e', '4', 'b', '2', '3', '8', '0', '9', '1', 'a', '7', 'f', '6', 'c', '5', 'd']
    for (let i = 0; i < 16; i++) {
      const bits = i.toString(2).padStart(4, '0')
      inputs.forEach((gate, k) => setBit(gate, bits[k] === '1'))
      simulate(circuit)
      const outHex = parseInt(outputs.map((g) => (g.inputValues[0] ? '1' : '0')).join(''), 2).toString(16)
      expect(outHex).toBe(sbox[i])
    }
  })
})

describe('importVhdl: integer range signals and arithmetic (+/-)', () => {
  it('declares an integer range signal as a fixed-width vector and adds a literal to it', () => {
    const vhdl = `
      entity t is
        port (clk : in std_logic; y : out std_logic_vector(1 downto 0));
      end t;
      architecture rtl of t is
        signal count : integer range 0 to 3 := 0;
      begin
        process(clk)
        begin
          if rising_edge(clk) then
            count <= count + 1;
          end if;
        end process;
        y <= count;
      end rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const circuit = result.circuit
    const [clk] = circuit.getGates().filter((g) => g.kind === 'INPUT')
    const outputs = circuit.getGates().filter((g) => g.kind === 'OUTPUT')

    function pulseClock() {
      circuit.toggleInput(clk.id)
      simulate(circuit)
      circuit.toggleInput(clk.id)
      simulate(circuit)
    }
    function readCount() {
      return parseInt(outputs.map((g) => (g.inputValues[0] ? '1' : '0')).join(''), 2)
    }

    simulate(circuit)
    expect(readCount()).toBe(0)
    pulseClock()
    expect(readCount()).toBe(1)
    pulseClock()
    expect(readCount()).toBe(2)
    pulseClock()
    expect(readCount()).toBe(3)
    pulseClock() // 3 + 1 = 4, which wraps to 0 in 2 bits, matching real fixed-width hardware
    expect(readCount()).toBe(0)
  })

  it('subtracts with "-", using the same two\'s-complement construction as an export-side subtractor', () => {
    const vhdl = `
      entity t is
        port (y : out std_logic_vector(2 downto 0));
      end t;
      architecture rtl of t is
      begin
        y <= 5 - 2;
      end rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    simulate(result.circuit)
    const outputs = result.circuit.getGates().filter((g) => g.kind === 'OUTPUT')
    expect(parseInt(outputs.map((g) => (g.inputValues[0] ? '1' : '0')).join(''), 2)).toBe(3)
  })

  it('rejects a signal with a non-zero initial value', () => {
    const vhdl = `
      entity t is
        port (y : out std_logic);
      end t;
      architecture rtl of t is
        signal s : std_logic := '1';
      begin
        y <= s;
      end rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.toLowerCase()).toContain('non-zero')
  })
})

describe('importVhdl: "(others => value)" aggregates', () => {
  it('fills a whole vector target from a scalar value', () => {
    const vhdl = `
      entity t is
        port (a : in std_logic; y : out std_logic_vector(3 downto 0));
      end t;
      architecture rtl of t is
      begin
        y <= (others => a);
      end rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [a] = result.circuit.getGates().filter((g) => g.kind === 'INPUT')
    const outputs = result.circuit.getGates().filter((g) => g.kind === 'OUTPUT')
    simulate(result.circuit)
    expect(outputs.map((o) => o.inputValues[0])).toEqual([false, false, false, false])
    result.circuit.toggleInput(a.id)
    simulate(result.circuit)
    expect(outputs.map((o) => o.inputValues[0])).toEqual([true, true, true, true])
  })

  it('fills a full-width slice target from a scalar value (BlinkLED-style "y(3 downto 0) <= (others => x);")', () => {
    const vhdl = `
      entity t is
        port (a : in std_logic; y : out std_logic_vector(3 downto 0));
      end t;
      architecture rtl of t is
      begin
        y (3 downto 0) <= (others => a);
      end rtl;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [a] = result.circuit.getGates().filter((g) => g.kind === 'INPUT')
    const outputs = result.circuit.getGates().filter((g) => g.kind === 'OUTPUT')
    result.circuit.toggleInput(a.id)
    simulate(result.circuit)
    expect(outputs.map((o) => o.inputValues[0])).toEqual([true, true, true, true])
  })
})

describe('importVhdl: a real-world hand-written blinking-LED counter (BlinkLED)', () => {
  it('imports a clocked counter that toggles a "pulse" register on overflow and mirrors it onto an LED vector, matching the real file\'s structure (scaled down to a 2-bit counter for a fast test)', () => {
    // Same shape as the actual uploaded blink.vhdl (an integer counter with
    // a synchronous "reached max -> reset and toggle pulse" branch, and
    // pulse broadcast onto an LED vector via a full-width slice aggregate),
    // just with `range 0 to 3` instead of `0 to 49999999` so the test does
    // not need tens of millions of simulated clock edges; and with the
    // original file's two missing semicolons (after each "end if") fixed,
    // since those are genuine syntax errors independent of anything this
    // importer added support for.
    const vhdl = `
      library IEEE;
      use IEEE.STD_LOGIC_1164.ALL;

      entity BlinkLED is
        Port ( CLK : in  STD_LOGIC;
               LED : out STD_LOGIC_VECTOR (3 downto 0)
             );
      end BlinkLED;

      architecture Code of BlinkLED is
        signal pulse : std_logic := '0';
        signal count : integer range 0 to 3 := 0;
      begin
        counter : process(CLK)
        begin
          if CLK'event and CLK = '1' then
            if count = 3 then
              count <= 0;
              pulse <= not pulse;
            else
              count <= count + 1;
            end if;
          end if;
        end process;

        LED (3 downto 0) <= (others => pulse);
      end Code;
    `
    const result = importVhdl(vhdl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const circuit = result.circuit
    const [clk] = circuit.getGates().filter((g) => g.kind === 'INPUT')
    const outputs = circuit.getGates().filter((g) => g.kind === 'OUTPUT')

    function pulseClock() {
      circuit.toggleInput(clk.id)
      simulate(circuit)
      circuit.toggleInput(clk.id)
      simulate(circuit)
    }
    function ledValue() {
      return outputs.map((o) => (o.inputValues[0] ? 1 : 0))
    }

    simulate(circuit)
    expect(ledValue()).toEqual([0, 0, 0, 0]) // pulse starts low
    pulseClock() // count 0 -> 1
    expect(ledValue()).toEqual([0, 0, 0, 0])
    pulseClock() // count 1 -> 2
    expect(ledValue()).toEqual([0, 0, 0, 0])
    pulseClock() // count 2 -> 3
    expect(ledValue()).toEqual([0, 0, 0, 0])
    pulseClock() // count reached 3: resets to 0 and toggles pulse high
    expect(ledValue()).toEqual([1, 1, 1, 1])
    pulseClock()
    pulseClock()
    pulseClock()
    expect(ledValue()).toEqual([1, 1, 1, 1])
    pulseClock() // count reaches 3 again: toggles pulse back low
    expect(ledValue()).toEqual([0, 0, 0, 0])
  })
})
