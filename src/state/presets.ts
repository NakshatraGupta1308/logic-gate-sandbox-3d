import type { Circuit } from '../engine'
import { GATE_Y } from './constants'

export type PresetName = 'half-adder' | 'full-adder' | 'mux2to1'

interface PresetInfo {
  label: string
  description: string
  build: (circuit: Circuit) => void
}

export const PRESET_ORDER: PresetName[] = ['half-adder', 'full-adder', 'mux2to1']

export const PRESETS: Record<PresetName, PresetInfo> = {
  'half-adder': {
    label: 'Half Adder',
    description: 'Adds two 1-bit inputs: XOR gives the sum, AND gives the carry.',
    build: (circuit) => {
      const a = circuit.addGate('INPUT', [-4.5, GATE_Y, -0.75])
      const b = circuit.addGate('INPUT', [-4.5, GATE_Y, 0.75])
      const xor = circuit.addGate('XOR', [-1.5, GATE_Y, -0.75])
      const and = circuit.addGate('AND', [-1.5, GATE_Y, 0.75])
      const sum = circuit.addGate('OUTPUT', [1.5, GATE_Y, -0.75])
      const carry = circuit.addGate('OUTPUT', [1.5, GATE_Y, 0.75])

      circuit.addWire({ gateId: a.id, pin: 0 }, { gateId: xor.id, pin: 0 })
      circuit.addWire({ gateId: b.id, pin: 0 }, { gateId: xor.id, pin: 1 })
      circuit.addWire({ gateId: a.id, pin: 0 }, { gateId: and.id, pin: 0 })
      circuit.addWire({ gateId: b.id, pin: 0 }, { gateId: and.id, pin: 1 })
      circuit.addWire({ gateId: xor.id, pin: 0 }, { gateId: sum.id, pin: 0 })
      circuit.addWire({ gateId: and.id, pin: 0 }, { gateId: carry.id, pin: 0 })
    },
  },

  'full-adder': {
    label: 'Full Adder',
    description: 'Adds two 1-bit inputs plus a carry-in, built from two half adders and an OR gate.',
    build: (circuit) => {
      const a = circuit.addGate('INPUT', [-6, GATE_Y, -1.5])
      const b = circuit.addGate('INPUT', [-6, GATE_Y, 0])
      const cin = circuit.addGate('INPUT', [-6, GATE_Y, 1.5])

      const xor1 = circuit.addGate('XOR', [-3, GATE_Y, -0.75])
      const and1 = circuit.addGate('AND', [-3, GATE_Y, 0.75])

      const xor2 = circuit.addGate('XOR', [0, GATE_Y, -0.75])
      const and2 = circuit.addGate('AND', [0, GATE_Y, 0.75])

      const or1 = circuit.addGate('OR', [3, GATE_Y, 0.75])

      const sum = circuit.addGate('OUTPUT', [6, GATE_Y, -0.75])
      const cout = circuit.addGate('OUTPUT', [6, GATE_Y, 0.75])

      circuit.addWire({ gateId: a.id, pin: 0 }, { gateId: xor1.id, pin: 0 })
      circuit.addWire({ gateId: b.id, pin: 0 }, { gateId: xor1.id, pin: 1 })
      circuit.addWire({ gateId: a.id, pin: 0 }, { gateId: and1.id, pin: 0 })
      circuit.addWire({ gateId: b.id, pin: 0 }, { gateId: and1.id, pin: 1 })

      circuit.addWire({ gateId: xor1.id, pin: 0 }, { gateId: xor2.id, pin: 0 })
      circuit.addWire({ gateId: cin.id, pin: 0 }, { gateId: xor2.id, pin: 1 })
      circuit.addWire({ gateId: xor1.id, pin: 0 }, { gateId: and2.id, pin: 0 })
      circuit.addWire({ gateId: cin.id, pin: 0 }, { gateId: and2.id, pin: 1 })

      circuit.addWire({ gateId: and1.id, pin: 0 }, { gateId: or1.id, pin: 0 })
      circuit.addWire({ gateId: and2.id, pin: 0 }, { gateId: or1.id, pin: 1 })

      circuit.addWire({ gateId: xor2.id, pin: 0 }, { gateId: sum.id, pin: 0 })
      circuit.addWire({ gateId: or1.id, pin: 0 }, { gateId: cout.id, pin: 0 })
    },
  },

  mux2to1: {
    label: '2-to-1 Mux',
    description: 'Selects input A when Select is 0, or input B when Select is 1.',
    build: (circuit) => {
      const a = circuit.addGate('INPUT', [-6, GATE_Y, -1.5])
      const b = circuit.addGate('INPUT', [-6, GATE_Y, 0])
      const sel = circuit.addGate('INPUT', [-6, GATE_Y, 1.5])

      const notSel = circuit.addGate('NOT', [-3, GATE_Y, 1.5])
      const and1 = circuit.addGate('AND', [0, GATE_Y, -0.75])
      const and2 = circuit.addGate('AND', [0, GATE_Y, 0.75])
      const or1 = circuit.addGate('OR', [3, GATE_Y, 0])
      const out = circuit.addGate('OUTPUT', [6, GATE_Y, 0])

      circuit.addWire({ gateId: sel.id, pin: 0 }, { gateId: notSel.id, pin: 0 })
      circuit.addWire({ gateId: a.id, pin: 0 }, { gateId: and1.id, pin: 0 })
      circuit.addWire({ gateId: notSel.id, pin: 0 }, { gateId: and1.id, pin: 1 })
      circuit.addWire({ gateId: b.id, pin: 0 }, { gateId: and2.id, pin: 0 })
      circuit.addWire({ gateId: sel.id, pin: 0 }, { gateId: and2.id, pin: 1 })
      circuit.addWire({ gateId: and1.id, pin: 0 }, { gateId: or1.id, pin: 0 })
      circuit.addWire({ gateId: and2.id, pin: 0 }, { gateId: or1.id, pin: 1 })
      circuit.addWire({ gateId: or1.id, pin: 0 }, { gateId: out.id, pin: 0 })
    },
  },
}
