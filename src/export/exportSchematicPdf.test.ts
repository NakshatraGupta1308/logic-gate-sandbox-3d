import { describe, expect, it, vi } from 'vitest'
import { Circuit } from '../engine'
import { PRESETS } from '../state/presets'
import { exportSchematicPdf } from './exportSchematicPdf'

// jsPDF's save() writes a real file to disk under vitest's node test
// environment (its Node build shells out to the filesystem instead of
// triggering a browser download). These are smoke tests for the drawing
// code, not for file I/O, so save() is replaced with a no-op: jsPDF is an
// old-style constructor function that returns its own API object rather
// than using `this`/the prototype chain, so the only way to stub an
// instance method is to wrap the constructor itself.
vi.mock('jspdf', async () => {
  const actual = await vi.importActual<typeof import('jspdf')>('jspdf')
  function FakeJsPDF(this: unknown, ...args: unknown[]) {
    const instance = new (actual.jsPDF as unknown as new (...a: unknown[]) => Record<string, unknown>)(
      ...args,
    )
    instance.save = () => instance
    return instance
  }
  return { ...actual, jsPDF: FakeJsPDF }
})

describe('exportSchematicPdf', () => {
  it('does not throw for an empty circuit', () => {
    expect(() => exportSchematicPdf([], [])).not.toThrow()
  })

  it('does not throw for a single gate of every kind', () => {
    const circuit = new Circuit()
    const kinds = ['INPUT', 'OUTPUT', 'AND', 'OR', 'NOT', 'XOR', 'NAND', 'NOR', 'XNOR'] as const
    for (const kind of kinds) {
      circuit.addGate(kind, [0, 0, 0])
    }
    expect(() => exportSchematicPdf(circuit.getGates(), circuit.getWires())).not.toThrow()
  })

  it('does not throw for the half adder, full adder, and mux presets', () => {
    for (const name of ['half-adder', 'full-adder', 'mux2to1'] as const) {
      const circuit = new Circuit()
      PRESETS[name].build(circuit)
      expect(() => exportSchematicPdf(circuit.getGates(), circuit.getWires())).not.toThrow()
    }
  })
})
