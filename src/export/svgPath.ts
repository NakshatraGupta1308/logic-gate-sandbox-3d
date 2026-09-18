import type { PathCommand } from './gateOutline'

/** Renders shared gate-outline path commands as an SVG path "d" attribute. */
export function pathCommandsToSvg(commands: PathCommand[]): string {
  return commands
    .map((cmd) => {
      switch (cmd.op) {
        case 'M':
          return `M ${cmd.x} ${cmd.y}`
        case 'L':
          return `L ${cmd.x} ${cmd.y}`
        case 'C':
          return `C ${cmd.x1} ${cmd.y1} ${cmd.x2} ${cmd.y2} ${cmd.x} ${cmd.y}`
        case 'Z':
          return 'Z'
      }
    })
    .join(' ')
}
