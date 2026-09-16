import type { Gate } from '../engine'
import { getGateDef } from '../engine'
import { GATE_DESCRIPTION, GATE_SYMBOL, getTruthTable } from './gateVisuals'

interface GateTooltipProps {
  gate: Gate
}

export function GateTooltip({ gate }: GateTooltipProps) {
  const def = getGateDef(gate.kind)
  const truthTable = getTruthTable(gate.kind)

  return (
    <div className="w-56 select-none rounded-xl border-[3px] border-black bg-white p-3 text-black shadow-[4px_4px_0_#000]">
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-extrabold leading-none">{GATE_SYMBOL[gate.kind]}</span>
        <span className="text-sm font-extrabold">{def.label}</span>
      </div>
      <p className="mt-1 text-xs leading-snug text-neutral-700">{GATE_DESCRIPTION[gate.kind]}</p>

      {truthTable && (
        <table className="mt-2 w-full border-collapse text-[11px]">
          <thead>
            <tr>
              {truthTable[0].inputs.map((_, i) => (
                <th key={i} className="border border-black bg-neutral-100 px-1.5 py-0.5">
                  in{i}
                </th>
              ))}
              <th className="border border-black bg-neutral-100 px-1.5 py-0.5">out</th>
            </tr>
          </thead>
          <tbody>
            {truthTable.map((row, i) => (
              <tr key={i}>
                {row.inputs.map((v, j) => (
                  <td key={j} className="border border-black px-1.5 py-0.5 text-center">
                    {v ? 1 : 0}
                  </td>
                ))}
                <td className="border border-black px-1.5 py-0.5 text-center font-bold">
                  {row.output ? 1 : 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 border-t-2 border-black pt-1.5 text-[11px] font-semibold">
        {gate.inputValues.map((v, i) => (
          <span key={`in-${i}`}>
            in{i}: {v ? 1 : 0}
          </span>
        ))}
        {gate.outputValues.map((v, i) => (
          <span key={`out-${i}`}>
            out{i}: {v ? 1 : 0}
          </span>
        ))}
      </div>
    </div>
  )
}
