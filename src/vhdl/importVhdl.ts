import type { Circuit } from '../engine'
import { buildCircuitFromVhdl, VhdlSemanticError } from './buildCircuitFromVhdl'
import { parseVhdl } from './parseVhdl'
import { VhdlSyntaxError } from './tokenizeVhdl'

export type ImportVhdlResult = { ok: true; circuit: Circuit } | { ok: false; error: string }

/**
 * Parses and builds a Circuit from a VHDL source file. Never throws: any
 * failure, from a syntax error to an unsupported construct to a semantic
 * problem like a combinational cycle or a signal driven twice, comes back
 * as a plain error message naming the file's own line where possible,
 * rather than surfacing a stack trace or silently producing a wrong
 * circuit. See parseVhdl.ts for exactly which VHDL subset is supported.
 */
export function importVhdl(source: string): ImportVhdlResult {
  try {
    const parsed = parseVhdl(source)
    const circuit = buildCircuitFromVhdl(parsed)
    return { ok: true, circuit }
  } catch (error) {
    if (error instanceof VhdlSyntaxError || error instanceof VhdlSemanticError) {
      return { ok: false, error: error.message }
    }
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `Could not import this file: ${message}` }
  }
}
