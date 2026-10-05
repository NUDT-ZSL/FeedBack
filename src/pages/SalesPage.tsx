import { useState } from "react";
import { useStore } from "@/store/useStore";
import { CHANNELS, type Channel } from "@/engine/types";
import { fmtTime } from "@/engine/compute";
import { btnCls, btnDangerCls, Card, inputCls, Td, Th, toLocalInput, fromLocalInput, fmtWen } from "@/components/ui";

const ANOMALY_LABEL: Record<string, string> = {
  oversell: "超卖",
  return_without_stock: "无货退货",
  ambiguous_attribution: "归属待裁决",
  slot_conflict: "同位冲突",
  unattributed: "未上柜",
};

export default function SalesPage() {
  const { ds, result, addSale, removeSale, resolve } = useStore();
  const [bookId, setBookId] = useState(ds.books[0]?.id ?? "");
  const [at, setAt] = useState(toLocalInput(new Date().toISOString()));
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(ds.books[0]?.listPrice ?? 0);
  const [channel, setChannel] = useState<Channel>("店内零售");

  const bookTitle = (id: string) => ds.books.find((b) => b.id === id)?.title ?? "（书籍已删除）";
  const slotNameOf = (id: string | null) =>
    id === null ? "—" : ds.slots.find((s) => s.id === id)?.name ?? id;

  const pending = result.saleRows.filter((r) => !r.resolved);

  return (
    <div className="space-y-4">
      <Card title="录入销售流水（数量为负即退货，营收按成交价计算）">
        {ds.books.length === 0 ? (
          <p className="text-sm text-[#9c8a68]">请先在「书籍」页录入书籍。</p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-[#7a5c3e]">
              时刻
              <input
                type="datetime-local"
                className={`${inputCls} ml-1`}
                value={at}
                onChange={(e) => setAt(e.target.value)}
              />
            </label>
            <label className="text-xs text-[#7a5c3e]">
              书籍
              <select
                className={`${inputCls} ml-1`}
                value={bookId}
                onChange={(e) => {
                  setBookId(e.target.value);
                  const b = ds.books.find((x) => x.id === e.target.value);
                  if (b) setPrice(b.listPrice);
                }}
              >
                {ds.books.map((b) => (
                  <option key={b.id} value={b.id}>{b.title}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-[#7a5c3e]">
              数量
              <input
                type="number"
                className={`${inputCls} ml-1 w-20`}
                value={qty}
                onChange={(e) => setQty(Number(e.target.value))}
              />
            </label>
            <label className="text-xs text-[#7a5c3e]">
              成交价
              <input
                type="number"
                className={`${inputCls} ml-1 w-24`}
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
              />
            </label>
            <label className="text-xs text-[#7a5c3e]">
              渠道
              <select
                className={`${inputCls} ml-1`}
                value={channel}
                onChange={(e) => setChannel(e.target.value as Channel)}
              >
                {CHANNELS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <button
              className={btnCls}
              onClick={() => {
                if (qty === 0) return;
                const bid = ds.books.some((b) => b.id === bookId) ? bookId : ds.books[0].id;
                addSale({ at: fromLocalInput(at), bookId: bid, qty, price, channel });
              }}
            >
              记一笔
            </button>
          </div>
        )}
      </Card>

      {pending.length > 0 && (
        <Card title={`待裁决（${pending.length} 笔：换位与销售同时刻，归属不清）`} className="border-[#d32f2f]">
          <ul className="space-y-2">
            {pending.map((row) => (
              <li key={row.saleId} className="flex flex-wrap items-center gap-2 text-sm text-[#3e2f23]">
                <span className="rounded bg-[#fff3cd] px-1.5 py-0.5 text-xs text-[#8a6d1a]">
                  {fmtTime(row.at)}
                </span>
                《{bookTitle(row.bookId)}》 {row.qty} 件 × {fmtWen(row.price)}
                <span className="text-[#9c8a68]">归到：</span>
                {row.candidates.map((c, i) => (
                  <button
                    key={i}
                    className="rounded border border-[#b36d61] bg-[#fdeae6] px-2 py-0.5 text-xs text-[#8d3b30] hover:bg-[#f8d9d3]"
                    onClick={() => resolve(row.saleId, i)}
                  >
                    {c.label}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={`销售流水与归因（共 ${result.saleRows.length} 笔）`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>时刻</Th>
                <Th>书籍</Th>
                <Th className="text-right">数量</Th>
                <Th className="text-right">成交价</Th>
                <Th className="text-right">金额</Th>
                <Th>渠道</Th>
                <Th>时段</Th>
                <Th>陈列位归属</Th>
                <Th className="text-right">成交后库存</Th>
                <Th>异常</Th>
                <Th>操作</Th>
              </tr>
            </thead>
            <tbody>
              {result.saleRows.map((row) => (
                <tr key={row.saleId} className={row.anomalies.length > 0 ? "bg-[#f9e8e4]" : ""}>
                  <Td>{fmtTime(row.at)}</Td>
                  <Td>《{bookTitle(row.bookId)}》</Td>
                  <Td className={`text-right ${row.qty < 0 ? "text-[#1e6f5c]" : ""}`}>
                    {row.qty < 0 ? `退 ${-row.qty}` : row.qty}
                  </Td>
                  <Td className="text-right">{fmtWen(row.price)}</Td>
                  <Td className="text-right">{fmtWen(row.amount)}</Td>
                  <Td>{row.channel}</Td>
                  <Td>{row.period}</Td>
                  <Td>
                    {row.resolved ? (
                      slotNameOf(row.slotId)
                    ) : (
                      <span className="rounded bg-[#d32f2f] px-1.5 py-0.5 text-xs text-white">待裁决</span>
                    )}
                  </Td>
                  <Td className="text-right">{row.stockAfter ?? "—"}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {row.anomalies.map((a) => (
                        <span key={a} className="rounded bg-[#d32f2f] px-1.5 py-0.5 text-xs text-white">
                          {ANOMALY_LABEL[a] ?? a}
                        </span>
                      ))}
                    </div>
                  </Td>
                  <Td>
                    <button
                      className={btnDangerCls}
                      onClick={() => {
                        if (confirm("删除这笔流水？")) removeSale(row.saleId);
                      }}
                    >
                      删除
                    </button>
                  </Td>
                </tr>
              ))}
              {result.saleRows.length === 0 && (
                <tr><Td className="py-6 text-center text-[#9c8a68]">尚无流水</Td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
