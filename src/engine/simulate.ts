import type { Circuit } from './Circuit'
import { getGateDef } from './Gate'

/**
 * Runs one full propagation pass over the circuit: topologically orders the
 * gates by wire dependency, then evaluates each gate's pure function in
 * order, feeding each input pin's connected wire value (or false, if
 * unconnected) forward. Mutates each gate's cached inputValues/outputValues
 * in place so the scene layer can read them straight off the Circuit.
 *
 * Wire creation already disallows cycles (see Circuit.addWire), so a
 * topological order is guaranteed to exist; a gate that cannot be reached
 * (should not happen in practice) is simply left at its last known values.
 */
export function simulate(circuit: Circuit): void {
  const gates = circuit.getGates()
  const order = topologicalOrder(circuit)

  for (const gateId of order) {
    const gate = circuit.getGate(gateId)
    if (!gate) continue
    const def = getGateDef(gate.kind)

    if (gate.kind === 'INPUT') {
      // Output value already holds the toggled state; nothing to derive.
      continue
    }

    const inputValues = new Array(def.numInputs).fill(false)
    for (let pin = 0; pin < def.numInputs; pin++) {
      const [wire] = circuit.wiresInto({ gateId: gate.id, pin })
      if (!wire) continue
      const source = circuit.getGate(wire.from.gateId)
      inputValues[pin] = source?.outputValues[wire.from.pin] ?? false
    }

    gate.inputValues = inputValues
    gate.outputValues = def.evaluate(inputValues)
  }

  // Gates the ordering didn't reach (disconnected inputs, defensive only).
  void gates
}

/** Kahn's algorithm over the wire graph, gate ids as nodes. */
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
