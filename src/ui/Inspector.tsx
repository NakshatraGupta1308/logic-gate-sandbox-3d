import { getGateDef } from '../engine'
import { useCircuitStore } from '../state/circuitStore'

export function Inspector() {
  const gates = useCircuitStore((s) => s.gates)
  const wires = useCircuitStore((s) => s.wires)
  const selectedGateId = useCircuitStore((s) => s.selectedGateId)
  const selectedWireId = useCircuitStore((s) => s.selectedWireId)
  const deleteSelected = useCircuitStore((s) => s.deleteSelected)
  const statusMessage = useCircuitStore((s) => s.statusMessage)

  const selectedGate = gates.find((g) => g.id === selectedGateId) ?? null
  const selectedWire = wires.find((w) => w.id === selectedWireId) ?? null

  if (!selectedGate && !selectedWire && !statusMessage) return null

  return (
    <div className="pointer-events-auto absolute bottom-4 right-4 w-64 rounded-xl border border-white/10 bg-black/60 p-4 text-sm text-slate-100 backdrop-blur">
      {selectedGate && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">{getGateDef(selectedGate.kind).label} gate</h2>
          <p className="text-xs text-slate-400">
            Position: {selectedGate.position.map((n) => n.toFixed(1)).join(', ')}
          </p>
          <p className="text-xs text-slate-400">
            Output: {selectedGate.outputValues.map((v) => (v ? '1' : '0')).join(', ') || 'n/a'}
          </p>
          <button
            type="button"
            onClick={deleteSelected}
            className="mt-1 rounded-md border border-red-400/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-500/20"
          >
            Delete gate
          </button>
        </div>
      )}

      {selectedWire && !selectedGate && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Wire</h2>
          <p className="text-xs text-slate-400">Double-click a wire to delete it instantly.</p>
          <button
            type="button"
            onClick={deleteSelected}
            className="mt-1 rounded-md border border-red-400/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-500/20"
          >
            Delete wire
          </button>
        </div>
      )}

      {statusMessage && !selectedGate && !selectedWire && (
        <p className="text-xs text-amber-300">{statusMessage}</p>
      )}
    </div>
  )
}
