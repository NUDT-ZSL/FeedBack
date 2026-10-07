import { useMemo, useState } from "react";
import { useSimStore } from "@/store/simStore";
import { EventStatus } from "@/engine";

const STATUS_LABEL: Record<EventStatus, string> = {
  kept: "保留",
  "dropped-admit": "丢弃(准入)",
  "dropped-overflow": "丢弃(溢出)",
  "dropped-trim": "丢弃(裁剪)",
  "downsampled-out": "降采样丢弃",
  held: "暂存(暂停)",
  queued: "队列残留",
};
const STATUS_COLOR: Record<EventStatus, string> = {
  kept: "text-emerald-400",
  "dropped-admit": "text-red-400",
  "dropped-overflow": "text-red-300",
  "dropped-trim": "text-orange-400",
  "downsampled-out": "text-amber-400",
  held: "text-sky-400",
  queued: "text-zinc-400",
};

export default function EventInspector() {
  const output = useSimStore((s) => s.output);
  const selectedSwitchId = useSimStore((s) => s.selectedSwitchId);
  const sourceFilter = useSimStore((s) => s.sourceFilter);
  const setSourceFilter = useSimStore((s) => s.setSourceFilter);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [range, setRange] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [page, setPage] = useState(0);

  const sources = useMemo(() => {
    const set = new Set<string>();
    output?.events.forEach((e) => set.add(e.sourceId));
    return [...set].sort();
  }, [output]);

  const selectedSwitch = output?.switches.find((s) => s.id === selectedSwitchId) ?? null;

  const filtered = useMemo(() => {
    if (!output) return [];
    const from = range.from === "" ? -Infinity : Number(range.from);
    const to = range.to === "" ? Infinity : Number(range.to);
    return output.events.filter((e) => {
      if (sourceFilter && e.sourceId !== sourceFilter) return false;
      if (statusFilter && e.status !== statusFilter) return false;
      if (e.arrivalTime < from || e.arrivalTime > to) return false;
      if (selectedSwitch && e.decidedBy !== selectedSwitch.id &&
          !(e.history ?? []).includes(selectedSwitch.id)) return false;
      return true;
    });
  }, [output, sourceFilter, statusFilter, range, selectedSwitch]);

  if (!output) return null;
  const PAGE = 50;
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const rows = filtered.slice(page * PAGE, (page + 1) * PAGE);

  return (
    <div className="space-y-2 text-xs">
      <div className="flex gap-2 flex-wrap items-center">
        <select
          value={sourceFilter ?? ""}
          onChange={(e) => { setSourceFilter(e.target.value || null); setPage(0); }}
          className="rounded bg-zinc-800 border border-zinc-700 px-1.5 py-1 text-zinc-100"
        >
          <option value="">全部来源</option>
          {sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
          className="rounded bg-zinc-800 border border-zinc-700 px-1.5 py-1 text-zinc-100"
        >
          <option value="">全部结论</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="text-zinc-400 flex items-center gap-1">
          时刻
          <input value={range.from} placeholder="起" onChange={(e) => { setRange({ ...range, from: e.target.value }); setPage(0); }}
            className="w-16 rounded bg-zinc-800 border border-zinc-700 px-1.5 py-1 text-zinc-100" />
          ~
          <input value={range.to} placeholder="止" onChange={(e) => { setRange({ ...range, to: e.target.value }); setPage(0); }}
            className="w-16 rounded bg-zinc-800 border border-zinc-700 px-1.5 py-1 text-zinc-100" />
        </label>
        {selectedSwitch && (
          <span className="text-amber-300">仅看 {selectedSwitch.id} 影响的事件</span>
        )}
        <span className="ml-auto text-zinc-500">{filtered.length} 条</span>
      </div>
      <div className="overflow-auto max-h-64 rounded border border-zinc-800">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-zinc-900">
            <tr className="text-zinc-400 text-left">
              <th className="px-2 py-1">事件</th>
              <th className="px-2 py-1">来源</th>
              <th className="px-2 py-1">到达</th>
              <th className="px-2 py-1">最终结论</th>
              <th className="px-2 py-1">消费完成</th>
              <th className="px-2 py-1">处置依据链</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.eventId} className="border-t border-zinc-800/60">
                <td className="px-2 py-0.5 font-mono text-zinc-300">{e.eventId}</td>
                <td className="px-2 py-0.5">{e.sourceId}</td>
                <td className="px-2 py-0.5 font-mono">{e.arrivalTime.toFixed(3)}</td>
                <td className={`px-2 py-0.5 ${STATUS_COLOR[e.status]}`}>{STATUS_LABEL[e.status]}</td>
                <td className="px-2 py-0.5 font-mono">{e.consumedAt?.toFixed(3) ?? "—"}</td>
                <td className="px-2 py-0.5 font-mono text-zinc-500">
                  {(e.history ?? [e.decidedBy]).join(" → ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex gap-2 items-center text-zinc-400">
          <button disabled={page === 0} onClick={() => setPage(page - 1)} className="px-2 py-0.5 rounded bg-zinc-800 disabled:opacity-40">上一页</button>
          <span>{page + 1}/{pages}</span>
          <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className="px-2 py-0.5 rounded bg-zinc-800 disabled:opacity-40">下一页</button>
        </div>
      )}
    </div>
  );
}
