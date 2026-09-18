import { describe, expect, it } from 'vitest'
import { Circuit } from '../engine'
import { exportVhdl } from './exportVhdl'

function connect(circuit: Circuit, fromId: string, toId: string, toPin: number, fromPin = 0) {
  const result = circuit.addWire({ gateId: fromId, pin: fromPin }, { gateId: toId, pin: toPin })
  if (!result.ok) throw new Error(`wire rejected: ${result.reason}`)
}

describe('exportVhdl', () => {
  it('declares one in port per INPUT and one out port per OUTPUT', () => {
    const circuit = new Circuit()
    const a = circuit.addGate('INPUT')
    const b = circuit.addGate('INPUT')
    const and = circuit.addGate('AND')
    const out = circuit.addGate('OUTPUT')
    connect(circuit, a.id, and.id, 0)
    connect(circuit, b.id, and.id, 1)
    connect(circuit, and.id, out.id, 0)

    const vhdl = exportVhdl(circuit.getGates(), circuit.getWires())

    expect(vhdl).toContain('in1 : in std_logic;')
    expect(vhdl).toContain('in2 : in std_logic;')
    expect(vhdl).toContain('out1 : out std_logic')
    expect(vhdl).toContain('and1 <= in1 and in2;')
    expect(vhdl).toContain('out1 <= and1;')
  })

  it('every port declaration line ends in a semicolon except the last', () => {
    const circuit = new Circuit()
    circuit.addGate('INPUT')
    circuit.addGate('INPUT')
    circuit.addGate('OUTPUT')
    const vhdl = exportVhdl(circuit.getGates(), circuit.getWires())

    const portBlock = vhdl.slice(vhdl.indexOf('port ('), vhdl.indexOf(');'))
    const portLines = portBlock
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l !== 'port (')
    expect(portLines.slice(0, -1).every((l) => l.endsWith(';'))).toBe(true)
    expect(portLines[portLines.length - 1].endsWith(';')).toBe(false)
  })

  it('maps every gate kind to the matching VHDL operator', () => {
    const cases: [string, string][] = [
      ['AND', 'and'],
      ['OR', 'or'],
      ['NAND', 'nand'],
      ['NOR', 'nor'],
      ['XOR', 'xor'],
      ['XNOR', 'xnor'],
    ]
    for (const [kind, op] of cases) {
      const circuit = new Circuit()
      const a = circuit.addGate('INPUT')
      const b = circuit.addGate('INPUT')
      // @ts-expect-error kind is a runtime string from the cases table
      const gate = circuit.addGate(kind)
      connect(circuit, a.id, gate.id, 0)
      connect(circuit, b.id, gate.id, 1)
      const vhdl = exportVhdl(circuit.getGates(), circuit.getWires())
      expect(vhdl).toContain(`in1 ${op} in2`)
    }
  })

  it('emits a NOT gate as a unary "not" and a BUFFER as a plain passthrough', () => {
    const circuit = new Circuit()
    const a = circuit.addGate('INPUT')
    const not = circuit.addGate('NOT')
    const buf = circuit.addGate('BUFFER')
    connect(circuit, a.id, not.id, 0)
    connect(circuit, a.id, buf.id, 0)
    const vhdl = exportVhdl(circuit.getGates(), circuit.getWires())

    expect(vhdl).toContain('not_g1 <= not in1;')
    expect(vhdl).toContain('buf1 <= in1;')
  })

  it('emits a MUX2 as a when/else selecting B on a high select', () => {
    const circuit = new Circuit()
    const a = circuit.addGate('INPUT')
    const b = circuit.addGate('INPUT')
    const sel = circuit.addGate('INPUT')
    const mux = circuit.addGate('MUX2')
    connect(circuit, a.id, mux.id, 0)
    connect(circuit, b.id, mux.id, 1)
    connect(circuit, sel.id, mux.id, 2)
    const vhdl = exportVhdl(circuit.getGates(), circuit.getWires())

    expect(vhdl).toContain("mux1 <= in2 when in3 = '1' else in1;")
  })

  it('emits a DFF as a rising-edge process plus a derived inverted output', () => {
    const circuit = new Circuit()
    const d = circuit.addGate('INPUT')
    const clk = circuit.addGate('INPUT')
    const dff = circuit.addGate('DFF')
    connect(circuit, d.id, dff.id, 0)
    connect(circuit, clk.id, dff.id, 1)
    const vhdl = exportVhdl(circuit.getGates(), circuit.getWires())

    expect(vhdl).toContain('process(in2)')
    expect(vhdl).toContain('if rising_edge(in2) then')
    expect(vhdl).toContain('dff1 <= in1;')
    expect(vhdl).toContain('end if;')
    expect(vhdl).toContain('end process;')
    expect(vhdl).toContain('dff1_n <= not dff1;')
  })

  it("treats an unwired input pin as the literal '0'", () => {
    const circuit = new Circuit()
    const a = circuit.addGate('INPUT')
    const and = circuit.addGate('AND')
    connect(circuit, a.id, and.id, 0) // pin 1 left unwired
    const vhdl = exportVhdl(circuit.getGates(), circuit.getWires())

    expect(vhdl).toContain("and1 <= in1 and '0';")
  })

  it('produces a minimal valid entity for an empty circuit', () => {
    const vhdl = exportVhdl([], [])
    expect(vhdl).toContain('entity circuit is')
    expect(vhdl).toContain('end entity circuit;')
    expect(vhdl).not.toContain('port (')
  })
})
