export type GateKind =
  | 'INPUT'
  | 'OUTPUT'
  | 'AND'
  | 'OR'
  | 'NOT'
  | 'XOR'
  | 'NAND'
  | 'NOR'
  | 'XNOR'
  | 'BUFFER'
  | 'MUX2'
  | 'DFF'

export interface GateDef {
  kind: GateKind
  label: string
  numInputs: number
  numOutputs: number
  evaluate: (inputs: boolean[]) => boolean[]
  /**
   * True for gates whose outputs only change in response to a clock edge
   * rather than instantaneously from their current inputs (currently just
   * DFF). Such a gate's `evaluate` is never used to drive its outputs
   * (its `updateState` is, instead); it exists only so combinational
   * fallback code has something sane to call. Sequential gates also break
   * combinational-cycle detection: feedback that routes through one (the
   * standard register/counter pattern) is not a cycle, since the gate's
   * output does not instantly follow its input.
   */
  sequential?: boolean
  /**
   * For sequential gates only: mutates the gate's own outputValues (and any
   * private state, e.g. prevClock) from its already-refreshed inputValues.
   * Called once per simulate() pass, after combinational inputs settle and
   * before combinational outputs are propagated a second time.
   */
  updateState?: (gate: Gate) => void
}

export type Vec3 = [number, number, number]

export interface Gate {
  id: string
  kind: GateKind
  position: Vec3
  /** Values last computed for each input pin, cached for the renderer. */
  inputValues: boolean[]
  /** Values last computed for each output pin. For INPUT gates this is the toggled state. */
  outputValues: boolean[]
  /** Sequential gates only: the clock input's value as of the last simulate() pass, for edge detection. */
  prevClock?: boolean
}

export interface PinRef {
  gateId: string
  pin: number
}

export interface Wire {
  id: string
  from: PinRef
  to: PinRef
}

export interface CircuitSnapshot {
  gates: Gate[]
  wires: Wire[]
}
