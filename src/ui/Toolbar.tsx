import { useState } from 'react'
import type { GateKind } from '../engine'
import { GATE_SYMBOL } from '../scene/gateVisuals'
import { useCircuitStore } from '../state/circuitStore'
import { PRESETS, PRESET_ORDER } from '../state/presets'

const COLLAPSED_KEY = 'logic-gate-sandbox-3d:toolbar-collapsed'

const PALETTE: { kind: GateKind; label: string }[] = [
  { kind: 'INPUT', label: 'Input' },
  { kind: 'OUTPUT', label: 'Output' },
  { kind: 'AND', label: 'AND' },
  { kind: 'OR', label: 'OR' },
  { kind: 'NOT', label: 'NOT' },
  { kind: 'XOR', label: 'XOR' },
  { kind: 'NAND', label: 'NAND' },
  { kind: 'NOR', label: 'NOR' },
  { kind: 'XNOR', label: 'XNOR' },
  { kind: 'BUFFER', label: 'Buffer' },
  { kind: 'MUX2', label: 'Mux' },
  { kind: 'DFF', label: 'D-FF' },
]

export function Toolbar() {
  const placingKind = useCircuitStore((s) => s.placingKind)
  const setPlacingKind = useCircuitStore((s) => s.setPlacingKind)
  const clearCircuit = useCircuitStore((s) => s.clearCircuit)
  const loadPreset = useCircuitStore((s) => s.loadPreset)
  const saveToStorage = useCircuitStore((s) => s.saveToStorage)
  const loadFromStorage = useCircuitStore((s) => s.loadFromStorage)
  const resetView = useCircuitStore((s) => s.resetView)
  const undo = useCircuitStore((s) => s.undo)
  const redo = useCircuitStore((s) => s.redo)
  const canUndo = useCircuitStore((s) => s.past.length > 0)
  const canRedo = useCircuitStore((s) => s.future.length > 0)
  const gates = useCircuitStore((s) => s.gates)
  const wires = useCircuitStore((s) => s.wires)
  const viewMode = useCircuitStore((s) => s.viewMode)
  const setViewMode = useCircuitStore((s) => s.setViewMode)

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(COLLAPSED_KEY) === '1'
    } catch {
      return false
    }
  })

  function setCollapsedPersisted(value: boolean) {
    setCollapsed(value)
    try {
      window.localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0')
    } catch {
      // Storage unavailable (private browsing, quota); collapse state just
      // won't survive a reload.
    }
  }

  async function handleExportPdf() {
    // Dynamically imported so jsPDF (and its bundled html2canvas/dompurify
    // dependencies, pulled in unconditionally by its .html() plugin) only
    // load when someone actually exports, instead of bloating the app's
    // initial bundle.
    const { exportSchematicPdf } = await import('../export/exportSchematicPdf')
    exportSchematicPdf(gates, wires)
  }

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsedPersisted(false)}
        title="Show toolbar"
        className="comic-btn pointer-events-auto absolute left-4 top-4 px-3 py-2 text-sm font-bold"
      >
        ☰ Toolbar
      </button>
    )
  }

  return (
    <div className="comic-card pointer-events-auto absolute left-4 top-4 flex max-h-[calc(100vh-2rem)] w-72 flex-col gap-3 overflow-y-auto p-4 text-sm text-black">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-extrabold tracking-tight">Logic Gate Sandbox 3D</h1>
          <p className="mt-1 text-xs font-medium text-neutral-600">
            Pick a gate, click the workbench to place it. Drag from an output pin (right side) to
            an input pin (left side) to wire them. Click an INPUT gate to toggle it.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCollapsedPersisted(true)}
          title="Hide toolbar"
          className="comic-btn shrink-0 px-2 py-1 text-xs font-bold"
        >
          ✕
        </button>
      </div>

      <div className="flex gap-2 border-t-2 border-black pt-3">
        <button
          type="button"
          onClick={() => setViewMode('3d')}
          className={`comic-btn flex-1 px-2.5 py-1.5 text-xs font-bold ${viewMode === '3d' ? 'comic-btn-active' : ''}`}
        >
          3D View
        </button>
        <button
          type="button"
          onClick={() => setViewMode('2d')}
          className={`comic-btn flex-1 px-2.5 py-1.5 text-xs font-bold ${viewMode === '2d' ? 'comic-btn-active' : ''}`}
        >
          2D Schematic
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {PALETTE.map(({ kind, label }) => (
          <button
            key={kind}
            type="button"
            onClick={() => setPlacingKind(placingKind === kind ? null : kind)}
            className={`comic-btn flex flex-col items-center gap-0.5 px-2 py-1.5 text-xs font-bold ${
              placingKind === kind ? 'comic-btn-active' : ''
            }`}
          >
            <span className="text-base leading-none">{GATE_SYMBOL[kind]}</span>
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1.5 border-t-2 border-black pt-3">
        <span className="text-xs font-extrabold uppercase tracking-wide text-neutral-500">
          Examples
        </span>
        <div className="flex flex-wrap gap-2">
          {PRESET_ORDER.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => loadPreset(name)}
              title={PRESETS[name].description}
              className="comic-btn px-2.5 py-1.5 text-xs font-bold"
            >
              {PRESETS[name].label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-t-2 border-black pt-3">
        <button
          type="button"
          onClick={undo}
          disabled={!canUndo}
          title="Undo (Ctrl/Cmd+Z)"
          className="comic-btn px-2.5 py-1.5 text-xs font-bold"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={!canRedo}
          title="Redo (Ctrl/Cmd+Shift+Z)"
          className="comic-btn px-2.5 py-1.5 text-xs font-bold"
        >
          Redo
        </button>
        <button type="button" onClick={clearCircuit} className="comic-btn px-2.5 py-1.5 text-xs font-bold">
          Clear
        </button>
        <button type="button" onClick={saveToStorage} className="comic-btn px-2.5 py-1.5 text-xs font-bold">
          Save
        </button>
        <button type="button" onClick={loadFromStorage} className="comic-btn px-2.5 py-1.5 text-xs font-bold">
          Load
        </button>
        <button type="button" onClick={resetView} className="comic-btn px-2.5 py-1.5 text-xs font-bold">
          Reset View
        </button>
        <button
          type="button"
          onClick={handleExportPdf}
          title="Save the current circuit as a PDF schematic with standard gate symbols"
          className="comic-btn px-2.5 py-1.5 text-xs font-bold"
        >
          Export PDF
        </button>
      </div>
    </div>
  )
}
