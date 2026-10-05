import { useState } from "react";
import { useStore } from "@/store/useStore";
import { fmtTime } from "@/engine/compute";
import { btnCls, btnDangerCls, Card, inputCls, Td, Th, toLocalInput, fromLocalInput } from "@/components/ui";

export default function SlotsPage() {
  const { ds, result, addSlot, removeSlot, addPlacement, removePlacement } = useStore();
  const [slotName, setSlotName] = useState("");
  const [bookId, setBookId] = useState(ds.books[0]?.id ?? "");
  const [slotId, setSlotId] = useState(ds.slots[0]?.id ?? "");
  const [at, setAt] = useState(toLocalInput(new Date().toISOString()));

  const bookTitle = (id: string) => ds.books.find((b) => b.id === id)?.title ?? "（书籍已删除）";
  const slotNameOf = (id: string | null) =>
    id === null ? "—" : ds.slots.find((s) => s.id === id)?.name ?? id;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="陈列位">
        <div className="mb-3 flex gap-2">
          <input
            className={`${inputCls} w-40`}
            placeholder="新增陈列位名称，如 乙字二号"
            value={slotName}
            onChange={(e) => setSlotName(e.target.value)}
          />
          <button
            className={btnCls}
            onClick={() => {
              if (slotName.trim()) {
                addSlot(slotName.trim());
                setSlotName("");
              }
            }}
          >
            新增陈列位
          </button>
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <Th>陈列位</Th>
              <Th>当前陈列</Th>
              <Th>操作</Th>
            </tr>
          </thead>
          <tbody>
            {ds.slots.map((s) => {
              const intervals = result.slotTimeline[s.id] ?? [];
              const last = intervals[intervals.length - 1];
              return (
                <tr key={s.id}>
                  <Td className="font-medium">{s.name}</Td>
                  <Td>{last && !last.disputed ? `《${bookTitle(last.bookId ?? "")}》` : "（空 / 争议中）"}</Td>
                  <Td>
                    <button
                      className={btnDangerCls}
                      onClick={() => {
                        if (confirm(`删除陈列位「${s.name}」？相关换位记录将一并删除。`)) removeSlot(s.id);
                      }}
                    >
                      删除
                    </button>
                  </Td>
                </tr>
              );
            })}
            {ds.slots.length === 0 && (
              <tr><Td className="py-4 text-center text-[#9c8a68]">尚无陈列位</Td></tr>
            )}
          </tbody>
        </table>
      </Card>

      <Card title="换位记录（同一陈列位同一时段只能放一本书）">
        {ds.books.length === 0 || ds.slots.length === 0 ? (
          <p className="text-sm text-[#9c8a68]">请先录入书籍与陈列位。</p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-[#7a5c3e]">
              书籍
              <select className={`${inputCls} ml-1`} value={bookId} onChange={(e) => setBookId(e.target.value)}>
                {ds.books.map((b) => (
                  <option key={b.id} value={b.id}>{b.title}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-[#7a5c3e]">
              换到陈列位
              <select className={`${inputCls} ml-1`} value={slotId} onChange={(e) => setSlotId(e.target.value)}>
                {ds.slots.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-[#7a5c3e]">
              生效时刻
              <input
                type="datetime-local"
                className={`${inputCls} ml-1`}
                value={at}
                onChange={(e) => setAt(e.target.value)}
              />
            </label>
            <button
              className={btnCls}
              onClick={() => {
                const bid = ds.books.some((b) => b.id === bookId) ? bookId : ds.books[0].id;
                const sid = ds.slots.some((s) => s.id === slotId) ? slotId : ds.slots[0].id;
                addPlacement({ bookId: bid, slotId: sid, effectiveAt: fromLocalInput(at) });
              }}
            >
              记录换位
            </button>
          </div>
        )}

        <div className="mt-4 max-h-72 overflow-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>生效时刻</Th>
                <Th>书籍</Th>
                <Th>陈列位</Th>
                <Th>操作</Th>
              </tr>
            </thead>
            <tbody>
              {[...ds.placements]
                .sort((a, b) => new Date(a.effectiveAt).getTime() - new Date(b.effectiveAt).getTime())
                .map((p) => {
                  const conflict = result.anomalies.some(
                    (a) => a.type === "slot_conflict" && a.refId === p.id
                  );
                  return (
                    <tr key={p.id} className={conflict ? "bg-[#f9e8e4]" : ""}>
                      <Td>{fmtTime(p.effectiveAt)}</Td>
                      <Td>《{bookTitle(p.bookId)}》</Td>
                      <Td>
                        {slotNameOf(p.slotId)}
                        {conflict && (
                          <span className="ml-2 rounded bg-[#d32f2f] px-1 text-xs text-white">同位冲突</span>
                        )}
                      </Td>
                      <Td>
                        <button className={btnDangerCls} onClick={() => removePlacement(p.id)}>
                          删除
                        </button>
                      </Td>
                    </tr>
                  );
                })}
              {ds.placements.length === 0 && (
                <tr><Td className="py-4 text-center text-[#9c8a68]">尚无换位记录</Td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="陈列位时间线（换位后归属自动重算）" className="lg:col-span-2">
        <div className="grid gap-3 md:grid-cols-3">
          {ds.slots.map((s) => (
            <div key={s.id} className="rounded border border-[#e0cfa5] bg-[#fffdf5] p-2">
              <div className="mb-1 text-sm font-semibold text-[#5d4037]">{s.name}</div>
              <ol className="space-y-1">
                {(result.slotTimeline[s.id] ?? []).map((iv) => (
                  <li key={iv.placementId} className="text-xs text-[#5b4633]">
                    <span className="text-[#9c8a68]">
                      {fmtTime(iv.start)} → {iv.end ? fmtTime(iv.end) : "至今"}
                    </span>
                    <br />
                    《{bookTitle(iv.bookId ?? "")}》
                    {iv.disputed && (
                      <span className="ml-1 rounded bg-[#d32f2f] px-1 text-white">同位冲突</span>
                    )}
                  </li>
                ))}
                {(result.slotTimeline[s.id] ?? []).length === 0 && (
                  <li className="text-xs text-[#9c8a68]">未上柜</li>
                )}
              </ol>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
