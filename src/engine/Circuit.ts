import { getGateDef } from './Gate'
import type { CircuitSnapshot, Gate, GateKind, PinRef, Vec3, Wire } from './types'

let nextId = 1
function makeId(prefix: string): string {
  return `${prefix}-${nextId++}`
}

/** Reset the id counter. Only meant for deterministic tests. */
export function resetIdCounter(): void {
  nextId = 1
}

export type WireRejectionReason =
  | 'source-not-output'
  | 'target-not-input'
  | 'same-gate'
  | 'target-occupied'
  | 'would-cycle'
  | 'unknown-gate'

export type AddWireResult =
  | { ok: true; wire: Wire }
  | { ok: false; reason: WireRejectionReason }

export type WireCheckResult = { ok: true } | { ok: false; reason: WireRejectionReason }

/**
 * A directed graph of gates and wires. Pure data plus structural rules
 * (one driver per input pin, no feedback loops). Contains no rendering
 * or simulation logic; see simulate.ts for signal propagation.
 */
export class Circuit {
  private gates = new Map<string, Gate>()
  private wires = new Map<string, Wire>()

  addGate(kind: GateKind, position: Vec3 = [0, 0, 0]): Gate {
    const def = getGateDef(kind)
    const gate: Gate = {
      id: makeId('gate'),
      kind,
      position,
      inputValues: new Array(def.numInputs).fill(false),
      outputValues: new Array(def.numOutputs).fill(false),
    }
    this.gates.set(gate.id, gate)
    return gate
  }

  removeGate(gateId: string): void {
    this.gates.delete(gateId)
    for (const wire of this.wires.values()) {
      if (wire.from.gateId === gateId || wire.to.gateId === gateId) {
        this.wires.delete(wire.id)
      }
    }
  }

  getGate(gateId: string): Gate | undefined {
    return this.gates.get(gateId)
  }

  getGates(): Gate[] {
    return [...this.gates.values()]
  }

  getWires(): Wire[] {
    return [...this.wires.values()]
  }

  getWire(wireId: string): Wire | undefined {
    return this.wires.get(wireId)
  }

  moveGate(gateId: string, position: Vec3): void {
    const gate = this.gates.get(gateId)
    if (gate) gate.position = position
  }

  /** Flips an INPUT gate's stored output value. No-op for other kinds. */
  toggleInput(gateId: string): void {
    const gate = this.gates.get(gateId)
    if (!gate || gate.kind !== 'INPUT') return
    gate.outputValues = [!gate.outputValues[0]]
  }

  wiresInto(target: PinRef): Wire[] {
    return this.getWires().filter(
      (w) => w.to.gateId === target.gateId && w.to.pin === target.pin,
    )
  }

  wiresFrom(source: PinRef): Wire[] {
    return this.getWires().filter(
      (w) => w.from.gateId === source.gateId && w.from.pin === source.pin,
    )
  }

  /**
   * Attempts to wire an output pin to an input pin. Rejects connections
   * that are not output-to-input, that would give an input pin a second
   * driver, or that would create a feedback loop (cycles are out of scope
   * for v1 propagation).
   */
  /** Checks whether a wire could be added without actually adding it. */
  canAddWire(from: PinRef, to: PinRef): WireCheckResult {
    const fromGate = this.gates.get(from.gateId)
    const toGate = this.gates.get(to.gateId)
    if (!fromGate || !toGate) return { ok: false, reason: 'unknown-gate' }
    if (from.gateId === to.gateId) return { ok: false, reason: 'same-gate' }

    const fromDef = getGateDef(fromGate.kind)
    const toDef = getGateDef(toGate.kind)
    if (from.pin < 0 || from.pin >= fromDef.numOutputs) {
      return { ok: false, reason: 'source-not-output' }
    }
    if (to.pin < 0 || to.pin >= toDef.numInputs) {
      return { ok: false, reason: 'target-not-input' }
    }
    if (this.wiresInto(to).length > 0) {
      return { ok: false, reason: 'target-occupied' }
    }
    if (this.hasPath(to.gateId, from.gateId)) {
      return { ok: false, reason: 'would-cycle' }
    }

    return { ok: true }
  }

  addWire(from: PinRef, to: PinRef): AddWireResult {
    const check = this.canAddWire(from, to)
    if (!check.ok) return check

    const wire: Wire = { id: makeId('wire'), from, to }
    this.wires.set(wire.id, wire)
    return { ok: true, wire }
  }

  removeWire(wireId: string): void {
    this.wires.delete(wireId)
  }

  /** Depth-first search: is there a directed path from `start` to `end`? */
  private hasPath(start: string, end: string): boolean {
    if (start === end) return true
    const visited = new Set<string>()
    const stack = [start]
    while (stack.length > 0) {
      const current = stack.pop()!
      if (current === end) return true
      if (visited.has(current)) continue
      visited.add(current)
      for (const wire of this.wires.values()) {
        if (wire.from.gateId === current) stack.push(wire.to.gateId)
      }
    }
    return false
  }

  toSnapshot(): CircuitSnapshot {
    return { gates: this.getGates(), wires: this.getWires() }
  }

  clear(): void {
    this.gates.clear()
    this.wires.clear()
  }
}
