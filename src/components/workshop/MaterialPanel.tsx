/** 材料面板：展示材料清单与实时余量，提供领用/退回入口 */
import { useWorkshopStore } from '@/stores/workshopStore';

export default function MaterialPanel({ bookId }: { bookId: string }) {
  const snapshot = useWorkshopStore((s) => s.snapshot);
  const submitOp = useWorkshopStore((s) => s.submitOp);
  const materials = snapshot?.materials ?? [];

  return (
    <section className="rounded-lg border border-[#c9a96e]/40 bg-[#f5f0e8] p-4 shadow">
      <header className="mb-3">
        <h2 className="text-lg font-bold text-[#3a3a3a]">材料清单</h2>
        <p className="text-xs text-[#8b5a2b]">余量由统一账册派生，工序切换不影响</p>
      </header>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#c9a96e]/40 text-left text-xs text-[#8b5a2b]">
            <th className="py-1">材料</th>
            <th>已领</th>
            <th>已退</th>
            <th>余量</th>
            <th className="text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          {materials.map((m) => (
            <tr key={m.materialId} className="border-b border-[#c9a96e]/20">
              <td className="py-1 text-[#3a3a3a]">{m.name}</td>
              <td>{m.requisitioned}</td>
              <td>{m.returned}</td>
              <td className="font-bold text-[#7b241c]">
                {m.balance}
                <span className="ml-1 text-xs font-normal text-[#3a3a3a]/60">{m.unit}</span>
              </td>
              <td className="py-1 text-right">
                <button
                  className="mr-1 rounded bg-[#8b5a2b] px-2 py-0.5 text-xs text-white transition hover:bg-[#c9a96e] disabled:opacity-40"
                  disabled={m.balance <= 0}
                  onClick={() => void submitOp({ kind: 'requisition_material', bookId, materialId: m.materialId, quantity: 1 })}
                >
                  领用
                </button>
                <button
                  className="rounded border border-[#8b5a2b] px-2 py-0.5 text-xs text-[#8b5a2b] transition hover:bg-[#c9a96e]/30"
                  onClick={() => void submitOp({ kind: 'return_material', bookId, materialId: m.materialId, quantity: 1 })}
                >
                  退回
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
