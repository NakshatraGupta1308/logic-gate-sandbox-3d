import { beforeEach, describe, expect, it } from 'vitest'
import { useCircuitStore } from './circuitStore'

beforeEach(() => {
  // Start every test from an empty circuit with a clean undo/redo history.
  useCircuitStore.getState().clearCircuit()
  useCircuitStore.setState({ past: [], future: [] })
})

describe('undo/redo', () => {
  it('undoes and redoes placing a gate', () => {
    useCircuitStore.getState().placeGate('AND', [0, 0.4, 0])
    expect(useCircuitStore.getState().gates).toHaveLength(1)

    useCircuitStore.getState().undo()
    expect(useCircuitStore.getState().gates).toHaveLength(0)

    useCircuitStore.getState().redo()
    expect(useCircuitStore.getState().gates).toHaveLength(1)
    expect(useCircuitStore.getState().gates[0].kind).toBe('AND')
  })

  it('restores an INPUT gate toggled state on undo, not just its wiring', () => {
    useCircuitStore.getState().placeGate('INPUT', [0, 0.4, 0])
    const id = useCircuitStore.getState().gates[0].id

    useCircuitStore.getState().toggleInput(id)
    expect(useCircuitStore.getState().gates[0].outputValues[0]).toBe(true)

    useCircuitStore.getState().undo()
    expect(useCircuitStore.getState().gates[0].outputValues[0]).toBe(false)

    useCircuitStore.getState().redo()
    expect(useCircuitStore.getState().gates[0].outputValues[0]).toBe(true)
  })

  it('undoes a gate removal', () => {
    // Restoring from a snapshot rebuilds gates with fresh ids (same as
    // loadFromStorage), so undo is checked by kind/position, not id.
    useCircuitStore.getState().placeGate('NOT', [0, 0.4, 0])
    const id = useCircuitStore.getState().gates[0].id

    useCircuitStore.getState().removeGate(id)
    expect(useCircuitStore.getState().gates).toHaveLength(0)

    useCircuitStore.getState().undo()
    expect(useCircuitStore.getState().gates).toHaveLength(1)
    expect(useCircuitStore.getState().gates[0].kind).toBe('NOT')
    expect(useCircuitStore.getState().gates[0].position).toEqual([0, 0.4, 0])
  })

  it('undoes a wire connection', () => {
    useCircuitStore.getState().placeGate('INPUT', [-2, 0.4, 0])
    useCircuitStore.getState().placeGate('OUTPUT', [2, 0.4, 0])
    const [input, output] = useCircuitStore.getState().gates

    // completeWireDrag needs a pendingWireFrom to act on; drive it the same
    // way the scene does.
    useCircuitStore.setState({ pendingWireFrom: { gateId: input.id, pin: 0, isOutput: true } })
    useCircuitStore.getState().completeWireDrag({ gateId: output.id, pin: 0, isOutput: false })
    expect(useCircuitStore.getState().wires).toHaveLength(1)

    useCircuitStore.getState().undo()
    expect(useCircuitStore.getState().wires).toHaveLength(0)

    useCircuitStore.getState().redo()
    expect(useCircuitStore.getState().wires).toHaveLength(1)
  })

  it('does not record history while dragging a gate (moveGate alone)', () => {
    useCircuitStore.getState().placeGate('AND', [0, 0.4, 0])
    const pastAfterPlace = useCircuitStore.getState().past.length

    const id = useCircuitStore.getState().gates[0].id
    useCircuitStore.getState().moveGate(id, [1, 0.4, 1])
    useCircuitStore.getState().moveGate(id, [2, 0.4, 2])

    expect(useCircuitStore.getState().past.length).toBe(pastAfterPlace)
    expect(useCircuitStore.getState().gates[0].position).toEqual([2, 0.4, 2])
  })

  it('clears the redo stack once a new action happens after an undo', () => {
    useCircuitStore.getState().placeGate('AND', [0, 0.4, 0])
    useCircuitStore.getState().undo()
    expect(useCircuitStore.getState().future.length).toBe(1)

    useCircuitStore.getState().placeGate('OR', [1, 0.4, 1])
    expect(useCircuitStore.getState().future.length).toBe(0)
  })

  it('is a no-op when there is nothing to undo or redo', () => {
    const before = useCircuitStore.getState()
    before.undo()
    before.redo()
    expect(useCircuitStore.getState().gates).toHaveLength(0)
    expect(useCircuitStore.getState().past).toHaveLength(0)
    expect(useCircuitStore.getState().future).toHaveLength(0)
  })
})

describe('viewMode', () => {
  it('defaults to 3d and switches to 2d and back without touching the circuit', () => {
    expect(useCircuitStore.getState().viewMode).toBe('3d')

    useCircuitStore.getState().placeGate('AND', [0, 0.4, 0])
    useCircuitStore.getState().setViewMode('2d')
    expect(useCircuitStore.getState().viewMode).toBe('2d')
    expect(useCircuitStore.getState().gates).toHaveLength(1)

    useCircuitStore.getState().setViewMode('3d')
    expect(useCircuitStore.getState().viewMode).toBe('3d')
    expect(useCircuitStore.getState().gates).toHaveLength(1)
  })
})
