import { useMemo, useState } from 'react';
import { Plus, Trash2, Scale, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useShopStore } from '@/store/useShopStore';
import { SLOTS } from '@/domain/types';
import { ts } from '@/domain/engine';
import { fmtPeriod, fmtTime, toLocalIso } from '@/lib/format';

const inputCls =
  'rounded border border-[#a98a5c] bg-[#fffdf5] px-2 py-1 text-sm outline-none focus:border-[#5d4037]';

export default function SlotsPanel() {
  const books = useShopStore((s) => s.books);
  const moves = useShopStore((s) => s.moves);
  const adjudications = useShopStore((s) => s.adjudications);
  const result = useShopStore((s) => s.result);
  const lastVerify = useShopStore((s) => s.lastVerify);
  const addMove = useShopStore((s) => s.addMove);
  const removeMove = useShopStore((s) => s.removeMove);
  const adjudicate = useShopStore((s) => s.adjudicate);
  const removeAdjudication = useShopStore((s) => s.removeAdjudication);

  const [form, setForm] = useState({ bookId: '', slot: SLOTS[0] as string, effectiveAt: '2026-10-01T09:00' });

  const bookById = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);
  const bookName = (id: string) => bookById.get(id)?.title ?? id;

  const timeline = useMemo(() => {
    const bySlot = new Map<string, typeof result.intervals>();
    for (const iv of result.intervals) {
      if (!bySlot.has(iv.slot)) bySlot.set(iv.slot, []);
      bySlot.get(iv.slot)!.push(iv);
    }
    return [...bySlot.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh'));
  }, [result]);

  const inConflict = (slot: string, start: number, end: number) =>
    result.conflicts.some((c) => c.slot === slot && c.start < end && c.end > start);

  const pending = result.conflicts.filter((c) => !c.winnerId);
  const resolved = result.conflicts.filter((c) => c.winnerId);

  const sortedMoves = moves
    .slice()
    .sort((a, b) => ts(a.effectiveAt) - ts(b.effectiveAt) || a.id.localeCompare(b.id));

  return (
    <div className="space-y-4">
      {lastVerify && (
        <div
          className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm ${
            lastVerify.ok
              ? 'border-[#6b8e23] bg-[#eef4e3] text-[#3e6b3e]'
              : 'border-[#db5a6b] bg-[#fbe4e6] text-[#a03040]'
          }`}
        >
          {lastVerify.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {lastVerify.ok
            ? `裁决后增量重算（涉及 ${lastVerify.affectedBooks.map(bookName).join('、') || '无'}）与整体重算结果一致`
            : '增量重算与整体重算不一致，请到「数据」页执行整体重算'}
        </div>
      )}

      <div className="rounded-lg border border-[#8d6e4a] bg-[#fffdf5] p-4 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 font-serif text-lg font-bold text-[#5d4037]">
          <Plus size={18} /> 登记换位（记录生效时刻）
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={inputCls}
            value={form.bookId}
            onChange={(e) => setForm({ ...form, bookId: e.target.value })}
          >
            <option value="">选择书籍</option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
          <select
            className={inputCls}
            value={form.slot}
            onChange={(e) => setForm({ ...form, slot: e.target.value })}
          >
            {SLOTS.map((slot) => (
              <option key={slot} value={slot}>
                迁至 {slot}位
              </option>
            ))}
          </select>
          <input
            className={inputCls}
            type="datetime-local"
            value={form.effectiveAt}
            onChange={(e) => setForm({ ...form, effectiveAt: e.target.value })}
          />
          <button
            onClick={() => {
              if (!form.bookId) return;
              addMove({ bookId: form.bookId, slot: form.slot, effectiveAt: form.effectiveAt });
            }}
            className="rounded border border-[#5d4037] bg-[#c8a951] px-4 py-1.5 text-sm font-bold text-[#3e2723] transition hover:brightness-105 active:scale-95"
          >
            登记换位
          </button>
        </div>
        {sortedMoves.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {sortedMoves.map((m) => (
              <li key={m.id} className="flex items-center gap-2 text-[#4e342e]">
                <span className="text-[#8d6e4a]">{fmtTime(m.effectiveAt)}</span>
                <span className="font-serif font-bold">{bookName(m.bookId)}</span>
                <span>迁至</span>
                <span className="font-bold">{m.slot}位</span>
                <button
                  onClick={() => removeMove(m.id)}
                  className="text-[#8d6e4a] hover:text-[#db5a6b]"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-[#8d6e4a] bg-[#fffdf5] p-4 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 font-serif text-lg font-bold text-[#5d4037]">
          <Scale size={18} /> 陈列位归属争议（{pending.length} 待裁决 / {resolved.length} 已裁决）
        </h2>
        {pending.length === 0 && resolved.length === 0 && (
          <p className="text-sm text-[#8d6e4a]">各陈列位时段归属清晰，暂无争议。</p>
        )}
        <div className="space-y-3">
          {pending.map((c) => (
            <div
              key={c.id}
              className="rounded border border-[#c8a951] bg-[#fdf6dd] p-3 text-sm"
            >
              <div className="mb-2 font-bold text-[#7a5c00]">
                {c.slot}位 · {fmtPeriod(c.start, c.end)} · 归属不清，涉及{' '}
                {c.bookIds.map(bookName).join('、')}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[#6d5a40]">裁决归属：</span>
                {c.bookIds.map((id) => (
                  <button
                    key={id}
                    onClick={() =>
                      adjudicate(c.slot, toLocalIso(c.start), toLocalIso(c.end), id)
                    }
                    className="rounded border border-[#5d4037] bg-[#fffdf5] px-3 py-1 font-serif font-bold text-[#3e2723] transition hover:bg-[#c8a951] active:scale-95"
                  >
                    {bookName(id)}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {resolved.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between rounded border border-[#a0c4a8] bg-[#eef4e3] p-3 text-sm"
            >
              <span className="text-[#3e6b3e]">
                {c.slot}位 · {fmtPeriod(c.start, c.end)} · 已裁决归「
                {bookName(c.winnerId!)}」
              </span>
              {c.adjudicationId && (
                <button
                  onClick={() => removeAdjudication(c.adjudicationId!)}
                  className="text-xs text-[#8d6e4a] underline hover:text-[#db5a6b]"
                >
                  撤销裁决
                </button>
              )}
            </div>
          ))}
        </div>
        {adjudications.length > 0 && (
          <p className="mt-2 text-xs text-[#8d6e4a]">
            共 {adjudications.length} 条裁决记录，随数据一同导入导出。
          </p>
        )}
      </div>

      <div className="rounded-lg border border-[#8d6e4a] bg-[#fffdf5] p-4 shadow-sm">
        <h2 className="mb-3 font-serif text-lg font-bold text-[#5d4037]">陈列位占用时间线</h2>
        <div className="space-y-2">
          {timeline.map(([slot, ivs]) => (
            <div key={slot} className="flex items-start gap-3 text-sm">
              <span className="mt-0.5 w-10 shrink-0 rounded bg-[#5d4037] px-1.5 py-0.5 text-center text-xs text-[#f5e6c8]">
                {slot}
              </span>
              <div className="flex flex-wrap gap-2">
                {ivs
                  .slice()
                  .sort((a, b) => a.start - b.start)
                  .map((iv, i) => {
                    const conflict = inConflict(iv.slot, iv.start, iv.end);
                    return (
                      <span
                        key={i}
                        className={`rounded border px-2 py-1 ${
                          conflict
                            ? 'border-[#c8a951] bg-[#fdf6dd] text-[#7a5c00]'
                            : 'border-[#d8c9a3] bg-[#faf3e0] text-[#4e342e]'
                        }`}
                      >
                        <span className="font-serif font-bold">{bookName(iv.bookId)}</span>
                        <span className="ml-1 text-xs">
                          {fmtPeriod(iv.start, iv.end)}
                          {conflict ? '（冲突）' : ''}
                        </span>
                      </span>
                    );
                  })}
              </div>
            </div>
          ))}
          {timeline.length === 0 && (
            <p className="text-sm text-[#8d6e4a]">尚无书籍与陈列位数据。</p>
          )}
        </div>
      </div>
    </div>
  );
}
