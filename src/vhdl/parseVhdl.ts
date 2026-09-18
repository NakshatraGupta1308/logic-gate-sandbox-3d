import { tokenizeVhdl, VhdlSyntaxError, type Token } from './tokenizeVhdl'

export type CompareOp = '=' | '<=' | '>=' | '<' | '>'

export type Expr =
  | { type: 'ident'; name: string }
  | { type: 'bitlit'; value: '0' | '1' }
  | { type: 'strlit'; bits: string }
  | { type: 'indexed'; base: string; index: number }
  | { type: 'not'; operand: Expr }
  | { type: 'binop'; op: 'and' | 'or' | 'xor' | 'nand' | 'nor' | 'xnor'; left: Expr; right: Expr }
  | { type: 'mux'; a: Expr; b: Expr; sel: Expr }
  | { type: 'compare'; op: CompareOp; left: Expr; right: Expr }
  | { type: 'risingEdge'; signal: string }
  | { type: 'event'; signal: string }

/** A `std_logic_vector(high downto low)` or `(low to high)` range. */
export interface VectorRange {
  high: number
  low: number
  downto: boolean
}

export type VhdlType = { kind: 'bit' } | { kind: 'vector'; range: VectorRange }

export function widthOf(type: VhdlType): number {
  return type.kind === 'bit' ? 1 : type.range.high - type.range.low + 1
}

/**
 * The VHDL indices of a vector's bits in declaration order: for `downto`,
 * high to low (index 0 of the returned array is the leftmost/MSB bit as
 * written); for `to`, low to high. This is also the order a same-width
 * string literal's characters, or another vector's own bits, line up
 * against when driving this one.
 */
export function declOrderIndices(range: VectorRange): number[] {
  const indices: number[] = []
  if (range.downto) {
    for (let i = range.high; i >= range.low; i--) indices.push(i)
  } else {
    for (let i = range.low; i <= range.high; i++) indices.push(i)
  }
  return indices
}

export interface ParsedPort {
  name: string
  mode: 'in' | 'out'
  type: VhdlType
}

export interface ParsedSignal {
  name: string
  type: VhdlType
}

export interface ParsedAssignment {
  target: string
  targetIndex: number | null
  expr: Expr
  line: number
}

export interface AssignStatement {
  kind: 'assign'
  target: string
  targetIndex: number | null
  expr: Expr
}

export interface IfBranch {
  cond: Expr
  body: Statement[]
}

export interface IfStatement {
  kind: 'if'
  branches: IfBranch[]
  elseBody: Statement[] | null
}

/** A single sequential statement inside a process: a plain assignment, or a nested if (case is desugared into this same shape). */
export type Statement = AssignStatement | IfStatement

/** A `process(clk) if rising_edge(clk) then ... end if;` flip-flop, whose body may itself contain nested if/case statements (e.g. a synchronous reset). */
export interface ParsedDffProcess {
  kind: 'dff'
  clk: string
  body: Statement[]
  line: number
}

/**
 * A general combinational `process` written as an if/elsif/.../else or
 * case/when priority chain (the common style for combinational logic in
 * real VHDL). An explicit final `else` (or `when others`) is required:
 * without one, VHDL would infer a latch for any signal a shorter branch
 * leaves unset, which has no representation in this app's instant-
 * simulation model.
 */
export interface ParsedCombProcess {
  kind: 'comb'
  branches: IfBranch[]
  elseBody: Statement[]
  line: number
}

export type ParsedProcess = ParsedDffProcess | ParsedCombProcess

/** One `label => actual` (named) or bare `actual` (positional) connection in a `port map (...)`. */
export interface PortAssociation {
  formal: string | null
  actual: Expr
}

/** A `label: ComponentName port map (...);` structural instantiation. Which entity `componentName` refers to is resolved later, during flattening - a component declaration in the architecture header is only ever a re-statement of an interface this parser already gets from the instantiation syntax itself, so it is skipped rather than tracked. */
export interface ParsedInstantiation {
  label: string
  componentName: string
  associations: PortAssociation[]
  line: number
}

/** One parsed `entity ... is ... end; architecture ... is ... end;` pair. A file may contain several: one top-level design plus the sub-components it structurally instantiates (see ParsedInstantiation). */
export interface ParsedEntity {
  entityName: string
  ports: ParsedPort[]
  signals: ParsedSignal[]
  assignments: ParsedAssignment[]
  processes: ParsedProcess[]
  instantiations: ParsedInstantiation[]
}

/** The single flattened design flattenVhdl.ts reduces a file's ParsedEntity[] to: one top-level entity's ports, with every instantiated sub-component's signals/assignments/processes inlined (renamed to stay unique) directly into these lists. */
export interface ParsedVhdl {
  entityName: string
  ports: ParsedPort[]
  signals: ParsedSignal[]
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
  if (token.kind === 'bitlit') return `'${token.text}'`
  if (token.kind === 'strlit') return `"${token.text}"`
  return `"${token.text}"`
}

/**
 * Parses a file into one or more entity/architecture pairs (see
 * ParsedEntity) - normally just one, but a structural design instantiates
 * sub-components whose own entity/architecture must appear somewhere in
 * the same source, so a file may contain several. flattenVhdl.ts reduces
 * these to the single ParsedVhdl the rest of the app works with.
 *
 * Within each entity/architecture pair, the supported subset is:
 * `in`/`out` (and `inout`, silently treated as `out`, since this app's
 * simulator has no bidirectional-wire concept) ports and signals of type
 * `std_logic` or `std_logic_vector` (single identifiers or a comma-
 * separated list sharing one declaration), concurrent boolean assignments
 * (and/or/not/xor/nand/nor/xnor, comparisons, a when/else mux, indexed bit
 * references like `a(0)`, bit-string literals like "00"), a component
 * declaration (parsed and discarded - see ParsedInstantiation) and
 * `label: Name port map (...)` structural instantiation, a clocked
 * `process(clk) if rising_edge(clk) then ... end if;` (or the equivalent
 * `if (clk'event and clk = '1') then ... end if;` idiom) per flip-flop
 * region - whose body may itself contain nested if/case statements, e.g. a
 * synchronous reset - and a combinational `process` written as an
 * if/elsif/.../else or case/when priority chain (which must end in an
 * explicit `else`/`when others`, since an inferred latch has no
 * representation here). Deliberately does not attempt general VHDL
 * (generics, other port modes) - anything outside this shape raises a
 * VhdlSyntaxError naming the line rather than guessing.
 */
export function parseVhdl(source: string): ParsedEntity[] {
  const cursor = new Cursor(tokenizeVhdl(source))
  const entities: ParsedEntity[] = []
  while (!cursor.atEnd()) {
    while (cursor.peek()?.text === 'library' || cursor.peek()?.text === 'use') {
      skipStatement(cursor)
    }
    if (cursor.atEnd()) break
    entities.push(parseEntity(cursor))
  }
  if (entities.length === 0) throw new VhdlSyntaxError('No entity found in this file', 1)
  return entities
}

function parseEntity(cursor: Cursor): ParsedEntity {
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
        // "inout" is accepted but treated as "out": this app's simulator
        // has no bidirectional-wire concept, and a design that reads back
        // its own inout port (rather than just driving it, the common
        // case) would need one.
        if (modeToken.text !== 'in' && modeToken.text !== 'out' && modeToken.text !== 'inout') {
          throw new VhdlSyntaxError(
            `Port "${names[0]}" must be "in", "out", or "inout" (found ${describe(modeToken)})`,
            modeToken.line,
          )
        }
        const mode = modeToken.text === 'in' ? 'in' : 'out'
        const type = parseType(cursor, names[0])
        for (const name of names) ports.push({ name, mode, type })
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
      `architecture is "of ${archEntityName}" but the entity above is "${entityName}"; an architecture must immediately follow its own matching entity`,
      cursor.peek()?.line ?? 1,
    )
  }
  cursor.eat('is')

  const signals: ParsedSignal[] = []
  while (cursor.peek()?.text === 'signal' || cursor.peek()?.text === 'component') {
    if (cursor.tryEat('component')) {
      skipComponentDeclaration(cursor)
      continue
    }
    cursor.eat('signal')
    const names = parseIdentList(cursor)
    cursor.eat(':')
    const type = parseType(cursor, names[0])
    cursor.eat(';')
    for (const name of names) signals.push({ name, type })
  }

  cursor.eat('begin')

  const assignments: ParsedAssignment[] = []
  const processes: ParsedProcess[] = []
  const instantiations: ParsedInstantiation[] = []
  while (cursor.peek() && cursor.peek()?.text !== 'end') {
    if (cursor.peek()?.text === 'process') {
      processes.push(parseProcess(cursor))
    } else if (cursor.peek()?.kind === 'ident' && cursor.peek(1)?.text === ':') {
      instantiations.push(parseInstantiation(cursor))
    } else {
      const line = cursor.peek()?.line ?? 1
      const { target, targetIndex } = parseAssignmentTarget(cursor)
      cursor.eat('<=')
      const expr = parseExpr(cursor)
      cursor.eat(';')
      assignments.push({ target, targetIndex, expr, line })
    }
  }

  cursor.eat('end')
  cursor.tryEat('architecture')
  if (cursor.peek()?.text !== ';') cursor.eatIdent()
  cursor.eat(';')

  return { entityName, ports, signals, assignments, processes, instantiations }
}

/** A component declaration only re-states an interface the corresponding instantiation's own syntax already gives us, and its name is resolved against real entities later (see flattenVhdl.ts), so its body is skipped rather than parsed in detail. */
function skipComponentDeclaration(cursor: Cursor) {
  cursor.eatIdent() // component name
  cursor.tryEat('is')
  while (!(cursor.peek()?.text === 'end' && cursor.peek(1)?.text === 'component')) {
    if (cursor.atEnd()) throw new VhdlSyntaxError('Unexpected end of file inside a component declaration', cursor.peek()?.line ?? 1)
    cursor.next()
  }
  cursor.eat('end')
  cursor.eat('component')
  if (cursor.peek()?.text !== ';') cursor.eatIdent()
  cursor.eat(';')
}

/** `label: ComponentName port map ( [formal =>] actual, ... );` - a structural instantiation of a sub-component. */
function parseInstantiation(cursor: Cursor): ParsedInstantiation {
  const line = cursor.peek()?.line ?? 1
  const label = cursor.eatIdent()
  cursor.eat(':')
  const componentName = cursor.eatIdent()
  cursor.eat('port')
  cursor.eat('map')
  cursor.eat('(')
  const associations: PortAssociation[] = []
  if (cursor.peek()?.text !== ')') {
    do {
      if (cursor.peek()?.kind === 'ident' && cursor.peek(1)?.text === '=>') {
        const formal = cursor.eatIdent()
        cursor.eat('=>')
        associations.push({ formal, actual: parseExpr(cursor) })
      } else {
        associations.push({ formal: null, actual: parseExpr(cursor) })
      }
    } while (cursor.tryEat(','))
  }
  cursor.eat(')')
  cursor.eat(';')
  return { label, componentName, associations, line }
}

/** One or more comma-separated identifiers sharing a single declaration. */
function parseIdentList(cursor: Cursor): string[] {
  const names = [cursor.eatIdent()]
  while (cursor.tryEat(',')) names.push(cursor.eatIdent())
  return names
}

function parseIntLiteral(cursor: Cursor): number {
  const token = cursor.peek()
  if (!token || token.kind !== 'number') {
    throw new VhdlSyntaxError(`Expected an integer but found ${describe(token)}`, cursor.peek()?.line ?? 1)
  }
  cursor.next()
  return Number(token.text)
}

function parseType(cursor: Cursor, ownerName: string): VhdlType {
  const typeToken = cursor.next()
  if (typeToken.text === 'std_logic') return { kind: 'bit' }
  if (typeToken.text === 'std_logic_vector') {
    cursor.eat('(')
    const first = parseIntLiteral(cursor)
    let downto: boolean
    if (cursor.tryEat('downto')) downto = true
    else {
      cursor.eat('to')
      downto = false
    }
    const second = parseIntLiteral(cursor)
    cursor.eat(')')
    const range: VectorRange = downto ? { high: first, low: second, downto } : { high: second, low: first, downto }
    if (range.high < range.low) {
      throw new VhdlSyntaxError(`"${ownerName}" has an invalid range (${first} ${downto ? 'downto' : 'to'} ${second})`, typeToken.line)
    }
    return { kind: 'vector', range }
  }
  throw new VhdlSyntaxError(
    `"${ownerName}" has type "${typeToken.text}", but only std_logic and std_logic_vector are supported`,
    typeToken.line,
  )
}

function parseProcess(cursor: Cursor): ParsedProcess {
  const line = cursor.peek()?.line ?? 1
  cursor.eat('process')
  cursor.eat('(')
  parseIdentList(cursor) // sensitivity list; not needed downstream, every reference resolves on its own
  cursor.eat(')')
  cursor.eat('begin')
  const { branches, elseBody } = parseTopStatement(cursor)
  cursor.eat('end')
  cursor.eat('process')
  cursor.eat(';')

  const [onlyBranch] = branches
  const clockSignal = branches.length === 1 && elseBody === null ? extractClockSignal(onlyBranch.cond) : null
  if (clockSignal) {
    return { kind: 'dff', clk: clockSignal, body: onlyBranch.body, line }
  }

  if (elseBody === null) {
    throw new VhdlSyntaxError(
      'A process must end with an "else" (or "when others") branch (a signal left unset in some branch would need an inferred latch, which is not supported), unless it is a flip-flop\'s single "if rising_edge(clk) then ... end if;"',
      line,
    )
  }
  return { kind: 'comb', branches, elseBody, line }
}

/** Recognizes `rising_edge(clk)`, or the equivalent `clk'event and clk = '1'` idiom (either operand order), as the clock this branch triggers on. */
function extractClockSignal(cond: Expr): string | null {
  if (cond.type === 'risingEdge') return cond.signal
  if (cond.type === 'binop' && cond.op === 'and') {
    return matchEventAndHigh(cond.left, cond.right) ?? matchEventAndHigh(cond.right, cond.left)
  }
  return null
}

function matchEventAndHigh(eventSide: Expr, compareSide: Expr): string | null {
  if (eventSide.type !== 'event') return null
  if (
    compareSide.type === 'compare' &&
    compareSide.op === '=' &&
    compareSide.left.type === 'ident' &&
    compareSide.left.name === eventSide.signal &&
    compareSide.right.type === 'bitlit' &&
    compareSide.right.value === '1'
  ) {
    return eventSide.signal
  }
  return null
}

interface ParsedIfStatement {
  branches: IfBranch[]
  elseBody: Statement[] | null
}

/** Dispatches to whichever of `if`/`case` starts a process's (or an if-branch's) top-level statement. */
function parseTopStatement(cursor: Cursor): ParsedIfStatement {
  if (cursor.peek()?.text === 'case') return parseCaseStatement(cursor)
  return parseIfStatement(cursor)
}

function parseIfStatement(cursor: Cursor): ParsedIfStatement {
  cursor.eat('if')
  const branches: IfBranch[] = [parseIfBranch(cursor)]
  while (cursor.tryEat('elsif')) {
    branches.push(parseIfBranch(cursor))
  }
  const elseBody = cursor.tryEat('else') ? parseStatements(cursor) : null
  cursor.eat('end')
  cursor.eat('if')
  cursor.eat(';')
  return { branches, elseBody }
}

function parseIfBranch(cursor: Cursor): IfBranch {
  const cond = parseBinaryChain(cursor)
  cursor.eat('then')
  const body = parseStatements(cursor)
  return { cond, body }
}

/** `case <expr> is (when <choice> => <statements>)+ end case;`, desugared into the same branches/elseBody shape as an if/elsif/else: each `when` becomes `selector = choice`, and `when others` becomes the else. */
function parseCaseStatement(cursor: Cursor): ParsedIfStatement {
  cursor.eat('case')
  const selector = parseBinaryChain(cursor)
  cursor.eat('is')

  const branches: IfBranch[] = []
  let elseBody: Statement[] | null = null
  while (cursor.tryEat('when')) {
    if (cursor.tryEat('others')) {
      cursor.eat('=>')
      elseBody = parseStatements(cursor)
      break
    }
    const choice = parseOperand(cursor)
    cursor.eat('=>')
    const body = parseStatements(cursor)
    branches.push({ cond: { type: 'compare', op: '=', left: selector, right: choice }, body })
  }
  cursor.eat('end')
  cursor.eat('case')
  cursor.eat(';')
  return { branches, elseBody }
}

function parseStatements(cursor: Cursor): Statement[] {
  const statements: Statement[] = []
  while (cursor.peek()?.kind === 'ident' && !isBranchKeyword(cursor.peek()!.text)) {
    if (cursor.peek()?.text === 'if' || cursor.peek()?.text === 'case') {
      const { branches, elseBody } = parseTopStatement(cursor)
      statements.push({ kind: 'if', branches, elseBody })
    } else {
      const { target, targetIndex } = parseAssignmentTarget(cursor)
      cursor.eat('<=')
      const expr = parseExpr(cursor)
      cursor.eat(';')
      statements.push({ kind: 'assign', target, targetIndex, expr })
    }
  }
  if (statements.length === 0) {
    throw new VhdlSyntaxError('Expected at least one statement here', cursor.peek()?.line ?? 1)
  }
  return statements
}

/** An assignment's left-hand side: a plain signal name, or one indexed bit of a vector (`y(0)`). */
function parseAssignmentTarget(cursor: Cursor): { target: string; targetIndex: number | null } {
  const target = cursor.eatIdent()
  if (cursor.tryEat('(')) {
    const targetIndex = parseIntLiteral(cursor)
    cursor.eat(')')
    return { target, targetIndex }
  }
  return { target, targetIndex: null }
}

function isBranchKeyword(text: string): boolean {
  return text === 'elsif' || text === 'else' || text === 'end' || text === 'when'
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
  if (token?.kind === 'strlit') {
    cursor.next()
    return { type: 'strlit', bits: token.text }
  }
  const name = cursor.eatIdent()
  if (cursor.tryEat("'")) {
    cursor.eat('event')
    return { type: 'event', signal: name }
  }
  if (cursor.tryEat('(')) {
    const index = parseIntLiteral(cursor)
    cursor.eat(')')
    return { type: 'indexed', base: name, index }
  }
  return { type: 'ident', name }
}
