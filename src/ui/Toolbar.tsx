import type { GateKind } from '../engine'
import { useCircuitStore } from '../state/circuitStore'

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
]

export function Toolbar() {
  const placingKind = useCircuitStore((s) => s.placingKind)
  const setPlacingKind = useCircuitStore((s) => s.setPlacingKind)
  const clearCircuit = useCircuitStore((s) => s.clearCircuit)
  const saveToStorage = useCircuitStore((s) => s.saveToStorage)
  const loadFromStorage = useCircuitStore((s) => s.loadFromStorage)
  const resetView = useCircuitStore((s) => s.resetView)

  return (
    <div className="pointer-events-auto absolute left-4 top-4 flex w-72 flex-col gap-3 rounded-xl border border-white/10 bg-black/60 p-4 text-sm text-slate-100 backdrop-blur">
      <div>
        <h1 className="text-base font-semibold">Logic Gate Sandbox 3D</h1>
        <p className="mt-1 text-xs text-slate-400">
          Pick a gate, click the workbench to place it. Drag from an output pin (right side) to
          an input pin (left side) to wire them. Click an INPUT gate to toggle it.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {PALETTE.map(({ kind, label }) => (
          <button
            key={kind}
            type="button"
            onClick={() => setPlacingKind(placingKind === kind ? null : kind)}
            className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
              placingKind === kind
                ? 'border-amber-400 bg-amber-400/20 text-amber-200'
                : 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 border-t border-white/10 pt-3">
        <button
          type="button"
          onClick={clearCircuit}
          className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/10"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={saveToStorage}
          className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/10"
        >
          Save
        </button>
        <button
          type="button"
          onClick={loadFromStorage}
          className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/10"
        >
          Load
        </button>
        <button
          type="button"
          onClick={resetView}
          className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/10"
        >
          Reset View
        </button>
      </div>
    </div>
  )
}
