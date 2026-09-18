import { create } from 'zustand'
import { Circuit, simulate } from '../engine'
import type { CircuitSnapshot, Gate, GateKind, Vec3, Wire } from '../engine'
import { importVhdl } from '../vhdl/importVhdl'
import { GATE_Y } from './constants'
import { PRESETS, type PresetName } from './presets'

export { GATE_Y }

const STORAGE_KEY = 'logic-gate-sandbox-3d:circuit'
const PASTE_OFFSET = 1
const MAX_HISTORY = 50

interface ClipboardEntry {
  kind: GateKind
  position: Vec3
}

/** A pin as the scene layer sees it: which gate, which index, which side. */
export interface PinHandle {
  gateId: string
  pin: number
  isOutput: boolean
}

export type ViewMode = '3d' | '2d'

interface CircuitState {
  circuit: Circuit
  gates: Gate[]
  wires: Wire[]

  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void

  /** Gate kind armed for placement; the next workbench click drops one. */
  placingKind: GateKind | null
  selectedGateId: string | null
  selectedWireId: string | null

  /** Output pin a wire drag started from, if any. */
  pendingWireFrom: PinHandle | null
  /** Live cursor point (on the workbench plane) while dragging a wire. */
  dragPoint: Vec3 | null
  hoveredPin: PinHandle | null
  /** True while a gate or wire drag is in progress; disables orbit controls. */
  isInteracting: boolean

  resetViewToken: number
  statusMessage: string | null

  /** Gate kind + position last copied, if any; paste offsets from it. */
  clipboard: ClipboardEntry | null
  pasteCount: number

  /** Undo/redo stacks of deep-cloned circuit snapshots. */
  past: CircuitSnapshot[]
  future: CircuitSnapshot[]

  setPlacingKind: (kind: GateKind | null) => void
  placeGate: (kind: GateKind, position: Vec3) => void
  removeGate: (id: string) => void
  moveGate: (id: string, position: Vec3) => void
  toggleInput: (id: string) => void
  setInteracting: (value: boolean) => void

  beginWireDrag: (from: PinHandle) => void
  updateDragPoint: (point: Vec3 | null) => void
  setHoveredPin: (pin: PinHandle | null) => void
  completeWireDrag: (to: PinHandle) => void
  cancelWireDrag: () => void
  removeWire: (id: string) => void

  select: (selection: { gateId?: string | null; wireId?: string | null }) => void
  deleteSelected: () => void
  copySelected: () => void
  cutSelected: () => void
  pasteClipboard: () => void
  clearCircuit: () => void
  loadPreset: (name: PresetName) => void
  resetView: () => void
  saveToStorage: () => void
  loadFromStorage: () => void
  importVhdlCircuit: (source: string) => void

  /** Records the current circuit as an undo point. Call before a mutation. */
  pushHistory: () => void
  undo: () => void
  redo: () => void
}

// Circuit mutates its Gate objects in place, so identity alone can't tell
// the scene layer what changed. These caches keep the last-seen wrapper for
// each id and only mint a new one when its visible fields actually differ,
// so React.memo'd GateMesh/WireCurve instances can skip re-rendering when
// an unrelated part of the circuit changes.
const gateCache = new Map<string, { key: string; snapshot: Gate }>()
const wireCache = new Map<string, Wire>()

function refresh(circuit: Circuit) {
  simulate(circuit)

  const liveGateIds = new Set<string>()
  const gates = circuit.getGates().map((gate) => {
    liveGateIds.add(gate.id)
    const key = `${gate.position.join(',')}|${gate.inputValues.join(',')}|${gate.outputValues.join(',')}`
    const cached = gateCache.get(gate.id)
    if (cached && cached.key === key) return cached.snapshot
    const snapshot: Gate = {
      ...gate,
      position: [...gate.position],
      inputValues: [...gate.inputValues],
      outputValues: [...gate.outputValues],
    }
    gateCache.set(gate.id, { key, snapshot })
    return snapshot
  })
  for (const id of gateCache.keys()) {
    if (!liveGateIds.has(id)) gateCache.delete(id)
  }

  // Wires are immutable after creation (id/from/to never change), so once
  // cached they can be reused for the wire's whole lifetime.
  const liveWireIds = new Set<string>()
  const wires = circuit.getWires().map((wire) => {
    liveWireIds.add(wire.id)
    let cached = wireCache.get(wire.id)
    if (!cached) {
      cached = { ...wire }
      wireCache.set(wire.id, cached)
    }
    return cached
  })
  for (const id of wireCache.keys()) {
    if (!liveWireIds.has(id)) wireCache.delete(id)
  }

  return { gates, wires }
}

/** Deep-clones the circuit's current gates/wires for the undo/redo stacks. */
function cloneSnapshot(circuit: Circuit): CircuitSnapshot {
  return {
    gates: circuit.getGates().map((g) => ({
      ...g,
      position: [...g.position],
      inputValues: [...g.inputValues],
      outputValues: [...g.outputValues],
    })),
    wires: circuit.getWires().map((w) => ({ ...w, from: { ...w.from }, to: { ...w.to } })),
  }
}

/**
 * Rebuilds a fresh Circuit from a snapshot, used by both loadFromStorage and
 * undo/redo. Restores each gate's actual input/output values (not just its
 * kind and position) since Circuit.addGate always starts a gate at all-false
 * and simulate() never recomputes an INPUT gate's value from its wiring, it
 * is the one value a plain rebuild-and-resimulate can't recover on its own.
 */
function restoreCircuitFromSnapshot(snapshot: CircuitSnapshot): Circuit {
  const circuit = new Circuit()
  const idMap = new Map<string, string>()
  for (const gate of snapshot.gates) {
    const restored = circuit.addGate(gate.kind, gate.position)
    idMap.set(gate.id, restored.id)
    restored.inputValues = [...gate.inputValues]
    restored.outputValues = [...gate.outputValues]
    restored.prevClock = gate.prevClock
  }
  for (const wire of snapshot.wires) {
    circuit.addWire(
      { gateId: idMap.get(wire.from.gateId) ?? wire.from.gateId, pin: wire.from.pin },
      { gateId: idMap.get(wire.to.gateId) ?? wire.to.gateId, pin: wire.to.pin },
    )
  }
  return circuit
}

function loadDemoCircuit(circuit: Circuit) {
  const a = circuit.addGate('INPUT', [-4.5, GATE_Y, -0.75])
  const b = circuit.addGate('INPUT', [-4.5, GATE_Y, 0.75])
  const and = circuit.addGate('AND', [-1.5, GATE_Y, 0])
  const output = circuit.addGate('OUTPUT', [1.5, GATE_Y, 0])
  circuit.addWire({ gateId: a.id, pin: 0 }, { gateId: and.id, pin: 0 })
  circuit.addWire({ gateId: b.id, pin: 0 }, { gateId: and.id, pin: 1 })
  circuit.addWire({ gateId: and.id, pin: 0 }, { gateId: output.id, pin: 0 })
}

const initialCircuit = new Circuit()
loadDemoCircuit(initialCircuit)

export const useCircuitStore = create<CircuitState>((set, get) => ({
  circuit: initialCircuit,
  ...refresh(initialCircuit),

  viewMode: '3d',
  setViewMode: (mode) => set({ viewMode: mode }),

  placingKind: null,
  selectedGateId: null,
  selectedWireId: null,

  pendingWireFrom: null,
  dragPoint: null,
  hoveredPin: null,
  isInteracting: false,

  resetViewToken: 0,
  statusMessage: null,

  clipboard: null,
  pasteCount: 0,

  past: [],
  future: [],

  setPlacingKind: (kind) => set({ placingKind: kind }),

  placeGate: (kind, position) => {
    const { circuit, pushHistory } = get()
    pushHistory()
    circuit.addGate(kind, position)
    set({ ...refresh(circuit), placingKind: null })
  },

  removeGate: (id) => {
    const { circuit, pushHistory } = get()
    pushHistory()
    circuit.removeGate(id)
    set({
      ...refresh(circuit),
      selectedGateId: get().selectedGateId === id ? null : get().selectedGateId,
    })
  },

  // Not wrapped in pushHistory: called continuously while dragging a gate.
  // The scene records one history entry at the start of a drag instead (see
  // GateMesh's handleBodyPointerMove), so a whole drag is a single undo step.
  moveGate: (id, position) => {
    const { circuit } = get()
    circuit.moveGate(id, position)
    set(refresh(circuit))
  },

  toggleInput: (id) => {
    const { circuit, pushHistory } = get()
    pushHistory()
    circuit.toggleInput(id)
    set(refresh(circuit))
  },

  setInteracting: (value) => set({ isInteracting: value }),

  beginWireDrag: (from) => set({ pendingWireFrom: from, dragPoint: null }),
  updateDragPoint: (point) => set({ dragPoint: point }),
  setHoveredPin: (pin) => set({ hoveredPin: pin }),

  completeWireDrag: (to) => {
    const { circuit, pendingWireFrom, pushHistory } = get()
    if (!pendingWireFrom) return
    const check = circuit.canAddWire(pendingWireFrom, to)
    if (check.ok) pushHistory()
    const result = circuit.addWire(pendingWireFrom, to)
    set({
      ...refresh(circuit),
      pendingWireFrom: null,
      dragPoint: null,
      hoveredPin: null,
      statusMessage: result.ok ? null : describeRejection(result.reason),
    })
  },

  cancelWireDrag: () => set({ pendingWireFrom: null, dragPoint: null, hoveredPin: null }),

  removeWire: (id) => {
    const { circuit, pushHistory } = get()
    pushHistory()
    circuit.removeWire(id)
    set({
      ...refresh(circuit),
      selectedWireId: get().selectedWireId === id ? null : get().selectedWireId,
    })
  },

  select: (selection) =>
    set({
      selectedGateId: selection.gateId ?? null,
      selectedWireId: selection.wireId ?? null,
    }),

  deleteSelected: () => {
    const { selectedGateId, selectedWireId, removeGate, removeWire } = get()
    if (selectedGateId) removeGate(selectedGateId)
    if (selectedWireId) removeWire(selectedWireId)
  },

  copySelected: () => {
    const { selectedGateId, gates } = get()
    const gate = gates.find((g) => g.id === selectedGateId)
    if (!gate) return
    set({ clipboard: { kind: gate.kind, position: gate.position }, pasteCount: 0 })
  },

  cutSelected: () => {
    const { selectedGateId, selectedWireId, copySelected, removeGate, removeWire } = get()
    if (selectedGateId) {
      copySelected()
      removeGate(selectedGateId)
    } else if (selectedWireId) {
      removeWire(selectedWireId)
    }
  },

  pasteClipboard: () => {
    const { clipboard, pasteCount, circuit, pushHistory } = get()
    if (!clipboard) return
    pushHistory()
    const nextCount = pasteCount + 1
    const offset = PASTE_OFFSET * nextCount
    const position: Vec3 = [
      clipboard.position[0] + offset,
      clipboard.position[1],
      clipboard.position[2] + offset,
    ]
    const gate = circuit.addGate(clipboard.kind, position)
    set({
      ...refresh(circuit),
      pasteCount: nextCount,
      selectedGateId: gate.id,
      selectedWireId: null,
    })
  },

  clearCircuit: () => {
    const { circuit, pushHistory } = get()
    pushHistory()
    circuit.clear()
    set({ ...refresh(circuit), selectedGateId: null, selectedWireId: null })
  },

  loadPreset: (name) => {
    const { circuit } = get()
    circuit.clear()
    PRESETS[name].build(circuit)
    set({
      ...refresh(circuit),
      selectedGateId: null,
      selectedWireId: null,
      placingKind: null,
      statusMessage: `Loaded ${PRESETS[name].label}.`,
    })
  },

  resetView: () => set((s) => ({ resetViewToken: s.resetViewToken + 1 })),

  saveToStorage: () => {
    const { circuit } = get()
    const snapshot: CircuitSnapshot = circuit.toSnapshot()
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
      set({ statusMessage: 'Circuit saved.' })
    } catch {
      set({ statusMessage: 'Could not save: storage unavailable.' })
    }
  },

  loadFromStorage: () => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) {
        set({ statusMessage: 'No saved circuit found.' })
        return
      }
      const snapshot = JSON.parse(raw) as CircuitSnapshot
      get().pushHistory()
      const circuit = restoreCircuitFromSnapshot(snapshot)
      set({
        circuit,
        ...refresh(circuit),
        selectedGateId: null,
        selectedWireId: null,
        statusMessage: 'Circuit loaded.',
      })
    } catch {
      set({ statusMessage: 'Could not load: saved data is corrupt.' })
    }
  },

  importVhdlCircuit: (source) => {
    const result = importVhdl(source)
    if (!result.ok) {
      set({ statusMessage: `VHDL import failed: ${result.error}` })
      return
    }
    const { pushHistory, resetViewToken } = get()
    pushHistory()
    set({
      circuit: result.circuit,
      ...refresh(result.circuit),
      selectedGateId: null,
      selectedWireId: null,
      placingKind: null,
      statusMessage: 'VHDL file imported.',
      // An imported circuit's size has nothing to do with whatever was
      // last in view, so start from a fresh, fitted camera rather than
      // risk it landing mostly (or entirely) off-screen.
      resetViewToken: resetViewToken + 1,
    })
  },

  pushHistory: () => {
    const { circuit, past } = get()
    set({ past: [...past, cloneSnapshot(circuit)].slice(-MAX_HISTORY), future: [] })
  },

  undo: () => {
    const { past, future, circuit } = get()
    const previous = past[past.length - 1]
    if (!previous) return
    const current = cloneSnapshot(circuit)
    const restored = restoreCircuitFromSnapshot(previous)
    set({
      circuit: restored,
      ...refresh(restored),
      past: past.slice(0, -1),
      future: [...future, current].slice(-MAX_HISTORY),
      selectedGateId: null,
      selectedWireId: null,
    })
  },

  redo: () => {
    const { past, future, circuit } = get()
    const next = future[future.length - 1]
    if (!next) return
    const current = cloneSnapshot(circuit)
    const restored = restoreCircuitFromSnapshot(next)
    set({
      circuit: restored,
      ...refresh(restored),
      past: [...past, current].slice(-MAX_HISTORY),
      future: future.slice(0, -1),
      selectedGateId: null,
      selectedWireId: null,
    })
  },
}))

function describeRejection(reason: string): string {
  switch (reason) {
    case 'source-not-output':
      return 'Wires must start from an output pin.'
    case 'target-not-input':
      return 'Wires must end on an input pin.'
    case 'same-gate':
      return 'Cannot wire a gate to itself.'
    case 'target-occupied':
      return 'That input already has a wire. Remove it first.'
    case 'would-cycle':
      return 'That would create a feedback loop.'
    default:
      return 'That connection is not allowed.'
  }
}
