import { useShopStore } from '@/store/useShopStore';
import type { AggRow } from '@/domain/engine';
import { fmtMoney } from '@/lib/format';

function AggTable({ title, rows }: { title: string; rows: AggRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[#8d6e4a] bg-[#fffdf5] shadow-sm">
      <h3 className="border-b border-[#e3d5b8] bg-[#faf3e0] px-4 py-2 font-serif font-bold text-[#5d4037]">
        {title}
      </h3>
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="bg-[#5d4037] text-[#f5e6c8]">
            {['项目', '净销量', '营收', '成本', '利润'].map((h) => (
              <th key={h} className="px-3 py-2 text-left font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-[#e3d5b8] hover:bg-[#faf3e0]">
              <td className="px-3 py-2 font-serif font-bold text-[#3e2723]">{row.key}</td>
              <td className="px-3 py-2">{row.qty}</td>
              <td className="px-3 py-2">{fmtMoney(row.revenue)}</td>
              <td className="px-3 py-2">{fmtMoney(row.cost)}</td>
              <td
                className={`px-3 py-2 font-bold ${
                  row.profit >= 0 ? 'text-[#3e6b3e]' : 'text-[#db5a6b]'
                }`}
              >
                {fmtMoney(row.profit)}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-[#8d6e4a]">
                暂无数据
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function SummaryPanel() {
  const result = useShopStore((s) => s.result);
  const { totals } = result;

  const cards = [
    { label: '总营收', value: totals.revenue, cls: 'text-[#3e6b3e]' },
    { label: '总成本', value: totals.cost, cls: 'text-[#6d5a40]' },
    { label: '总利润', value: totals.profit, cls: totals.profit >= 0 ? 'text-[#3e6b3e]' : 'text-[#db5a6b]' },
    { label: '净销量', value: totals.qty, cls: 'text-[#3e2723]', unit: '本' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-lg border border-[#8d6e4a] bg-[#fffdf5] p-4 text-center shadow-sm"
          >
            <div className="text-xs text-[#8d6e4a]">{c.label}</div>
            <div className={`mt-1 font-serif text-xl font-bold ${c.cls}`}>
              {c.unit ? `${c.value} ${c.unit}` : fmtMoney(c.value)}
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <AggTable title="按类别汇总（经史子集）" rows={result.byCategory} />
        <AggTable title="按渠道汇总" rows={result.byChannel} />
      </div>
      <AggTable title="按陈列位汇总（含库中与待裁决）" rows={result.bySlot} />
      <p className="text-xs text-[#8d6e4a]">
        营收按每笔成交价累计；退货以负数量冲减营收与利润；归属待裁决的流水单列，不计入任何陈列位。
      </p>
    </div>
  );
}
