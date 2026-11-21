import type { Part } from '../../shared/types'

/** Every fastener type with its count and spec (e.g. 4× M2 × 6 mm Phillips pan head). */
export default function HardwareTable({ fasteners }: { fasteners: Part[] }) {
  return (
    <table className="hardware-table">
      <tbody>
        {fasteners.map((f) => (
          <tr key={f.id}>
            <td className="qty">{f.quantity ?? 1}×</td>
            <td>
              {f.name}
              {f.spec && <small>{f.spec}</small>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
