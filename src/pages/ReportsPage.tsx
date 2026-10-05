import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useStore } from "@/store/useStore";
import { CATEGORIES, CHANNELS } from "@/engine/types";
import { fmtTime } from "@/engine/compute";
import { Card, Td, Th, fmtWen } from "@/components/ui";

const CATEGORY_COLORS: Record<string, string> = {
  经: "#51a8b8",
  史: "#db5a6b",
  子: "#c8a951",
  集: "#6b8e23",
};

export default function ReportsPage() {
  const { ds, result } = useStore();

  const totals = useMemo(() => {
    let revenue = 0, cost = 0, profit = 0, qty = 0;
    for (const s of Object.values(result.bookStats)) {
      revenue += s.revenue;
      cost += s.cost;
      profit += s.profit;
      qty += s.soldQty;
    }
    return { revenue, cost, profit, qty };
  }, [result.bookStats]);

  const byCategory = useMemo(
    () =>
      CATEGORIES.map((c) => {
        let revenue = 0, profit = 0, qty = 0;
        for (const b of ds.books) {
          if (b.category !== c) continue;
          const s = result.bookStats[b.id];
          if (!s) continue;
          revenue += s.revenue;
          profit += s.profit;
          qty += s.soldQty;
        }
        return { category: c, revenue, profit, qty };
      }),
    [ds.books, result.bookStats]
  );

  const byChannel = useMemo(
    () =>
      CHANNELS.map((c) => {
        let revenue = 0, qty = 0;
        for (const row of result.saleRows) {
          if (row.channel !== c) continue;
          revenue += row.amount;
          qty += row.qty;
        }
        return { channel: c, revenue, qty };
      }),
    [result.saleRows]
  );

  const periods = useMemo(
    () => Array.from(new Set(result.saleRows.map((r) => r.period))).sort(),
    [result.saleRows]
  );

  const slotNameOf = (id: string) => ds.slots.find((s) => s.id === id)?.name ?? id;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "总营收", value: fmtWen(totals.revenue) },
          { label: "总成本", value: fmtWen(totals.cost) },
          { label: "总利润", value: fmtWen(totals.profit) },
          { label: "净销量", value: `${totals.qty} 件` },
        ].map((c) => (
          <div key={c.label} className="rounded-md border border-[#d8c49a] bg-[#fdf6e3] p-3 text-center shadow-sm">
            <div className="text-xs text-[#9c8a68]">{c.label}</div>
            <div className="mt-1 text-lg font-semibold text-[#5d4037]">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="按类别汇总（营收 / 利润）">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>类别</Th>
                <Th className="text-right">净销量</Th>
                <Th className="text-right">营收</Th>
                <Th className="text-right">利润</Th>
              </tr>
            </thead>
            <tbody>
              {byCategory.map((r) => (
                <tr key={r.category}>
                  <Td>
                    <span
                      className="mr-1 inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: CATEGORY_COLORS[r.category] }}
                    />
                    {r.category}部
                  </Td>
                  <Td className="text-right">{r.qty}</Td>
                  <Td className="text-right">{fmtWen(r.revenue)}</Td>
                  <Td className="text-right">{fmtWen(r.profit)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 h-48">
            <ResponsiveContainer>
              <BarChart data={byCategory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0cfa5" />
                <XAxis dataKey="category" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v: number) => fmtWen(v)} />
                <Legend />
                <Bar dataKey="revenue" name="营收" fill="#51a8b8" />
                <Bar dataKey="profit" name="利润" fill="#db5a6b" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="按渠道汇总（营收按成交价）">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>渠道</Th>
                <Th className="text-right">净销量</Th>
                <Th className="text-right">营收</Th>
              </tr>
            </thead>
            <tbody>
              {byChannel.map((r) => (
                <tr key={r.channel}>
                  <Td>{r.channel}</Td>
                  <Td className="text-right">{r.qty}</Td>
                  <Td className="text-right">{fmtWen(r.revenue)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 h-48">
            <ResponsiveContainer>
              <BarChart data={byChannel}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0cfa5" />
                <XAxis dataKey="channel" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v: number) => fmtWen(v)} />
                <Bar dataKey="revenue" name="营收" fill="#c8a951" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card title="陈列位 × 时段 营收（换位与裁决后自动重算）">
        {periods.length === 0 ? (
          <p className="text-sm text-[#9c8a68]">尚无已归属的销售。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>陈列位</Th>
                  {periods.map((p) => (
                    <Th key={p} className="text-right">{p}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ds.slots.map((s) => (
                  <tr key={s.id}>
                    <Td className="font-medium">{s.name}</Td>
                    {periods.map((p) => {
                      const cell = result.periodCells[`${s.id}|${p}`];
                      return (
                        <Td key={p} className="text-right">
                          {cell ? `${fmtWen(cell.revenue)}（${cell.qty}件）` : "—"}
                        </Td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={`异常与预警（${result.anomalies.length} 条）`}>
        {result.anomalies.length === 0 ? (
          <p className="text-sm text-[#6b8e23]">账目清讫，未见异常。</p>
        ) : (
          <ul className="space-y-1.5">
            {result.anomalies.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-[#3e2f23]">
                <span className="mt-0.5 rounded bg-[#d32f2f] px-1.5 py-0.5 text-xs text-white">
                  {a.type === "oversell"
                    ? "超卖"
                    : a.type === "return_without_stock"
                      ? "无货退货"
                      : a.type === "ambiguous_attribution"
                        ? "待裁决"
                        : a.type === "slot_conflict"
                          ? "同位冲突"
                          : "未上柜"}
                </span>
                <span>{a.message}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="售罄时点">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <Th>书籍</Th>
              <Th>售罄时点</Th>
              <Th className="text-right">当前库存</Th>
            </tr>
          </thead>
          <tbody>
            {ds.books.map((b) => {
              const s = result.bookStats[b.id];
              return (
                <tr key={b.id}>
                  <Td>《{b.title}》</Td>
                  <Td>{s?.soldOutAt ? fmtTime(s.soldOutAt) : "未售罄"}</Td>
                  <Td className="text-right">{s?.stock ?? b.initialStock}</Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
