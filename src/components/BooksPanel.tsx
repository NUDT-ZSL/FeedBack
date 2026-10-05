import { useMemo, useState } from 'react';
import { Trash2, Plus, BookOpen } from 'lucide-react';
import { useShopStore } from '@/store/useShopStore';
import { CATEGORIES, SLOTS } from '@/domain/types';
import { ts } from '@/domain/engine';
import { fmtMoney, fmtTime } from '@/lib/format';

const inputCls =
  'rounded border border-[#a98a5c] bg-[#fffdf5] px-2 py-1 text-sm outline-none focus:border-[#5d4037]';

export default function BooksPanel() {
  const books = useShopStore((s) => s.books);
  const moves = useShopStore((s) => s.moves);
  const result = useShopStore((s) => s.result);
  const addBook = useShopStore((s) => s.addBook);
  const removeBook = useShopStore((s) => s.removeBook);

  const [form, setForm] = useState({
    title: '',
    edition: '刻本',
    category: CATEGORIES[0] as string,
    costPrice: '',
    listPrice: '',
    initialStock: '',
    slot: SLOTS[0] as string,
  });

  const currentSlot = useMemo(() => {
    const map = new Map<string, string>();
    for (const book of books) {
      const mine = moves
        .filter((m) => m.bookId === book.id)
        .sort((a, b) => ts(b.effectiveAt) - ts(a.effectiveAt))[0];
      map.set(book.id, mine ? mine.slot : book.slot);
    }
    return map;
  }, [books, moves]);

  const submit = () => {
    if (!form.title.trim()) return;
    addBook({
      title: form.title.trim(),
      edition: form.edition.trim() || '刻本',
      category: form.category,
      costPrice: Number(form.costPrice) || 0,
      listPrice: Number(form.listPrice) || 0,
      initialStock: Number(form.initialStock) || 0,
      slot: form.slot,
    });
    setForm({ ...form, title: '', costPrice: '', listPrice: '', initialStock: '' });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[#8d6e4a] bg-[#fffdf5] p-4 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 font-serif text-lg font-bold text-[#5d4037]">
          <Plus size={18} /> 录入书籍
        </h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-8">
          <input
            className={`${inputCls} col-span-2`}
            placeholder="书名"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <input
            className={inputCls}
            placeholder="版式（刻本/抄本/活字本）"
            value={form.edition}
            onChange={(e) => setForm({ ...form, edition: e.target.value })}
          />
          <select
            className={inputCls}
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}部
              </option>
            ))}
          </select>
          <input
            className={inputCls}
            type="number"
            placeholder="进价(文)"
            value={form.costPrice}
            onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
          />
          <input
            className={inputCls}
            type="number"
            placeholder="售价(文)"
            value={form.listPrice}
            onChange={(e) => setForm({ ...form, listPrice: e.target.value })}
          />
          <input
            className={inputCls}
            type="number"
            placeholder="库存"
            value={form.initialStock}
            onChange={(e) => setForm({ ...form, initialStock: e.target.value })}
          />
          <select
            className={inputCls}
            value={form.slot}
            onChange={(e) => setForm({ ...form, slot: e.target.value })}
          >
            {SLOTS.map((slot) => (
              <option key={slot} value={slot}>
                {slot}位
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={submit}
          className="mt-3 rounded border border-[#5d4037] bg-[#c8a951] px-4 py-1.5 text-sm font-bold text-[#3e2723] transition hover:brightness-105 active:scale-95"
        >
          添加书籍
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#8d6e4a] bg-[#fffdf5] shadow-sm">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="bg-[#5d4037] text-[#f5e6c8]">
              {['书名', '版式', '类别', '进价', '当前售价', '陈列位', '期初库存', '当前库存', '净销量', '售罄时点', '动销', '营收', '利润', ''].map(
                (h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-normal">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {books.map((book) => {
              const st = result.bookStats[book.id];
              const abnormal = st && (st.finalStock < 0 || st.anomalySaleIds.length > 0);
              return (
                <tr key={book.id} className="border-t border-[#e3d5b8] hover:bg-[#faf3e0]">
                  <td className="px-3 py-2 font-serif font-bold text-[#3e2723]">
                    <BookOpen size={13} className="mr-1 inline text-[#8d6e4a]" />
                    {book.title}
                  </td>
                  <td className="px-3 py-2">{book.edition}</td>
                  <td className="px-3 py-2">{book.category}部</td>
                  <td className="px-3 py-2">{fmtMoney(book.costPrice)}</td>
                  <td className="px-3 py-2">{fmtMoney(book.listPrice)}</td>
                  <td className="px-3 py-2">{currentSlot.get(book.id)}</td>
                  <td className="px-3 py-2">{book.initialStock}</td>
                  <td className={`px-3 py-2 font-bold ${abnormal ? 'text-[#db5a6b]' : ''}`}>
                    {st?.finalStock ?? 0}
                  </td>
                  <td className="px-3 py-2">{st?.soldQty ?? 0}</td>
                  <td className="px-3 py-2">{fmtTime(st?.soldOutAt ?? null)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        st?.status === '已售罄'
                          ? 'bg-[#db5a6b] text-white'
                          : st?.status === '动销中'
                            ? 'bg-[#a0c4a8] text-[#2f3d2e]'
                            : 'bg-[#e3d5b8] text-[#6d5a40]'
                      }`}
                    >
                      {st?.status ?? '未动销'}
                    </span>
                    {abnormal && (
                      <span className="ml-1 rounded bg-[#db5a6b] px-1.5 py-0.5 text-xs text-white">
                        异常
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{fmtMoney(st?.revenue ?? 0)}</td>
                  <td
                    className={`px-3 py-2 font-bold ${
                      (st?.profit ?? 0) >= 0 ? 'text-[#3e6b3e]' : 'text-[#db5a6b]'
                    }`}
                  >
                    {fmtMoney(st?.profit ?? 0)}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      title="删除（连带该书流水与换位记录）"
                      onClick={() => removeBook(book.id)}
                      className="text-[#8d6e4a] hover:text-[#db5a6b]"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {books.length === 0 && (
              <tr>
                <td colSpan={14} className="px-3 py-10 text-center text-[#8d6e4a]">
                  尚无书籍，请在上方录入，或到「数据」页载入样例数据。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
