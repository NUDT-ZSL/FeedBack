import { useMemo, useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { useShopStore } from '@/store/useShopStore';
import { CHANNELS } from '@/domain/types';
import { ts } from '@/domain/engine';
import { fmtMoney, fmtPeriod, fmtTime } from '@/lib/format';

const inputCls =
  'rounded border border-[#a98a5c] bg-[#fffdf5] px-2 py-1 text-sm outline-none focus:border-[#5d4037]';

const flagText: Record<string, { label: string; cls: string }> = {
  oversell: { label: '超卖异常', cls: 'bg-[#db5a6b] text-white' },
  'return-overflow': { label: '退货超量', cls: 'bg-[#b36d61] text-white' },
  disputed: { label: '陈列位待裁决', cls: 'bg-[#c8a951] text-[#3e2723]' },
};

export default function SalesPanel() {
  const books = useShopStore((s) => s.books);
  const sales = useShopStore((s) => s.sales);
  const result = useShopStore((s) => s.result);
  const addSale = useShopStore((s) => s.addSale);
  const removeSale = useShopStore((s) => s.removeSale);

  const [form, setForm] = useState({
    time: '2026-10-01T09:00',
    bookId: '',
    quantity: '1',
    price: '',
    channel: CHANNELS[0] as string,
  });

  const bookById = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);

  const pickBook = (id: string) => {
    const book = bookById.get(id);
    setForm((f) => ({ ...f, bookId: id, price: book ? String(book.listPrice) : f.price }));
  };

  const submit = () => {
    if (!form.bookId || !form.time) return;
    addSale({
      time: form.time,
      bookId: form.bookId,
      quantity: Number(form.quantity),
      price: Number(form.price) || 0,
      channel: form.channel,
    });
    setForm((f) => ({ ...f, quantity: '1' }));
  };

  const sorted = sales.slice().sort((a, b) => ts(a.time) - ts(b.time) || a.id.localeCompare(b.id));

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[#8d6e4a] bg-[#fffdf5] p-4 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 font-serif text-lg font-bold text-[#5d4037]">
          <Plus size={18} /> 录入销售流水（数量填负数表示退货）
        </h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <input
            className={inputCls}
            type="datetime-local"
            value={form.time}
            onChange={(e) => setForm({ ...form, time: e.target.value })}
          />
          <select
            className={inputCls}
            value={form.bookId}
            onChange={(e) => pickBook(e.target.value)}
          >
            <option value="">选择书籍</option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
          <input
            className={inputCls}
            type="number"
            placeholder="数量（负=退货）"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
          />
          <input
            className={inputCls}
            type="number"
            placeholder="成交单价(文)"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
          />
          <select
            className={inputCls}
            value={form.channel}
            onChange={(e) => setForm({ ...form, channel: e.target.value })}
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={submit}
          className="mt-3 rounded border border-[#5d4037] bg-[#c8a951] px-4 py-1.5 text-sm font-bold text-[#3e2723] transition hover:brightness-105 active:scale-95"
        >
          添加流水
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#8d6e4a] bg-[#fffdf5] shadow-sm">
        <table className="w-full min-w-[1000px] text-sm">
          <thead>
            <tr className="bg-[#5d4037] text-[#f5e6c8]">
              {['时刻', '书籍', '数量', '成交单价', '渠道', '成交额', '归因陈列位', '归因时段', '标记', ''].map(
                (h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-normal">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((sale) => {
              const book = bookById.get(sale.bookId);
              const attr = result.attributions[sale.id];
              const flags = result.saleFlags[sale.id] ?? [];
              return (
                <tr key={sale.id} className="border-t border-[#e3d5b8] hover:bg-[#faf3e0]">
                  <td className="whitespace-nowrap px-3 py-2">{fmtTime(sale.time)}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-serif font-bold text-[#3e2723]">
                    {book?.title ?? '（书籍已删除）'}
                  </td>
                  <td className={`px-3 py-2 ${sale.quantity < 0 ? 'text-[#b36d61]' : ''}`}>
                    {sale.quantity}
                  </td>
                  <td className="px-3 py-2">{fmtMoney(sale.price)}</td>
                  <td className="px-3 py-2">{sale.channel}</td>
                  <td
                    className={`px-3 py-2 font-bold ${
                      sale.quantity * sale.price < 0 ? 'text-[#b36d61]' : 'text-[#3e6b3e]'
                    }`}
                  >
                    {fmtMoney(sale.quantity * sale.price)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className={attr?.disputed ? 'font-bold text-[#b8860b]' : ''}>
                      {attr?.slotLabel ?? '—'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-[#6d5a40]">
                    {attr ? fmtPeriod(attr.periodStart, attr.periodEnd) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {flags.map((f) => (
                        <span
                          key={f}
                          className={`rounded px-1.5 py-0.5 text-xs ${flagText[f]?.cls ?? ''}`}
                        >
                          {flagText[f]?.label ?? f}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => removeSale(sale.id)}
                      className="text-[#8d6e4a] hover:text-[#db5a6b]"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {sales.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-[#8d6e4a]">
                  尚无销售流水。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
