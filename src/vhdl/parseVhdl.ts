import { tokenizeVhdl, VhdlSyntaxError, type Token } from './tokenizeVhdl'

export type Expr =
  | { type: 'ident'; name: string }
  | { type: 'bitlit'; value: '0' | '1' }
  | { type: 'not'; operand: Expr }
  | { type: 'binop'; op: 'and' | 'or' | 'xor' | 'nand' | 'nor' | 'xnor'; left: Expr; right: Expr }
  | { type: 'mux'; a: Expr; b: Expr; sel: Expr }

export interface ParsedPort {
  name: string
  mode: 'in' | 'out'
}

export interface ParsedAssignment {
  target: string
  expr: Expr
  line: number
}

export interface ParsedProcess {
  clk: Expr
  qTarget: string
  dExpr: Expr
  line: number
}

export interface ParsedVhdl {
  entityName: string
  ports: ParsedPort[]
  signals: string[]
  assignments: ParsedAssignment[]
  processes: ParsedProcess[]
}

const BINOPS = new Set(['and', 'or', 'xor', 'nand', 'nor', 'xnor'])

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
 * Parses the fixed dataflow VHDL subset exportVhdl.ts writes: a single
 * entity/architecture pair, `in`/`out` std_logic ports, std_logic signal
 * declarations, concurrent boolean assignments (and/or/not/xor/nand/nor/
 * xnor, a when/else mux, or a plain passthrough), and a clocked
 * `process(clk) if rising_edge(clk) then q <= d; end if; end process;`
 * block per flip-flop. Deliberately does not attempt general VHDL
 * (generics, other types, sequential statements beyond that one clocked
 * pattern, multiple entities) - anything outside this shape raises a
 * VhdlSyntaxError with a line number rather than guessing.
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
        const name = cursor.eatIdent()
        cursor.eat(':')
        const modeToken = cursor.next()
        if (modeToken.text !== 'in' && modeToken.text !== 'out') {
          throw new VhdlSyntaxError(
            `Port "${name}" must be "in" or "out" (found ${describe(modeToken)}); other modes like inout are not supported`,
            modeToken.line,
          )
        }
        expectType(cursor, name)
        ports.push({ name, mode: modeToken.text })
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
    const name = cursor.eatIdent()
    cursor.eat(':')
    expectType(cursor, name)
    cursor.eat(';')
    signals.push(name)
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
  const clk = parseExpr(cursor)
  cursor.eat(')')
  cursor.eat('begin')
  cursor.eat('if')
  cursor.eat('rising_edge')
  cursor.eat('(')
  const clkInCondition = parseExpr(cursor)
  cursor.eat(')')
  cursor.eat('then')
  const qTarget = cursor.eatIdent()
  cursor.eat('<=')
  const dExpr = parseExpr(cursor)
  cursor.eat(';')
  cursor.eat('end')
  cursor.eat('if')
  cursor.eat(';')
  cursor.eat('end')
  cursor.eat('process')
  cursor.eat(';')
  void clkInCondition // only the sensitivity-list clock is used; both must name the same clock in well-formed input
  return { clk, qTarget, dExpr, line }
}

/** Skips a `library ...;` / `use ...;` clause without interpreting it. */
function skipStatement(cursor: Cursor) {
  while (!cursor.atEnd() && cursor.peek()?.text !== ';') cursor.next()
  cursor.eat(';')
}

function parseExpr(cursor: Cursor): Expr {
  const left = parseBinaryChain(cursor)
  if (!cursor.tryEat('when')) return left

  const condLeft = parseOperand(cursor)
  cursor.eat('=')
  const condRight = parseOperand(cursor)
  cursor.eat('else')
  const elseExpr = parseExpr(cursor)

  const { signal, matchesHigh } = resolveCondition(condLeft, condRight, cursor)
  // exportVhdl always writes "<b> when <sel> = '1' else <a>"; a hand-written
  // "= '0'" flips which branch fires on a high select, so the mapping to
  // MUX2's (a, b, sel) pins is swapped to compensate.
  return matchesHigh
    ? { type: 'mux', a: elseExpr, b: left, sel: signal }
    : { type: 'mux', a: left, b: elseExpr, sel: signal }
}

function resolveCondition(left: Expr, right: Expr, cursor: Cursor): { signal: Expr; matchesHigh: boolean } {
  const bit = left.type === 'bitlit' ? left : right.type === 'bitlit' ? right : undefined
  const other = left.type === 'bitlit' ? right : left
  if (!bit || other.type === 'bitlit') {
    throw new VhdlSyntaxError(
      'A "when" condition must compare a signal to a bit literal, e.g. sel = \'1\'',
      cursor.peek()?.line ?? 1,
    )
  }
  return { signal: other, matchesHigh: bit.value === '1' }
}

function parseBinaryChain(cursor: Cursor): Expr {
  let left = parseUnary(cursor)
  while (cursor.peek()?.kind === 'ident' && BINOPS.has(cursor.peek()!.text)) {
    const op = cursor.next().text as 'and' | 'or' | 'xor' | 'nand' | 'nor' | 'xnor'
    const right = parseUnary(cursor)
    left = { type: 'binop', op, left, right }
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
    const expr = parseExpr(cursor)
    cursor.eat(')')
    return expr
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
