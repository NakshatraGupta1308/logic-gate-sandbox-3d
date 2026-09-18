import { tokenizeVhdl, VhdlSyntaxError, type Token } from './tokenizeVhdl'

export type CompareOp = '=' | '<=' | '>=' | '<' | '>'

export type Expr =
  | { type: 'ident'; name: string }
  | { type: 'bitlit'; value: '0' | '1' }
  | { type: 'not'; operand: Expr }
  | { type: 'binop'; op: 'and' | 'or' | 'xor' | 'nand' | 'nor' | 'xnor'; left: Expr; right: Expr }
  | { type: 'mux'; a: Expr; b: Expr; sel: Expr }
  | { type: 'compare'; op: CompareOp; left: Expr; right: Expr }
  | { type: 'risingEdge'; signal: string }

export interface ParsedPort {
  name: string
  mode: 'in' | 'out'
}

export interface SeqAssignment {
  target: string
  expr: Expr
}

export interface IfBranch {
  cond: Expr
  assigns: SeqAssignment[]
}

export interface ParsedAssignment {
  target: string
  expr: Expr
  line: number
}

/** A `process(clk) if rising_edge(clk) then q <= d; end if;` flip-flop. */
export interface ParsedDffProcess {
  kind: 'dff'
  clk: string
  qTarget: string
  dExpr: Expr
  line: number
}

/**
 * A general combinational `process` written as an if/elsif/.../else
 * priority chain (the common style for combinational logic in real VHDL).
 * An explicit final `else` is required: without one, VHDL would infer a
 * latch for any signal a shorter branch leaves unset, which has no
 * representation in this app's instant-simulation model.
 */
export interface ParsedCombProcess {
  kind: 'comb'
  branches: IfBranch[]
  elseAssigns: SeqAssignment[]
  line: number
}

export type ParsedProcess = ParsedDffProcess | ParsedCombProcess

export interface ParsedVhdl {
  entityName: string
  ports: ParsedPort[]
  signals: string[]
  assignments: ParsedAssignment[]
  processes: ParsedProcess[]
}

const BINOPS = new Set(['and', 'or', 'xor', 'nand', 'nor', 'xnor'])
const COMPARE_OPS = new Set(['=', '<=', '>=', '<', '>'])

class Cursor {
  private pos = 0
  private tokens: Token[]
  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset]
  }

  private currentLine(): number {
    return this.tokens[this.pos]?.line ?? this.tokens[this.tokens.length - 1]?.line ?? 1
  }

  atEnd(): boolean {
    return this.pos >= this.tokens.length
  }

  /** Consumes and returns the next token, whatever it is. */
  next(): Token {
    const token = this.tokens[this.pos]
    if (!token) throw new VhdlSyntaxError('Unexpected end of file', this.currentLine())
    this.pos++
    return token
  }

  /** Consumes the next token only if it is the given ident/punct text (case-insensitive already lowercased). */
  eat(text: string): Token {
    const token = this.peek()
    if (!token || token.text !== text) {
      throw new VhdlSyntaxError(`Expected "${text}" but found ${describe(token)}`, this.currentLine())
    }
    return this.next()
  }

  /** True and consumes if the next token matches; false and leaves the cursor untouched otherwise. */
  tryEat(text: string): boolean {
    if (this.peek()?.text === text) {
      this.next()
      return true
    }
    return false
  }

  eatIdent(): string {
    const token = this.peek()
    if (!token || token.kind !== 'ident') {
      throw new VhdlSyntaxError(`Expected an identifier but found ${describe(token)}`, this.currentLine())
    }
    return this.next().text
  }
}

function describe(token: Token | undefined): string {
  if (!token) return 'end of file'
  return token.kind === 'bitlit' ? `'${token.text}'` : `"${token.text}"`
}

/**
 * Parses the dataflow-plus-combinational-process VHDL subset this app
 * supports: a single entity/architecture pair, `in`/`out` std_logic ports
 * and signals (single identifiers or a comma-separated list sharing one
 * declaration), concurrent boolean assignments (and/or/not/xor/nand/nor/
 * xnor, comparisons, a when/else mux), a clocked
 * `process(clk) if rising_edge(clk) then q <= d; end if;` per flip-flop,
 * and a combinational `process` written as an if/elsif/.../else priority
 * chain (which must end in an explicit `else`, since an inferred latch has
 * no representation here). Deliberately does not attempt general VHDL
 * (vector/bus types, generics, component instantiation, multiple
 * entities, latches) - anything outside this shape raises a
 * VhdlSyntaxError naming the line rather than guessing.
 */
export function parseVhdl(source: string): ParsedVhdl {
  const cursor = new Cursor(tokenizeVhdl(source))

  while (cursor.peek()?.text === 'library' || cursor.peek()?.text === 'use') {
    skipStatement(cursor)
  }

  cursor.eat('entity')
  const entityName = cursor.eatIdent()
  cursor.eat('is')

  const ports: ParsedPort[] = []
  if (cursor.tryEat('port')) {
    cursor.eat('(')
    if (cursor.peek()?.text !== ')') {
      do {
        const names = parseIdentList(cursor)
        cursor.eat(':')
        const modeToken = cursor.next()
        if (modeToken.text !== 'in' && modeToken.text !== 'out') {
          throw new VhdlSyntaxError(
            `Port "${names[0]}" must be "in" or "out" (found ${describe(modeToken)}); other modes like inout are not supported`,
            modeToken.line,
          )
        }
        expectType(cursor, names[0])
        for (const name of names) ports.push({ name, mode: modeToken.text })
      } while (cursor.tryEat(';'))
    }
    cursor.eat(')')
    cursor.eat(';')
  }

  cursor.eat('end')
  cursor.tryEat('entity')
  if (cursor.peek()?.text !== ';') cursor.eatIdent()
  cursor.eat(';')

  cursor.eat('architecture')
  cursor.eatIdent() // architecture name, e.g. "rtl"; not needed downstream
  cursor.eat('of')
  const archEntityName = cursor.eatIdent()
  if (archEntityName !== entityName) {
    throw new VhdlSyntaxError(
      `architecture is "of ${archEntityName}" but the entity above is "${entityName}"; only a single matching entity/architecture pair is supported`,
      cursor.peek()?.line ?? 1,
    )
  }
  cursor.eat('is')

  const signals: string[] = []
  while (cursor.peek()?.text === 'signal') {
    cursor.eat('signal')
    const names = parseIdentList(cursor)
    cursor.eat(':')
    expectType(cursor, names[0])
    cursor.eat(';')
    signals.push(...names)
  }

  cursor.eat('begin')

  const assignments: ParsedAssignment[] = []
  const processes: ParsedProcess[] = []
  while (cursor.peek() && cursor.peek()?.text !== 'end') {
    if (cursor.peek()?.text === 'process') {
      processes.push(parseProcess(cursor))
    } else {
      const line = cursor.peek()?.line ?? 1
      const target = cursor.eatIdent()
      cursor.eat('<=')
      const expr = parseExpr(cursor)
      cursor.eat(';')
      assignments.push({ target, expr, line })
    }
  }

  cursor.eat('end')
  cursor.tryEat('architecture')
  if (cursor.peek()?.text !== ';') cursor.eatIdent()
  cursor.eat(';')

  return { entityName, ports, signals, assignments, processes }
}

/** One or more comma-separated identifiers sharing a single declaration. */
function parseIdentList(cursor: Cursor): string[] {
  const names = [cursor.eatIdent()]
  while (cursor.tryEat(',')) names.push(cursor.eatIdent())
  return names
}

function expectType(cursor: Cursor, ownerName: string) {
  const typeToken = cursor.next()
  if (typeToken.text !== 'std_logic') {
    throw new VhdlSyntaxError(
      `"${ownerName}" has type "${typeToken.text}", but only std_logic is supported`,
      typeToken.line,
    )
  }
}

function parseProcess(cursor: Cursor): ParsedProcess {
  const line = cursor.peek()?.line ?? 1
  cursor.eat('process')
  cursor.eat('(')
  parseIdentList(cursor) // sensitivity list; not needed downstream, every reference resolves on its own
  cursor.eat(')')
  cursor.eat('begin')
  const ifStmt = parseIfStatement(cursor)
  cursor.eat('end')
  cursor.eat('process')
  cursor.eat(';')

  const [onlyBranch] = ifStmt.branches
  if (
    ifStmt.branches.length === 1 &&
    ifStmt.elseAssigns === null &&
    onlyBranch.cond.type === 'risingEdge' &&
    onlyBranch.assigns.length === 1
  ) {
    return {
      kind: 'dff',
      clk: onlyBranch.cond.signal,
      qTarget: onlyBranch.assigns[0].target,
      dExpr: onlyBranch.assigns[0].expr,
      line,
    }
  }

  if (ifStmt.elseAssigns === null) {
    throw new VhdlSyntaxError(
      'A process must end with an "else" branch (a signal left unset in some branch would need an inferred latch, which is not supported), unless it is a flip-flop\'s single "if rising_edge(clk) then ... end if;"',
      line,
    )
  }
  return { kind: 'comb', branches: ifStmt.branches, elseAssigns: ifStmt.elseAssigns, line }
}

interface ParsedIfStatement {
  branches: IfBranch[]
  elseAssigns: SeqAssignment[] | null
}

function parseIfStatement(cursor: Cursor): ParsedIfStatement {
  cursor.eat('if')
  const branches: IfBranch[] = [parseIfBranch(cursor)]
  while (cursor.tryEat('elsif')) {
    branches.push(parseIfBranch(cursor))
  }
  const elseAssigns = cursor.tryEat('else') ? parseSeqAssignments(cursor) : null
  cursor.eat('end')
  cursor.eat('if')
  cursor.eat(';')
  return { branches, elseAssigns }
}

function parseIfBranch(cursor: Cursor): IfBranch {
  const cond = parseBinaryChain(cursor)
  cursor.eat('then')
  const assigns = parseSeqAssignments(cursor)
  return { cond, assigns }
}

function parseSeqAssignments(cursor: Cursor): SeqAssignment[] {
  const assigns: SeqAssignment[] = []
  while (cursor.peek()?.kind === 'ident' && !isBranchKeyword(cursor.peek()!.text)) {
    const target = cursor.eatIdent()
    cursor.eat('<=')
    const expr = parseExpr(cursor)
    cursor.eat(';')
    assigns.push({ target, expr })
  }
  if (assigns.length === 0) {
    throw new VhdlSyntaxError('Expected at least one signal assignment here', cursor.peek()?.line ?? 1)
  }
  return assigns
}

function isBranchKeyword(text: string): boolean {
  return text === 'elsif' || text === 'else' || text === 'end'
}

/** Skips a `library ...;` / `use ...;` clause without interpreting it. */
function skipStatement(cursor: Cursor) {
  while (!cursor.atEnd() && cursor.peek()?.text !== ';') cursor.next()
  cursor.eat(';')
}

function parseExpr(cursor: Cursor): Expr {
  const left = parseBinaryChain(cursor)
  if (!cursor.tryEat('when')) return left
  const cond = parseBinaryChain(cursor)
  cursor.eat('else')
  const elseExpr = parseExpr(cursor)
  return { type: 'mux', a: elseExpr, b: left, sel: cond }
}

function parseBinaryChain(cursor: Cursor): Expr {
  let left = parseComparison(cursor)
  while (cursor.peek()?.kind === 'ident' && BINOPS.has(cursor.peek()!.text)) {
    const op = cursor.next().text as 'and' | 'or' | 'xor' | 'nand' | 'nor' | 'xnor'
    const right = parseComparison(cursor)
    left = { type: 'binop', op, left, right }
  }
  return left
}

function parseComparison(cursor: Cursor): Expr {
  const left = parseUnary(cursor)
  const token = cursor.peek()
  if (token?.kind === 'punct' && COMPARE_OPS.has(token.text)) {
    cursor.next()
    const right = parseUnary(cursor)
    return { type: 'compare', op: token.text as CompareOp, left, right }
  }
  return left
}

function parseUnary(cursor: Cursor): Expr {
  if (cursor.tryEat('not')) {
    return { type: 'not', operand: parseUnary(cursor) }
  }
  return parseAtom(cursor)
}

function parseAtom(cursor: Cursor): Expr {
  if (cursor.tryEat('(')) {
    // Full parseExpr (not parseBinaryChain) here: the closing ")" already
    // disambiguates where the sub-expression ends, so a when/else mux
    // nested inside parens is unambiguous even though a bare when/else is
    // not allowed directly inside an if-condition or a mux's own sel.
    const expr = parseExpr(cursor)
    cursor.eat(')')
    return expr
  }
  if (cursor.peek()?.text === 'rising_edge') {
    cursor.next()
    cursor.eat('(')
    const signal = cursor.eatIdent()
    cursor.eat(')')
    return { type: 'risingEdge', signal }
  }
  return parseOperand(cursor)
}

function parseOperand(cursor: Cursor): Expr {
  const token = cursor.peek()
  if (token?.kind === 'bitlit') {
    cursor.next()
    return { type: 'bitlit', value: token.text as '0' | '1' }
  }
  return { type: 'ident', name: cursor.eatIdent() }
}
