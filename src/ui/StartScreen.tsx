import { GATE_BODY_COLOR, GATE_SYMBOL } from '../scene/gateVisuals'
import type { GateKind } from '../engine'

const PREVIEW_KINDS: GateKind[] = ['AND', 'OR', 'NOT', 'XOR', 'NAND', 'NOR', 'XNOR']

interface ShortcutRow {
  action: string
  windows: string
  mac: string
}

const SHORTCUTS: ShortcutRow[] = [
  { action: 'Copy selected gate', windows: 'Ctrl + C', mac: '⌘ + C' },
  { action: 'Cut selected gate/wire', windows: 'Ctrl + X', mac: '⌘ + X' },
  { action: 'Paste gate', windows: 'Ctrl + V', mac: '⌘ + V' },
  { action: 'Delete gate/wire', windows: 'Delete or Backspace', mac: 'Delete or Backspace' },
  { action: 'Cancel wire drag', windows: 'Esc', mac: 'Esc' },
]

const GRID_BACKGROUND = {
  backgroundColor: '#ffffff',
  backgroundImage: `
    linear-gradient(#9aa3b0 1.5px, transparent 1.5px),
    linear-gradient(90deg, #9aa3b0 1.5px, transparent 1.5px),
    linear-gradient(#d7dce3 1px, transparent 1px),
    linear-gradient(90deg, #d7dce3 1px, transparent 1px)
  `,
  backgroundSize: '100px 100px, 100px 100px, 20px 20px, 20px 20px',
}

interface StartScreenProps {
  onStart: () => void
}

export function StartScreen({ onStart }: StartScreenProps) {
  return (
    <div
      style={GRID_BACKGROUND}
      className="flex h-screen w-screen items-center justify-center overflow-y-auto p-6"
    >
      <div className="flex w-full max-w-2xl flex-col gap-5">
        <div className="comic-card p-6 text-center text-black sm:p-8">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            Logic Gate Sandbox 3D
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm font-medium text-neutral-600">
            Place logic gates on a 3D workbench, wire them together, and watch signals travel
            down the wires in real time.
          </p>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {PREVIEW_KINDS.map((kind) => (
              <div
                key={kind}
                className="flex h-12 w-12 items-center justify-center rounded-lg border-[3px] border-black text-xl font-extrabold text-white shadow-[3px_3px_0_#000]"
                style={{ backgroundColor: GATE_BODY_COLOR[kind] }}
              >
                {GATE_SYMBOL[kind]}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={onStart}
            className="comic-btn mt-6 px-8 py-3 text-lg font-extrabold"
          >
            Build
          </button>
        </div>

        <div className="comic-card p-5 text-black sm:p-6">
          <h2 className="text-base font-extrabold">Keyboard shortcuts</h2>
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-2 border-black bg-neutral-100 px-2 py-1 text-left">
                  Action
                </th>
                <th className="border-2 border-black bg-neutral-100 px-2 py-1 text-left">
                  Windows / Linux
                </th>
                <th className="border-2 border-black bg-neutral-100 px-2 py-1 text-left">Mac</th>
              </tr>
            </thead>
            <tbody>
              {SHORTCUTS.map((row) => (
                <tr key={row.action}>
                  <td className="border-2 border-black px-2 py-1 font-medium">{row.action}</td>
                  <td className="border-2 border-black px-2 py-1 font-mono text-xs">
                    {row.windows}
                  </td>
                  <td className="border-2 border-black px-2 py-1 font-mono text-xs">{row.mac}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs font-medium text-neutral-600">
            Mouse: click a gate in the toolbar then click the workbench to place it. Drag from an
            output pin to an input pin to wire them. Click an INPUT gate to toggle it. Orbit, zoom,
            and pan the camera freely with the mouse.
          </p>
        </div>
      </div>
    </div>
  )
}
