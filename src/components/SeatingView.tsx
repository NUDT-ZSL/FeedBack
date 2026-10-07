import { useState } from 'react';
import {
  AlertTriangle,
  Archive,
  BadgeCheck,
  CheckCircle2,
  RotateCw,
  ScrollText,
} from 'lucide-react';
import { actions, useActiveBanquet, useWorkspace } from '@/store/useWorkspace';
import { groupSize } from '@/core/solver';
import type { Banquet } from '@/core/types';

/** 座次编排视图：状态横幅 + 各桌落座情况 + 可追溯说明 */
export default function SeatingView() {
  const banquet = useActiveBanquet();
  const dispatch = useWorkspace((s) => s.dispatch);
  const [showTrace, setShowTrace] = useState(false);
  const [showArchive, setShowArchive] = useState(false);

  if (!banquet) {
    return (
      <div className="rounded-xl border-4 border-[#8b5e3c] bg-[#fdf8ec] p-10 text-center text-stone-500">
        请在左侧选择或新建一场宴席
      </div>
    );
  }
  const bid = banquet.id;
  const arr = banquet.arrangement;
  const affected = new Set(arr.affectedTableIds);
  const tableOfGuest = new Map(arr.assignments.map((a) => [a.guestId, a.tableId]));

  return (
    <section className="flex flex-col gap-3">
      {/* 状态横幅 */}
      {arr.status === 'arranged' && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-emerald-300 bg-emerald-50 p-3">
          <CheckCircle2 className="text-emerald-600" size={20} />
          <div className="text-sm">
            <p className="font-bold text-emerald-800">
              座次已成{arr.confirmed ? '，且已确认' : ''}
            </p>
            <p className="text-emerald-700">
              {arr.assignments.length} 位宾客（含随行）全部落座，已通过容量、主桌等级、忌口与不宜同桌校验。
            </p>
          </div>
          <div className="ml-auto flex gap-2">
            {arr.confirmed ? (
              <button
                className="rounded border border-amber-500 px-3 py-1 text-xs text-amber-700 hover:bg-amber-50"
                onClick={() => dispatch(actions.unconfirm(bid))}
              >
                取消确认
              </button>
            ) : (
              <button
                className="flex items-center gap-1 rounded bg-amber-500 px-3 py-1 text-xs text-white hover:bg-amber-600"
                onClick={() => dispatch(actions.confirm(bid))}
                title="确认后，无关改动不会冲掉本场座次"
              >
                <BadgeCheck size={14} /> 确认座次
              </button>
            )}
            <button
              className="flex items-center gap-1 rounded border border-[#8b4513] px-3 py-1 text-xs text-[#8b4513] hover:bg-[#8b4513] hover:text-white"
              onClick={() => dispatch(actions.arrangeBanquet(bid))}
            >
              <RotateCw size={14} /> 整体重排
            </button>
          </div>
        </div>
      )}

      {arr.status === 'unarrangeable' && (
        <div className="rounded-lg border-2 border-red-400 bg-red-50 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 text-red-600" size={20} />
            <div className="flex-1 text-sm">
              <p className="font-bold text-red-800">不可编排</p>
              <p className="text-red-700">
                当前宾客、桌容与约束无法同时满足。系统未静默择一，所有约束均保留，请放宽条件后自动重推。
              </p>
              {arr.conflicts && (
                <ul className="mt-2 list-disc pl-5 text-red-800">
                  {arr.conflicts.core.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                  {arr.conflicts.cycles.map((cycle, i) => (
                    <li key={`c${i}`} className="font-semibold">
                      约束环：{cycle.join(' → ')} → {cycle[0]}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {banquet.lastArchived && (
              <button
                className="flex shrink-0 items-center gap-1 rounded border border-red-400 px-2 py-1 text-xs text-red-700 hover:bg-red-100"
                onClick={() => setShowArchive((v) => !v)}
              >
                <Archive size={14} /> 查看旧座次
              </button>
            )}
          </div>
        </div>
      )}

      {arr.status === 'empty' && (
        <div className="flex items-center gap-2 rounded-lg border-2 border-stone-300 bg-stone-100 p-3 text-sm text-stone-600">
          <AlertTriangle size={18} />
          宾客名单为空，本场宴席处于不可编排状态，无任何残留座次。
          {banquet.lastArchived && (
            <button
              className="ml-auto flex items-center gap-1 rounded border border-stone-400 px-2 py-1 text-xs hover:bg-stone-200"
              onClick={() => setShowArchive((v) => !v)}
            >
              <Archive size={14} /> 查看旧座次
            </button>
          )}
        </div>
      )}

      {showArchive && banquet.lastArchived && (
        <ArchiveView banquet={banquet} />
      )}

      {/* 桌台 */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {banquet.tables.map((table) => {
          const seatedGuests = arr.assignments
            .filter((a) => a.tableId === table.id)
            .map((a) => banquet.guests.find((g) => g.id === a.guestId)!)
            .filter(Boolean);
          const heads = seatedGuests.reduce((s, g) => s + groupSize(g), 0);
          return (
            <div
              key={table.id}
              className={`rounded-xl border-2 p-3 transition ${
                table.isMain
                  ? 'border-amber-500 bg-amber-50'
                  : 'border-[#c9a97e] bg-[#fdf8ec]'
              } ${affected.has(table.id) && arr.status === 'arranged' ? 'ring-2 ring-blue-300' : ''}`}
            >
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-[#5b3a29]">{table.name}</h4>
                {table.isMain && (
                  <span className="rounded bg-amber-200 px-1.5 text-xs text-amber-900">
                    主桌·门槛{table.minRank}
                  </span>
                )}
                {affected.has(table.id) && arr.status === 'arranged' && (
                  <span className="rounded bg-blue-100 px-1.5 text-xs text-blue-700">
                    本次重推
                  </span>
                )}
                <span
                  className={`ml-auto text-xs ${heads > table.capacity ? 'font-bold text-red-600' : 'text-stone-500'}`}
                >
                  {heads}/{table.capacity} 人
                </span>
              </div>
              {table.dishIds.length > 0 && (
                <p className="mt-1 text-xs text-stone-500">
                  席上：{table.dishIds
                    .map((id) => banquet.dishes.find((d) => d.id === id)?.name)
                    .filter(Boolean)
                    .join('、')}
                </p>
              )}
              <ul className="mt-2 flex flex-col gap-1">
                {seatedGuests.map((g) => (
                  <li
                    key={g.id}
                    className="flex items-center gap-1 rounded bg-white/70 px-2 py-0.5 text-sm"
                  >
                    <span className="font-semibold text-[#5b3a29]">{g.name}</span>
                    <span className="text-xs text-stone-500">
                      {g.entourage > 0 ? `携随行 ${g.entourage} 人` : '独座'}
                    </span>
                    {g.dietary.length > 0 && (
                      <span className="rounded bg-orange-100 px-1 text-xs text-orange-700">
                        忌{g.dietary.join('/')}
                      </span>
                    )}
                  </li>
                ))}
                {seatedGuests.length === 0 && (
                  <li className="py-2 text-center text-xs text-stone-400">空桌</li>
                )}
              </ul>
            </div>
          );
        })}
        {banquet.tables.length === 0 && (
          <p className="rounded border border-dashed border-[#c9a97e] p-6 text-center text-sm text-stone-500 md:col-span-2 xl:col-span-3">
            尚未设桌
          </p>
        )}
      </div>

      {/* 未落座提示（仅在 arranged 异常时出现，理论上不应出现） */}
      {arr.status === 'arranged' &&
        banquet.guests.some((g) => !tableOfGuest.has(g.id)) && (
          <p className="rounded bg-red-50 p-2 text-sm text-red-700">
            有宾客尚未落座，请检查容量与等级设置。
          </p>
        )}

      <button
        className="flex items-center gap-1 self-start text-sm text-[#8b4513] underline"
        onClick={() => setShowTrace((v) => !v)}
      >
        <ScrollText size={14} /> {showTrace ? '收起' : '查看'}编排追溯
      </button>
      {showTrace && (
        <ul className="max-h-72 overflow-y-auto rounded-lg border border-[#c9a97e] bg-[#fdf8ec] p-3 text-xs">
          {arr.trace.length === 0 && <li className="text-stone-500">暂无记录</li>}
          {arr.trace.map((t) => (
            <li key={t.seq} className="border-b border-dashed border-[#e2d3b8] py-0.5">
              <span className="mr-2 text-stone-400">{t.seq}.</span>
              <span className="text-stone-500">[{t.kind}]</span> {t.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 归档的上一次有效座次（只读备查，不残留为当前座次） */
function ArchiveView({ banquet }: { banquet: Banquet }) {
  const archived = banquet.lastArchived!;
  const nameOf = (id: string) =>
    banquet.guests.find((g) => g.id === id)?.name ?? `宾客${id.slice(0, 4)}`;
  const groups = new Map<string, string[]>();
  for (const a of archived.assignments) {
    if (!groups.has(a.tableId)) groups.set(a.tableId, []);
    groups.get(a.tableId)!.push(nameOf(a.guestId));
  }
  return (
    <div className="rounded-lg border-2 border-stone-300 bg-stone-50 p-3 text-sm">
      <p className="mb-1 font-bold text-stone-700">
        归档座次（{new Date(archived.archivedAt).toLocaleString()}，仅备查）
      </p>
      <ul className="list-disc pl-5 text-stone-600">
        {[...groups].map(([tableId, names]) => (
          <li key={tableId}>
            {banquet.tables.find((t) => t.id === tableId)?.name ?? tableId}：
            {names.join('、')}
          </li>
        ))}
      </ul>
    </div>
  );
}
