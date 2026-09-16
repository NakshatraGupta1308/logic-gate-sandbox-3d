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

export interface GateDef {
  kind: GateKind
  label: string
  numInputs: number
  numOutputs: number
  evaluate: (inputs: boolean[]) => boolean[]
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
