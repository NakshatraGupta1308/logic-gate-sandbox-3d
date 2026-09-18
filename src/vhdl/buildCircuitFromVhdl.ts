import { Circuit, getGateDef } from '../engine'
import type { Gate, GateKind, Vec3 } from '../engine'
import { GATE_HEIGHT, GATE_WIDTH, PIN_STANDOFF, snapToGrid } from '../scene/layout'
import { GATE_Y } from '../state/constants'
import type { CompareOp, Expr, IfBranch, ParsedVhdl, SeqAssignment } from './parseVhdl'

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

/**
 * Turns a parsed VHDL file into a live Circuit with an automatic left-to-
 * right layered layout (VHDL carries no position information). Expressions
 * are resolved recursively and memoized by signal name, so forward
 * references between concurrent assignments (order does not matter in
 * VHDL, unlike in most languages) and arbitrarily nested parenthesized
 * sub-expressions both work; a combinational reference cycle among plain
 * signals is still rejected, matching the live simulator's own rule.
 */
export function buildCircuitFromVhdl(parsed: ParsedVhdl): Circuit {
  const circuit = new Circuit()
  const inputGateByName = new Map<string, Gate>()
  const outputPortNames = new Set<string>()
  const definitionByName = new Map<string, Expr>()
  const dffBySignal = new Map<string, { gate: Gate }>()
  const dffQnAlias = new Map<string, { gate: Gate }>()
  const resolved = new Map<string, Operand>()
  const inProgress = new Set<string>()
  let tiedHighGate: Gate | null = null

  for (const port of parsed.ports) {
    if (port.mode === 'in') {
      if (inputGateByName.has(port.name)) {
        throw new VhdlSemanticError(`Port "${port.name}" is declared more than once`)
      }
      inputGateByName.set(port.name, circuit.addGate('INPUT'))
    } else {
      outputPortNames.add(port.name)
    }
  }

  for (const proc of parsed.processes) {
    if (proc.kind === 'dff') {
      requireUndefined(proc.qTarget)
      const gate = circuit.addGate('DFF')
      dffBySignal.set(proc.qTarget, { gate })
      continue
    }
    // A combinational process compiles to one synthesized priority-mux
    // expression per signal it assigns, registered exactly like a plain
    // concurrent assignment so the rest of this function (resolveName,
    // output wiring, the unused-definition sweep) needs no special case
    // for where a definition came from.
    const targets = new Set<string>()
    for (const branch of proc.branches) for (const a of branch.assigns) targets.add(a.target)
    for (const a of proc.elseAssigns) targets.add(a.target)
    for (const target of targets) {
      requireUndefined(target)
      definitionByName.set(target, buildPriorityMuxExpr(target, proc.branches, proc.elseAssigns))
    }
  }

  for (const assignment of parsed.assignments) {
    // The inverted output a DFF derives outside its process (see
    // exportVhdl.ts) is folded into that same DFF gate's second output
    // rather than becoming its own NOT gate; recognize and skip it here.
    const asQnAlias = matchDffQnAlias(assignment.expr, dffBySignal)
    if (asQnAlias) {
      requireUndefined(assignment.target)
      dffQnAlias.set(assignment.target, asQnAlias)
      continue
    }
    requireUndefined(assignment.target)
    definitionByName.set(assignment.target, assignment.expr)
  }

  function requireUndefined(name: string) {
    if (
      inputGateByName.has(name) ||
      dffBySignal.has(name) ||
      dffQnAlias.has(name) ||
      definitionByName.has(name)
    ) {
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

  function resolveCompare(op: CompareOp, leftExpr: Expr, rightExpr: Expr): Operand {
    const left = resolveExpr(leftExpr)
    const right = resolveExpr(rightExpr)
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

  function resolveExpr(expr: Expr): Operand {
    switch (expr.type) {
      case 'bitlit':
        return { kind: 'const', value: expr.value === '1' }
      case 'ident':
        return resolveName(expr.name)
      case 'not':
        return negate(resolveExpr(expr.operand))
      case 'binop':
        return createGate(BINOP_KIND[expr.op], [resolveExpr(expr.left), resolveExpr(expr.right)])
      case 'mux':
        return createGate('MUX2', [resolveExpr(expr.a), resolveExpr(expr.b), resolveExpr(expr.sel)])
      case 'compare':
        return resolveCompare(expr.op, expr.left, expr.right)
      case 'risingEdge':
        throw new VhdlSemanticError(
          `rising_edge(${expr.signal}) can only be used as a flip-flop's whole "if" condition, not inside a general expression`,
        )
    }
  }

  function resolveName(name: string): Operand {
    const cached = resolved.get(name)
    if (cached) return cached

    const inputGate = inputGateByName.get(name)
    if (inputGate) {
      const operand: Operand = { kind: 'pin', gateId: inputGate.id, pin: 0 }
      resolved.set(name, operand)
      return operand
    }
    const dff = dffBySignal.get(name)
    if (dff) {
      const operand: Operand = { kind: 'pin', gateId: dff.gate.id, pin: 0 }
      resolved.set(name, operand)
      return operand
    }
    const dffN = dffQnAlias.get(name)
    if (dffN) {
      const operand: Operand = { kind: 'pin', gateId: dffN.gate.id, pin: 1 }
      resolved.set(name, operand)
      return operand
    }

    if (inProgress.has(name)) {
      throw new VhdlSemanticError(
        `"${name}" depends on itself through other signals with no flip-flop breaking the loop (combinational cycle)`,
      )
    }
    const definition = definitionByName.get(name)
    if (!definition) {
      throw new VhdlSemanticError(`"${name}" is used but never declared as a port, a signal, or a flip-flop output`)
    }
    inProgress.add(name)
    const operand = resolveExpr(definition)
    inProgress.delete(name)
    resolved.set(name, operand)
    return operand
  }

  for (const proc of parsed.processes) {
    if (proc.kind !== 'dff') continue
    const dff = dffBySignal.get(proc.qTarget)!
    wireOperand(resolveExpr(proc.dExpr), dff.gate.id, 0)
    wireOperand(resolveName(proc.clk), dff.gate.id, 1)
  }

  for (const port of parsed.ports) {
    if (port.mode !== 'out') continue
    if (!definitionByName.has(port.name)) {
      throw new VhdlSemanticError(`Output port "${port.name}" is never assigned a value`)
    }
    const outputGate = circuit.addGate('OUTPUT')
    // Via resolveName (which caches by name), not a direct resolveExpr, so
    // the sweep below sees this name already resolved instead of building
    // a second, unwired copy of the same logic.
    wireOperand(resolveName(port.name), outputGate.id, 0)
  }

  // Also resolve any signal that no output (or anything else) ends up
  // referencing, purely so a stray unused definition still surfaces the
  // same errors (undefined reference, cycle) it would if it mattered.
  // Already-resolved names (every output, by now) are cache hits here.
  for (const name of definitionByName.keys()) resolveName(name)

  layoutCircuit(circuit)
  return circuit
}

/**
 * Synthesizes the single expression a signal's if/elsif/.../else priority
 * chain reduces to: starting from the final "else" value and wrapping
 * outward through each condition in reverse, so the outermost (and
 * therefore first-checked) mux is the original "if" branch, matching
 * VHDL's top-to-bottom priority. Errors if `target` is not assigned in
 * every branch, since a gap would need an inferred latch.
 */
function buildPriorityMuxExpr(target: string, branches: IfBranch[], elseAssigns: SeqAssignment[]): Expr {
  const findValue = (assigns: SeqAssignment[]) => assigns.find((a) => a.target === target)?.expr

  let result = findValue(elseAssigns)
  if (!result) {
    throw new VhdlSemanticError(
      `"${target}" is not assigned in a process's final "else" branch (every signal must be assigned in every branch, since an inferred latch is not supported)`,
    )
  }
  for (let i = branches.length - 1; i >= 0; i--) {
    const value = findValue(branches[i].assigns)
    if (!value) {
      throw new VhdlSemanticError(
        `"${target}" is assigned in some branches of a process but not all of them (every signal must be assigned in every branch, since an inferred latch is not supported)`,
      )
    }
    result = { type: 'mux', a: result, b: value, sel: branches[i].cond }
  }
  return result
}

/** Recognizes exportVhdl.ts's `<name> <= not <dffQSignal>;` Q-bar pattern. */
function matchDffQnAlias(
  expr: Expr,
  dffBySignal: Map<string, { gate: Gate }>,
): { gate: Gate } | null {
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
