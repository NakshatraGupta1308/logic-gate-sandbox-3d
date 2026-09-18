import type {
  AssignStatement,
  Expr,
  IfBranch,
  ParsedAssignment,
  ParsedEntity,
  ParsedInstantiation,
  ParsedPort,
  ParsedProcess,
  ParsedSignal,
  ParsedVhdl,
  Statement,
} from './parseVhdl'
import { VhdlSemanticError } from './buildCircuitFromVhdl'
import { VhdlSyntaxError } from './tokenizeVhdl'

/**
 * Reduces a file's ParsedEntity[] (one top-level design, plus zero or more
 * sub-components it structurally instantiates) into the single flat
 * ParsedVhdl the rest of the app already knows how to build: every
 * instantiated sub-component's own signals/assignments/processes are
 * copied into the top-level entity's lists, with every internal name
 * renamed to stay unique per instance (so ten instances of the same
 * two-gate component become twenty independent gates, not one shared
 * pair). The engine itself never needs to know hierarchy was involved.
 */
export function flattenVhdl(entities: ParsedEntity[]): ParsedVhdl {
  const entitiesByName = new Map(entities.map((entity) => [entity.entityName, entity]))
  const instantiatedNames = new Set<string>()
  for (const entity of entities) {
    for (const inst of entity.instantiations) instantiatedNames.add(inst.componentName)
  }

  const topCandidates = entities.filter((entity) => !instantiatedNames.has(entity.entityName))
  if (topCandidates.length === 0) {
    throw new VhdlSemanticError(
      'Could not find a top-level design in this file: every entity here is instantiated as a sub-component of another',
    )
  }
  if (topCandidates.length > 1) {
    throw new VhdlSemanticError(
      `Could not tell which entity is the top-level design: "${topCandidates.map((e) => e.entityName).join('", "')}" are all never instantiated by anything else in this file`,
    )
  }
  const top = topCandidates[0]

  const flat = inlineEntity(top, '', entitiesByName, new Set())
  return {
    entityName: top.entityName,
    ports: top.ports,
    signals: flat.signals,
    assignments: flat.assignments,
    processes: flat.processes,
  }
}

interface FlatBody {
  signals: ParsedSignal[]
  assignments: ParsedAssignment[]
  processes: ParsedProcess[]
}

/**
 * Inlines one entity's own body, plus (recursively) every component it
 * instantiates. `prefix` is prepended to every name this entity declares
 * (its ports become internal signals unless this is the top-level entity,
 * where `prefix` is ""); `visiting` guards against a component that
 * (directly or indirectly) instantiates itself.
 */
function inlineEntity(
  entity: ParsedEntity,
  prefix: string,
  entitiesByName: Map<string, ParsedEntity>,
  visiting: Set<string>,
): FlatBody {
  const isTop = prefix === ''
  const rename = (name: string) => (isTop ? name : `${prefix}${name}`)

  const signals: ParsedSignal[] = []
  if (!isTop) {
    for (const port of entity.ports) signals.push({ name: rename(port.name), type: port.type })
  }
  for (const signal of entity.signals) signals.push({ name: rename(signal.name), type: signal.type })

  const assignments: ParsedAssignment[] = entity.assignments.map((a) => ({
    target: rename(a.target),
    targetIndex: a.targetIndex,
    expr: renameExpr(a.expr, rename),
    line: a.line,
  }))

  const processes: ParsedProcess[] = entity.processes.map((proc) =>
    proc.kind === 'dff'
      ? { kind: 'dff', clk: rename(proc.clk), body: renameStatements(proc.body, rename), line: proc.line }
      : {
          kind: 'comb',
          branches: proc.branches.map((branch) => renameBranch(branch, rename)),
          elseBody: renameStatements(proc.elseBody, rename),
          line: proc.line,
        },
  )

  const seenLabels = new Set<string>()
  for (const inst of entity.instantiations) {
    if (seenLabels.has(inst.label)) {
      throw new VhdlSemanticError(`Instance label "${inst.label}" is used more than once in "${entity.entityName}"`)
    }
    seenLabels.add(inst.label)

    const subEntity = entitiesByName.get(inst.componentName)
    if (!subEntity) {
      throw new VhdlSyntaxError(
        `Component "${inst.componentName}" (instantiated as "${inst.label}") has no matching entity/architecture anywhere in this file - its own design is missing, so there is nothing to simulate for it`,
        inst.line,
      )
    }
    if (visiting.has(subEntity.entityName)) {
      throw new VhdlSemanticError(
        `"${subEntity.entityName}" instantiates itself, directly or through other components, with no way to bottom out`,
      )
    }

    const nestedPrefix = `${prefix}${inst.label}$`
    const nestedRename = (name: string) => `${nestedPrefix}${name}`
    const associations = resolveAssociations(inst, subEntity.ports)
    for (const { port, actual } of associations) {
      const renamedActual = renameExpr(actual, rename) // actual is written in the *caller's* scope
      if (port.mode === 'in') {
        assignments.push({ target: nestedRename(port.name), targetIndex: null, expr: renamedActual, line: inst.line })
      } else {
        const target = exprAsTarget(renamedActual, inst.label)
        assignments.push({
          target: target.name,
          targetIndex: target.index,
          expr: { type: 'ident', name: nestedRename(port.name) },
          line: inst.line,
        })
      }
    }

    const nested = inlineEntity(subEntity, nestedPrefix, entitiesByName, new Set(visiting).add(entity.entityName))
    signals.push(...nested.signals)
    assignments.push(...nested.assignments)
    processes.push(...nested.processes)
  }

  return { signals, assignments, processes }
}

/** Matches a port map's associations against the sub-entity's own declared ports, either all by position or all by name (VHDL does not mix the two within one instantiation, and neither does this). */
function resolveAssociations(
  inst: ParsedInstantiation,
  ports: ParsedPort[],
): { port: ParsedPort; actual: Expr }[] {
  const isNamed = inst.associations.some((a) => a.formal !== null)
  const isPositional = inst.associations.some((a) => a.formal === null)
  if (isNamed && isPositional) {
    throw new VhdlSyntaxError(
      `Instance "${inst.label}" mixes named ("x => y") and positional port map associations, which is not supported`,
      inst.line,
    )
  }
  if (isPositional) {
    if (inst.associations.length !== ports.length) {
      throw new VhdlSyntaxError(
        `Instance "${inst.label}" connects ${inst.associations.length} port(s) positionally, but "${inst.componentName}" has ${ports.length}`,
        inst.line,
      )
    }
    return inst.associations.map((assoc, i) => ({ port: ports[i], actual: assoc.actual }))
  }
  return inst.associations.map((assoc) => {
    const port = ports.find((p) => p.name === assoc.formal)
    if (!port) {
      throw new VhdlSyntaxError(
        `Instance "${inst.label}" connects a port "${assoc.formal}", but "${inst.componentName}" has no such port`,
        inst.line,
      )
    }
    return { port, actual: assoc.actual }
  })
}

/** An output port's actual must be a plain signal or one indexed bit of one - something assignable - not a general expression. */
function exprAsTarget(expr: Expr, instanceLabel: string): { name: string; index: number | null } {
  if (expr.type === 'ident') return { name: expr.name, index: null }
  if (expr.type === 'indexed') return { name: expr.base, index: expr.index }
  throw new VhdlSemanticError(
    `An output port of instance "${instanceLabel}" is connected to something other than a plain signal or an indexed bit; only those can receive a component's output`,
  )
}

function renameExpr(expr: Expr, rename: (name: string) => string): Expr {
  switch (expr.type) {
    case 'ident':
      return { type: 'ident', name: rename(expr.name) }
    case 'indexed':
      return { type: 'indexed', base: rename(expr.base), index: expr.index }
    case 'bitlit':
    case 'strlit':
      return expr
    case 'not':
      return { type: 'not', operand: renameExpr(expr.operand, rename) }
    case 'binop':
      return { type: 'binop', op: expr.op, left: renameExpr(expr.left, rename), right: renameExpr(expr.right, rename) }
    case 'mux':
      return { type: 'mux', a: renameExpr(expr.a, rename), b: renameExpr(expr.b, rename), sel: renameExpr(expr.sel, rename) }
    case 'compare':
      return { type: 'compare', op: expr.op, left: renameExpr(expr.left, rename), right: renameExpr(expr.right, rename) }
    case 'risingEdge':
      return { type: 'risingEdge', signal: rename(expr.signal) }
    case 'event':
      return { type: 'event', signal: rename(expr.signal) }
  }
}

function renameBranch(branch: IfBranch, rename: (name: string) => string): IfBranch {
  return { cond: renameExpr(branch.cond, rename), body: renameStatements(branch.body, rename) }
}

function renameStatements(statements: Statement[], rename: (name: string) => string): Statement[] {
  return statements.map((stmt): Statement =>
    stmt.kind === 'assign'
      ? ({
          kind: 'assign',
          target: rename(stmt.target),
          targetIndex: stmt.targetIndex,
          expr: renameExpr(stmt.expr, rename),
        } satisfies AssignStatement)
      : {
          kind: 'if',
          branches: stmt.branches.map((branch) => renameBranch(branch, rename)),
          elseBody: stmt.elseBody === null ? null : renameStatements(stmt.elseBody, rename),
        },
  )
}
