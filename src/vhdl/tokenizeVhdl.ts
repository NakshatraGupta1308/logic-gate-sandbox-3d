export interface Token {
  /** Lowercased text for identifiers/punctuation, the literal bit for BITLIT, the digits for NUMBER, or the bit string for STRLIT. */
  text: string
  kind: 'ident' | 'bitlit' | 'number' | 'strlit' | 'punct'
  line: number
}

const PUNCT_PATTERN = /<=|>=|=>|[():;,=.<>']/y
const IDENT_PATTERN = /[A-Za-z][A-Za-z0-9_]*/y
const BITLIT_PATTERN = /'([01])'/y
const NUMBER_PATTERN = /[0-9]+/y
const STRLIT_PATTERN = /"([01]*)"/y

/**
 * Splits VHDL source into a flat token stream: identifiers (lowercased,
 * since VHDL is case-insensitive), quoted '0'/'1' bit literals, bare
 * integers (used in vector range bounds like `(3 downto 0)`), double-quoted
 * bit strings (multi-bit literals like "00"), and the small set of
 * punctuation this dialect subset actually uses (including a lone `'` for
 * an attribute like `clk'event`, and `=>` for a case choice). Comments
 * (`-- ...` to end of line) and whitespace are dropped entirely.
 */
export function tokenizeVhdl(source: string): Token[] {
  const tokens: Token[] = []
  let line = 1

  for (let i = 0; i < source.length; ) {
    const ch = source[i]

    if (ch === '\n') {
      line++
      i++
      continue
    }
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (ch === '-' && source[i + 1] === '-') {
      while (i < source.length && source[i] !== '\n') i++
      continue
    }

    BITLIT_PATTERN.lastIndex = i
    const bitMatch = BITLIT_PATTERN.exec(source)
    if (bitMatch && bitMatch.index === i) {
      tokens.push({ text: bitMatch[1], kind: 'bitlit', line })
      i += bitMatch[0].length
      continue
    }

    STRLIT_PATTERN.lastIndex = i
    const strMatch = STRLIT_PATTERN.exec(source)
    if (strMatch && strMatch.index === i) {
      tokens.push({ text: strMatch[1], kind: 'strlit', line })
      i += strMatch[0].length
      continue
    }

    IDENT_PATTERN.lastIndex = i
    const identMatch = IDENT_PATTERN.exec(source)
    if (identMatch && identMatch.index === i) {
      tokens.push({ text: identMatch[0].toLowerCase(), kind: 'ident', line })
      i += identMatch[0].length
      continue
    }

    NUMBER_PATTERN.lastIndex = i
    const numberMatch = NUMBER_PATTERN.exec(source)
    if (numberMatch && numberMatch.index === i) {
      tokens.push({ text: numberMatch[0], kind: 'number', line })
      i += numberMatch[0].length
      continue
    }

    PUNCT_PATTERN.lastIndex = i
    const punctMatch = PUNCT_PATTERN.exec(source)
    if (punctMatch && punctMatch.index === i) {
      tokens.push({ text: punctMatch[0], kind: 'punct', line })
      i += punctMatch[0].length
      continue
    }

    throw new VhdlSyntaxError(`Unexpected character "${ch}"`, line)
  }

  return tokens
}

export class VhdlSyntaxError extends Error {
  line: number
  constructor(message: string, line: number) {
    super(`Line ${line}: ${message}`)
    this.line = line
  }
}
