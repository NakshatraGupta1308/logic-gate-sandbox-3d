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
// instance method is to wrap the constructor itself. Every created
// instance is also recorded, so a test can inspect the real document
// exportSchematicPdf built (e.g. how many pages it used) without the
// function needing to return it itself.
const createdDocs: Record<string, unknown>[] = []
vi.mock('jspdf', async () => {
  const actual = await vi.importActual<typeof import('jspdf')>('jspdf')
  function FakeJsPDF(this: unknown, ...args: unknown[]) {
    const instance = new (actual.jsPDF as unknown as new (...a: unknown[]) => Record<string, unknown>)(
      ...args,
    )
    instance.save = () => instance
    createdDocs.push(instance)
    return instance
  }
  return { ...actual, jsPDF: FakeJsPDF }
})

function lastDoc() {
  return createdDocs[createdDocs.length - 1] as { internal: { getNumberOfPages(): number } }
}

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

  it('keeps a circuit that fits at a legible scale on a single, centered page', () => {
    const circuit = new Circuit()
    circuit.addGate('AND', [0, 0, 0])
    circuit.addGate('OR', [2, 0, 2])
    exportSchematicPdf(circuit.getGates(), circuit.getWires())
    expect(lastDoc().internal.getNumberOfPages()).toBe(1)
  })

  it('tiles a circuit too big to fit at a legible scale across multiple pages instead of shrinking it to overlap', () => {
    const circuit = new Circuit()
    // Spread far enough apart that even MIN_SCALE (10mm/unit) cannot fit
    // the whole thing on one page in either direction, forcing a grid of
    // pages rather than the old behavior of clamping the scale back up and
    // cramming everything into one unreadable page.
    for (let i = 0; i < 12; i++) {
      circuit.addGate('AND', [i * 12, 0, (i % 3) * 12])
    }
    exportSchematicPdf(circuit.getGates(), circuit.getWires())
    const pageCount = lastDoc().internal.getNumberOfPages()
    expect(pageCount).toBeGreaterThan(1)
  })
})
