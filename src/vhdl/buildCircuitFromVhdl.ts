import { Circuit, getGateDef } from '../engine'
import type { Gate, GateKind, Vec3 } from '../engine'
import { GATE_HEIGHT, GATE_WIDTH, PIN_STANDOFF, snapToGrid } from '../scene/layout'
import { GATE_Y } from '../state/constants'
import {
  declOrderIndices,
  widthOf,
  type CompareOp,
  type Expr,
  type IfBranch,
  type ParsedVhdl,
  type Statement,
  type VhdlType,
} from './parseVhdl'

export class VhdlSemanticError extends Error {}

const BINOP_KIND: Record<'and' | 'or' | 'xor' | 'nand' | 'nor' | 'xnor', GateKind> = {
  and: 'AND',
  or: 'OR',
  xor: 'XOR',
  nand: 'NAND',
  nor: 'NOR',
  xnor: 'XNOR',
}

type Operand = { kind: 'const'; value: boolean } | { kind: 'pin'; gateId: string; pin: number }

/** A value's bits, one Operand per bit, in the same declaration order as its VHDL type (a plain std_logic is always a length-1 array). */
type Bits = Operand[]

/** The lookup key for what drives a signal: the plain name for a whole-vector (or scalar) assignment, or `name#index` for one bit assigned individually (`y(0) <= ...`). `#` cannot appear in a VHDL identifier, so this never collides with a real name. */
function bitKey(name: string, index: number | null): string {
  return index === null ? name : `${name}#${index}`
}

/**
 * Turns a parsed VHDL file into a live Circuit with an automatic left-to-
 * right layered layout (VHDL carries no position information). A
 * std_logic_vector port or signal is expanded into one ordinary single-bit
 * gate per bit (this app's engine has no native multi-bit wires), so the
 * rest of the app never needs to know vectors were involved. Expressions
 * are resolved recursively and memoized by signal name, so forward
 * references between concurrent assignments (order does not matter in
 * VHDL, unlike in most languages) and arbitrarily nested parenthesized
 * sub-expressions both work; a combinational reference cycle among plain
 * signals is still rejected, matching the live simulator's own rule.
 */
export function buildCircuitFromVhdl(parsed: ParsedVhdl): Circuit {
  const circuit = new Circuit()
  const typesByName = new Map<string, VhdlType>()
  const inputGatesByName = new Map<string, Gate[]>()
  const outputPortNames = new Set<string>()
  const definitionByName = new Map<string, Expr>()
  const dffBySignal = new Map<string, Gate[]>()
  const dffQnAlias = new Map<string, Gate[]>()
  const resolved = new Map<string, Bits>()
  const inProgress = new Set<string>()
  let tiedHighGate: Gate | null = null

  for (const port of parsed.ports) typesByName.set(port.name, port.type)
  for (const signal of parsed.signals) typesByName.set(signal.name, signal.type)

  function widthOfName(name: string): number {
    const type = typesByName.get(name)
    return type ? widthOf(type) : 1
  }

  /** A vector's declared indices in order, or [] for a plain (or unknown) name - i.e. it is never indexable. */
  function vectorIndices(name: string): number[] {
    const type = typesByName.get(name)
    return type?.kind === 'vector' ? declOrderIndices(type.range) : []
  }

  for (const port of parsed.ports) {
    if (port.mode === 'in') {
      if (inputGatesByName.has(port.name)) {
        throw new VhdlSemanticError(`Port "${port.name}" is declared more than once`)
      }
      inputGatesByName.set(
        port.name,
        Array.from({ length: widthOf(port.type) }, () => circuit.addGate('INPUT')),
      )
    } else {
      outputPortNames.add(port.name)
    }
  }

  for (const proc of parsed.processes) {
    if (proc.kind === 'dff') {
      const targets = new Set<string>()
      collectDffTargets(proc.body, targets)
      for (const target of targets) {
        requireUndefined(target, null)
        dffBySignal.set(
          target,
          Array.from({ length: widthOfName(target) }, () => circuit.addGate('DFF')),
        )
      }
      continue
    }
    // A combinational process compiles to one synthesized priority-mux
    // expression per signal (or single indexed bit) it assigns (a `case`
    // was already desugared into the same if/elsif/else shape by the
    // parser), registered exactly like a plain concurrent assignment so
    // the rest of this function (resolveName, output wiring, the
    // unused-definition sweep) needs no special case for where a
    // definition came from.
    const targets = new Map<string, { name: string; index: number | null }>()
    for (const branch of proc.branches) collectCombTargets(branch.body, targets)
    collectCombTargets(proc.elseBody, targets)
    for (const [key, { name, index }] of targets) {
      requireUndefined(name, index)
      definitionByName.set(key, buildPriorityMuxExpr(key, proc.branches, proc.elseBody))
    }
  }

  for (const assignment of parsed.assignments) {
    // The inverted output a DFF derives outside its process (see
    // exportVhdl.ts) is folded into that same DFF gate's second output
    // rather than becoming its own NOT gate; recognize and skip it here.
    // The shortcut only applies to a whole-name target: dffQnAlias is
    // never keyed by an individual indexed bit.
    const asQnAlias = assignment.targetIndex === null ? matchDffQnAlias(assignment.expr, dffBySignal) : null
    if (asQnAlias) {
      requireUndefined(assignment.target, null)
      dffQnAlias.set(assignment.target, asQnAlias)
      continue
    }
    requireUndefined(assignment.target, assignment.targetIndex)
    definitionByName.set(bitKey(assignment.target, assignment.targetIndex), assignment.expr)
  }

  /** Errors if `name` (as a whole) already has any driver: an input/DFF/Qn-alias, a whole-vector definition, or (for a vector) any individually-assigned bit. */
  function requireUndefined(name: string, index: number | null) {
    const alreadyDriven =
      inputGatesByName.has(name) ||
      dffBySignal.has(name) ||
      dffQnAlias.has(name) ||
      (index === null
        ? definitionByName.has(name) || vectorIndices(name).some((i) => definitionByName.has(bitKey(name, i)))
        : definitionByName.has(name) || definitionByName.has(bitKey(name, index)))
    if (alreadyDriven) {
      throw new VhdlSemanticError(`"${name}" is driven by more than one concurrent statement`)
    }
  }


  function tiedHigh(): Gate {
    if (!tiedHighGate) {
      tiedHighGate = circuit.addGate('INPUT')
      circuit.toggleInput(tiedHighGate.id)
    }
    return tiedHighGate
  }

  function wireOperand(operand: Operand, toGateId: string, toPin: number) {
    if (operand.kind === 'const') {
      if (!operand.value) return // unconnected already reads as false
      circuit.addWire({ gateId: tiedHigh().id, pin: 0 }, { gateId: toGateId, pin: toPin })
      return
    }
    const result = circuit.addWire({ gateId: operand.gateId, pin: operand.pin }, { gateId: toGateId, pin: toPin })
    if (!result.ok) {
      throw new VhdlSemanticError(`Could not wire "${toGateId}" pin ${toPin}: ${result.reason}`)
    }
  }

  function createGate(kind: GateKind, operands: Operand[]): Operand {
    const gate = circuit.addGate(kind)
    operands.forEach((operand, pin) => wireOperand(operand, gate.id, pin))
    return { kind: 'pin', gateId: gate.id, pin: 0 }
  }

  function negate(operand: Operand): Operand {
    return operand.kind === 'const' ? { kind: 'const', value: !operand.value } : createGate('NOT', [operand])
  }

  /** ANDs together a list of single-bit operands, constant-folding as it goes so an all-true prefix (the common case: only one real comparison bit differs) costs no gates. */
  function andAll(operands: Operand[]): Operand {
    let result: Operand = { kind: 'const', value: true }
    for (const operand of operands) {
      if (operand.kind === 'const') {
        if (!operand.value) return { kind: 'const', value: false }
        continue
      }
      result = result.kind === 'const' ? operand : createGate('AND', [result, operand])
    }
    return result
  }

  function evalCompareConst(op: CompareOp, a: boolean, b: boolean): boolean {
    const av = a ? 1 : 0
    const bv = b ? 1 : 0
    switch (op) {
      case '=':
        return av === bv
      case '<=':
        return av <= bv
      case '>=':
        return av >= bv
      case '<':
        return av < bv
      case '>':
        return av > bv
    }
  }

  /**
   * A comparison against a constant bit always reduces to one of: always
   * true, always false, the signal itself, or its negation - tried
   * directly (rather than building a real comparator gate) so a common
   * `sig = '1'`-style condition does not add gates the circuit does not
   * need. `constIsLeft` says which side of the original `left OP right`
   * the constant was on.
   */
  function foldCompareWithConst(op: CompareOp, constValue: boolean, signal: Operand, constIsLeft: boolean): Operand {
    const whenFalse = constIsLeft ? evalCompareConst(op, constValue, false) : evalCompareConst(op, false, constValue)
    const whenTrue = constIsLeft ? evalCompareConst(op, constValue, true) : evalCompareConst(op, true, constValue)
    if (whenFalse === whenTrue) return { kind: 'const', value: whenFalse }
    return whenTrue ? signal : negate(signal)
  }

  function resolveScalarCompare(op: CompareOp, left: Operand, right: Operand): Operand {
    if (left.kind === 'const' && right.kind === 'const') {
      return { kind: 'const', value: evalCompareConst(op, left.value, right.value) }
    }
    if (left.kind === 'const') return foldCompareWithConst(op, left.value, right, true)
    if (right.kind === 'const') return foldCompareWithConst(op, right.value, left, false)
    switch (op) {
      case '=':
        return createGate('XNOR', [left, right])
      case '<=':
        return createGate('OR', [negate(left), right])
      case '>=':
        return createGate('OR', [left, negate(right)])
      case '<':
        return createGate('AND', [negate(left), right])
      case '>':
        return createGate('AND', [left, negate(right)])
    }
  }

  /** `=` compares vectors bit by bit (AND of per-bit equality); every other relational operator only makes sense between single bits here, since a lexicographic multi-bit ordering isn't implemented. */
  function resolveCompare(op: CompareOp, leftExpr: Expr, rightExpr: Expr): Bits {
    const left = resolveExpr(leftExpr)
    const right = resolveExpr(rightExpr)
    if (left.length !== right.length) {
      throw new VhdlSemanticError(`Cannot compare values of different widths (${left.length} bits vs ${right.length} bits)`)
    }
    if (op !== '=') {
      if (left.length !== 1) {
        throw new VhdlSemanticError(`"${op}" is only supported between single-bit signals, not multi-bit vectors`)
      }
      return [resolveScalarCompare(op, left[0], right[0])]
    }
    return [andAll(left.map((bit, i) => resolveScalarCompare('=', bit, right[i])))]
  }

  function resolveIndexed(base: string, index: number): Operand {
    const type = typesByName.get(base)
    if (!type || type.kind !== 'vector') {
      throw new VhdlSemanticError(`"${base}(${index})" is indexed, but "${base}" is not declared as a std_logic_vector`)
    }
    const positions = declOrderIndices(type.range)
    const position = positions.indexOf(index)
    if (position === -1) {
      const rangeText = type.range.downto
        ? `${type.range.high} downto ${type.range.low}`
        : `${type.range.low} to ${type.range.high}`
      throw new VhdlSemanticError(`"${base}(${index})" is out of range: "${base}" is declared (${rangeText})`)
    }
    return resolveName(base)[position]
  }

  function resolveExpr(expr: Expr): Bits {
    switch (expr.type) {
      case 'bitlit':
        return [{ kind: 'const', value: expr.value === '1' }]
      case 'strlit':
        return expr.bits.split('').map((ch) => ({ kind: 'const', value: ch === '1' }))
      case 'ident':
        return resolveName(expr.name)
      case 'indexed':
        return [resolveIndexed(expr.base, expr.index)]
      case 'not':
        return resolveExpr(expr.operand).map(negate)
      case 'binop': {
        const left = resolveExpr(expr.left)
        const right = resolveExpr(expr.right)
        if (left.length !== right.length) {
          throw new VhdlSemanticError(
            `Cannot combine values of different widths with "${expr.op}" (${left.length} bits vs ${right.length} bits)`,
          )
        }
        return left.map((bit, i) => createGate(BINOP_KIND[expr.op], [bit, right[i]]))
      }
      case 'mux': {
        const selBits = resolveExpr(expr.sel)
        if (selBits.length !== 1) {
          throw new VhdlSemanticError('An if/case condition, or a when/else mux selector, must be a single bit, not a multi-bit vector')
        }
        const sel = selBits[0]
        const a = resolveExpr(expr.a)
        const b = resolveExpr(expr.b)
        if (a.length !== b.length) {
          throw new VhdlSemanticError(`Cannot choose between values of different widths (${a.length} bits vs ${b.length} bits)`)
        }
        return a.map((aBit, i) => createGate('MUX2', [aBit, b[i], sel]))
      }
      case 'compare':
        return resolveCompare(expr.op, expr.left, expr.right)
      case 'risingEdge':
        throw new VhdlSemanticError(
          `rising_edge(${expr.signal}) can only be used as a flip-flop's whole "if" condition, not inside a general expression`,
        )
      case 'event':
        throw new VhdlSemanticError(
          `"${expr.signal}'event" can only be used (together with a "= '1'" check) as a flip-flop's whole "if" condition, not inside a general expression`,
        )
    }
  }

  /** Resolves exactly one lookup key (a plain name, or a bitKey for an individually-assigned vector bit); returns null if nothing drives that exact key (the caller decides what that means). */
  function resolveKey(key: string): Bits | null {
    const cached = resolved.get(key)
    if (cached) return cached

    const inputGates = inputGatesByName.get(key)
    if (inputGates) {
      const bits: Bits = inputGates.map((gate) => ({ kind: 'pin', gateId: gate.id, pin: 0 }))
      resolved.set(key, bits)
      return bits
    }
    const dffGates = dffBySignal.get(key)
    if (dffGates) {
      const bits: Bits = dffGates.map((gate) => ({ kind: 'pin', gateId: gate.id, pin: 0 }))
      resolved.set(key, bits)
      return bits
    }
    const dffN = dffQnAlias.get(key)
    if (dffN) {
      const bits: Bits = dffN.map((gate) => ({ kind: 'pin', gateId: gate.id, pin: 1 }))
      resolved.set(key, bits)
      return bits
    }
    const definition = definitionByName.get(key)
    if (!definition) return null

    if (inProgress.has(key)) {
      throw new VhdlSemanticError(
        `"${describeKey(key)}" depends on itself through other signals with no flip-flop breaking the loop (combinational cycle)`,
      )
    }
    inProgress.add(key)
    const bits = resolveExpr(definition)
    inProgress.delete(key)
    if (key.includes('#') && bits.length !== 1) {
      throw new VhdlSemanticError(`"${describeKey(key)}" must be driven by a single bit, not a ${bits.length}-bit value`)
    }
    resolved.set(key, bits)
    return bits
  }

  /** Resolves a name as VHDL code would reference it: as a whole (input/DFF/Qn-alias/whole-vector definition), or, for a vector with no whole-name driver, by gathering every individually-assigned bit (`y(0) <= ...; y(1) <= ...;`). */
  function resolveName(name: string): Bits {
    const direct = resolveKey(name)
    if (direct) return direct

    const indices = vectorIndices(name)
    if (indices.length > 0) {
      const perBit = indices.map((index) => resolveKey(bitKey(name, index)))
      if (perBit.every((bits): bits is Bits => bits !== null)) {
        const bits = perBit.flat()
        resolved.set(name, bits)
        return bits
      }
      if (perBit.some((bits) => bits !== null)) {
        throw new VhdlSemanticError(
          `"${name}" has some bits assigned individually (e.g. "${name}(${indices[0]})") but not all of them; assign every bit, or the whole vector at once`,
        )
      }
    }

    throw new VhdlSemanticError(`"${name}" is used but never declared as a port, a signal, or a flip-flop output`)
  }

  for (const proc of parsed.processes) {
    if (proc.kind !== 'dff') continue
    const targets = new Set<string>()
    collectDffTargets(proc.body, targets)
    const clkBits = resolveName(proc.clk)
    if (clkBits.length !== 1) throw new VhdlSemanticError(`"${proc.clk}" is used as a clock but is not a single bit`)
    for (const target of targets) {
      const dBits = resolveExpr(resolveTargetExpr(target, proc.body))
      const gates = dffBySignal.get(target)!
      if (dBits.length !== gates.length) {
        throw new VhdlSemanticError(`"${target}" is driven by a value of the wrong width in a clocked process`)
      }
      gates.forEach((gate, i) => {
        wireOperand(dBits[i], gate.id, 0)
        wireOperand(clkBits[0], gate.id, 1)
      })
    }
  }

  for (const port of parsed.ports) {
    if (port.mode !== 'out') continue
    // A vector output may be driven as a whole (definitionByName has its
    // plain name) or bit by bit (definitionByName has some of its bitKeys
    // instead); either counts as driven here; resolveName below is what
    // catches only *some* bits being driven, with a clearer error.
    const hasAnyDriver =
      definitionByName.has(port.name) || vectorIndices(port.name).some((index) => definitionByName.has(bitKey(port.name, index)))
    if (!hasAnyDriver) {
      throw new VhdlSemanticError(`Output port "${port.name}" is never assigned a value`)
    }
    // Via resolveName (which caches by name), not a direct resolveExpr, so
    // the sweep below sees this name already resolved instead of building
    // a second, unwired copy of the same logic.
    for (const bit of resolveName(port.name)) {
      const outputGate = circuit.addGate('OUTPUT')
      wireOperand(bit, outputGate.id, 0)
    }
  }

  // Also resolve any signal that no output (or anything else) ends up
  // referencing, purely so a stray unused definition still surfaces the
  // same errors (undefined reference, cycle) it would if it mattered.
  // Already-resolved names (every output, by now) are cache hits here.
  for (const name of definitionByName.keys()) resolveName(name)

  layoutCircuit(circuit)
  return circuit
}

/** Collects the plain (never indexed) signal names a clocked process's body assigns; a synchronous element always registers a whole-width DFF up front, so an indexed target inside one (`q(0) <= ...`) has nowhere consistent to plug into and is rejected here with a clear error instead. */
function collectDffTargets(statements: Statement[], out: Set<string>) {
  for (const stmt of statements) {
    if (stmt.kind === 'assign') {
      if (stmt.targetIndex !== null) {
        throw new VhdlSemanticError(
          `"${stmt.target}(${stmt.targetIndex})": assigning a single bit of a vector inside a clocked process is not supported - assign the whole vector at once instead`,
        )
      }
      out.add(stmt.target)
    } else {
      for (const branch of stmt.branches) collectDffTargets(branch.body, out)
      if (stmt.elseBody) collectDffTargets(stmt.elseBody, out)
    }
  }
}

/** Collects the targets a combinational process's body assigns, keyed by bitKey(name, index) so a whole-vector assignment and an individually-indexed one are tracked separately. */
function collectCombTargets(statements: Statement[], out: Map<string, { name: string; index: number | null }>) {
  for (const stmt of statements) {
    if (stmt.kind === 'assign') {
      out.set(bitKey(stmt.target, stmt.targetIndex), { name: stmt.target, index: stmt.targetIndex })
    } else {
      for (const branch of stmt.branches) collectCombTargets(branch.body, out)
      if (stmt.elseBody) collectCombTargets(stmt.elseBody, out)
    }
  }
}

/**
 * Synthesizes the single expression a signal's if/elsif/.../else priority
 * chain reduces to: starting from the final "else" value and wrapping
 * outward through each condition in reverse, so the outermost (and
 * therefore first-checked) mux is the original "if" branch, matching
 * VHDL's top-to-bottom priority. A branch's own body may itself contain a
 * nested if/case (e.g. a synchronous reset inside a clocked process),
 * resolved the same way recursively.
 */
function buildPriorityMuxExpr(target: string, branches: IfBranch[], elseBody: Statement[]): Expr {
  let result = resolveTargetExpr(target, elseBody)
  for (let i = branches.length - 1; i >= 0; i--) {
    const value = resolveTargetExpr(target, branches[i].body)
    result = { type: 'mux', a: result, b: value, sel: branches[i].cond }
  }
  return result
}

/** Errors if `target` (a bitKey) is not assigned along every path through `statements`, since a gap would need an inferred latch. */
function resolveTargetExpr(target: string, statements: Statement[]): Expr {
  let result: Expr | null = null
  for (const stmt of statements) {
    if (stmt.kind === 'assign') {
      if (bitKey(stmt.target, stmt.targetIndex) === target) result = stmt.expr
      continue
    }
    if (stmt.elseBody === null) throw missingBranchError(target)
    result = buildPriorityMuxExpr(target, stmt.branches, stmt.elseBody)
  }
  if (!result) throw missingBranchError(target)
  return result
}

function missingBranchError(target: string): VhdlSemanticError {
  return new VhdlSemanticError(
    `"${describeKey(target)}" is not assigned in every branch (every signal must be assigned in every branch, since an inferred latch is not supported)`,
  )
}

/** Turns a bitKey (e.g. "y#0") back into the VHDL syntax a user would recognize ("y(0)"); a plain name passes through unchanged. */
function describeKey(key: string): string {
  const hashIndex = key.indexOf('#')
  return hashIndex === -1 ? key : `${key.slice(0, hashIndex)}(${key.slice(hashIndex + 1)})`
}

/** Recognizes exportVhdl.ts's `<name> <= not <dffQSignal>;` Q-bar pattern. */
function matchDffQnAlias(expr: Expr, dffBySignal: Map<string, Gate[]>): Gate[] | null {
  if (expr.type !== 'not' || expr.operand.type !== 'ident') return null
  return dffBySignal.get(expr.operand.name) ?? null
}

/**
 * Assigns every gate an (x, z) position via longest-path layering from the
 * inputs, left to right, centered top to bottom within each layer. A
 * sequential gate's outgoing edges do not count toward a downstream gate's
 * layer (mirroring simulate.ts's topological order): its value is already
 * settled going into any given step, not something to visually "wait" on.
 */
function layoutCircuit(circuit: Circuit): void {
  const gates = circuit.getGates()
  const wires = circuit.getWires()
  const gateById = new Map(gates.map((g) => [g.id, g]))

  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()
  for (const gate of gates) {
    inDegree.set(gate.id, 0)
    adjacency.set(gate.id, [])
  }
  for (const wire of wires) {
    adjacency.get(wire.from.gateId)?.push(wire.to.gateId)
    const sourceGate = gateById.get(wire.from.gateId)
    if (sourceGate && getGateDef(sourceGate.kind).sequential) continue
    inDegree.set(wire.to.gateId, (inDegree.get(wire.to.gateId) ?? 0) + 1)
  }

  const depth = new Map<string, number>()
  let frontier = gates.filter((g) => inDegree.get(g.id) === 0).map((g) => g.id)
  for (const id of frontier) depth.set(id, 0)
  while (frontier.length > 0) {
    const next: string[] = []
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        const remaining = (inDegree.get(neighbor) ?? 0) - 1
        inDegree.set(neighbor, remaining)
        if (remaining === 0) {
          depth.set(neighbor, (depth.get(id) ?? 0) + 1)
          next.push(neighbor)
        }
      }
    }
    frontier = next
  }
  for (const gate of gates) if (!depth.has(gate.id)) depth.set(gate.id, 0)

  const byDepth = new Map<number, Gate[]>()
  for (const gate of gates) {
    const d = depth.get(gate.id) ?? 0
    const list = byDepth.get(d) ?? []
    list.push(gate)
    byDepth.set(d, list)
  }

  const xSpacing = GATE_WIDTH + PIN_STANDOFF * 2 + 1
  const zSpacing = GATE_HEIGHT + 0.6
  for (const [d, gatesAtDepth] of byDepth) {
    const totalHeight = (gatesAtDepth.length - 1) * zSpacing
    gatesAtDepth.forEach((gate, i) => {
      const position: Vec3 = [
        snapToGrid(d * xSpacing),
        GATE_Y,
        snapToGrid(-totalHeight / 2 + i * zSpacing),
      ]
      circuit.moveGate(gate.id, position)
    })
  }
}
