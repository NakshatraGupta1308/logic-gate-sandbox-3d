import { getGateDef } from '../engine'
import { GATE_SYMBOL } from '../scene/gateVisuals'
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
    <div className="comic-card pointer-events-auto absolute bottom-4 right-4 w-64 p-4 text-sm text-black">
      {selectedGate && (
        <div className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2 text-sm font-extrabold">
            <span className="text-lg leading-none">{GATE_SYMBOL[selectedGate.kind]}</span>
            {getGateDef(selectedGate.kind).label} gate
          </h2>
          <p className="text-xs font-medium text-neutral-600">
            Position: {selectedGate.position.map((n) => n.toFixed(1)).join(', ')}
          </p>
          <p className="text-xs font-medium text-neutral-600">
            Output: {selectedGate.outputValues.map((v) => (v ? '1' : '0')).join(', ') || 'n/a'}
          </p>
          <button
            type="button"
            onClick={deleteSelected}
            className="comic-btn mt-1 px-2.5 py-1.5 text-xs font-bold text-red-600"
          >
            Delete gate
          </button>
        </div>
      )}

      {selectedWire && !selectedGate && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-extrabold">Wire</h2>
          <p className="text-xs font-medium text-neutral-600">
            Double-click a wire to delete it instantly.
          </p>
          <button
            type="button"
            onClick={deleteSelected}
            className="comic-btn mt-1 px-2.5 py-1.5 text-xs font-bold text-red-600"
          >
            Delete wire
          </button>
        </div>
      )}

      {statusMessage && !selectedGate && !selectedWire && (
        <p className="text-xs font-bold text-amber-600">{statusMessage}</p>
      )}
    </div>
  )
}
