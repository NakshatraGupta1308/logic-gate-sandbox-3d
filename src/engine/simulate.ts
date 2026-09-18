import type { Circuit } from './Circuit'
import { getGateDef } from './Gate'
import type { Gate, GateDef } from './types'

/**
 * Runs one full propagation pass over the circuit. Combinational logic
 * settles first (topologically, given the flip-flops' currently held
 * outputs), then any sequential gate whose clock just rose latches its new
 * state, then combinational logic settles again so the rest of the circuit
 * sees that new state immediately. A gate unreachable in the ordering
 * (should not happen in practice) is simply left at its last known values.
 */
export function simulate(circuit: Circuit): void {
  evaluateCombinational(circuit)
  updateSequential(circuit)
  evaluateCombinational(circuit)
}

function readInputs(circuit: Circuit, gate: Gate, def: GateDef): boolean[] {
  const inputValues = new Array(def.numInputs).fill(false)
  for (let pin = 0; pin < def.numInputs; pin++) {
    const [wire] = circuit.wiresInto({ gateId: gate.id, pin })
    if (!wire) continue
    const source = circuit.getGate(wire.from.gateId)
    inputValues[pin] = source?.outputValues[wire.from.pin] ?? false
  }
  return inputValues
}

function evaluateCombinational(circuit: Circuit): void {
  const order = topologicalOrder(circuit)

  for (const gateId of order) {
    const gate = circuit.getGate(gateId)
    if (!gate) continue
    const def = getGateDef(gate.kind)

    if (gate.kind === 'INPUT') {
      // Output value already holds the toggled state; nothing to derive.
      continue
    }

    const inputValues = readInputs(circuit, gate, def)
    gate.inputValues = inputValues
    // A sequential gate's own output is driven by updateSequential, gated
    // on a clock edge, rather than instantaneously from these inputs.
    if (!def.sequential) gate.outputValues = def.evaluate(inputValues)
  }
}

function updateSequential(circuit: Circuit): void {
  for (const gate of circuit.getGates()) {
    const def = getGateDef(gate.kind)
    def.updateState?.(gate)
  }
}

/**
 * Kahn's algorithm over the wire graph, gate ids as nodes. A sequential
 * gate's outputs are excluded from every downstream gate's in-degree,
 * since they are already settled (held from the last simulate() pass)
 * rather than something this pass needs to wait on.
 */
function topologicalOrder(circuit: Circuit): string[] {
  const gates = circuit.getGates()
  const wires = circuit.getWires()

  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()
  for (const gate of gates) {
    inDegree.set(gate.id, 0)
    adjacency.set(gate.id, [])
  }
  for (const wire of wires) {
    adjacency.get(wire.from.gateId)?.push(wire.to.gateId)
    const sourceGate = circuit.getGate(wire.from.gateId)
    if (sourceGate && getGateDef(sourceGate.kind).sequential) continue
    inDegree.set(wire.to.gateId, (inDegree.get(wire.to.gateId) ?? 0) + 1)
  }

  const queue = gates.filter((g) => inDegree.get(g.id) === 0).map((g) => g.id)
  const order: string[] = []

  while (queue.length > 0) {
    const id = queue.shift()!
    order.push(id)
    for (const next of adjacency.get(id) ?? []) {
      const remaining = (inDegree.get(next) ?? 0) - 1
      inDegree.set(next, remaining)
      if (remaining === 0) queue.push(next)
    }
  }

  return order
}
