import { useMemo, useState } from "react";
import { useSimStore } from "@/store/simStore";

export default function IncrementalPanel() {
  const output = useSimStore((s) => s.output);
  const config = useSimStore((s) => s.config);
  const changeLog = useSimStore((s) => s.changeLog);
  const applyChange = useSimStore((s) => s.applyChange);
  const [sourceId, setSourceId] = useState("");
  const [factor, setFactor] = useState("2");
  const [tierId, setTierId] = useState("");
  const [threshold, setThreshold] = useState("");

  const sources = useMemo(() => {
    const set = new Set<string>();
    output?.events.forEach((e) => set.add(e.sourceId));
    return [...set].sort();
  }, [output]);

  if (!output) return null;

  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded border border-zinc-700 p-2 space-y-2">
          <div className="text-zinc-300 font-semibold">修改来源到达速率</div>
          <div className="flex gap-2 items-center flex-wrap">
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}
              className="rounded bg-zinc-800 border border-zinc-700 px-1.5 py-1 text-zinc-100">
              <option value="">选择来源</option>
              {sources.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <label className="text-zinc-400 flex items-center gap-1">
              倍率
              <input value={factor} onChange={(e) => setFactor(e.target.value)}
                className="w-16 rounded bg-zinc-800 border border-zinc-700 px-1.5 py-1 text-zinc-100" />
            </label>
            <button
              disabled={!sourceId || !(Number(factor) > 0)}
              onClick={() =>
                applyChange(
                  { kind: "sourceRate", sourceId, factor: Number(factor) },
                  `来源 ${sourceId} 速率 ×${factor}`,
                )
              }
              className="px-2 py-1 rounded bg-sky-700 hover:bg-sky-600 text-white disabled:opacity-40"
            >
              增量重推
            </button>
          </div>
        </div>
        <div className="rounded border border-zinc-700 p-2 space-y-2">
          <div className="text-zinc-300 font-semibold">修改档位阈值</div>
          <div className="flex gap-2 items-center flex-wrap">
            <select value={tierId} onChange={(e) => setTierId(e.target.value)}
              className="rounded bg-zinc-800 border border-zinc-700 px-1.5 py-1 text-zinc-100">
              <option value="">选择档位</option>
              {config.tiers.map((t) => <option key={t.id} value={t.id}>{t.id}（当前 {t.threshold}）</option>)}
            </select>
            <label className="text-zinc-400 flex items-center gap-1">
              新阈值
              <input value={threshold} onChange={(e) => setThreshold(e.target.value)}
                className="w-16 rounded bg-zinc-800 border border-zinc-700 px-1.5 py-1 text-zinc-100" />
            </label>
            <button
              disabled={!tierId || threshold === ""}
              onClick={() =>
                applyChange(
                  { kind: "tierThreshold", tierId, threshold: Number(threshold) },
                  `档位 ${tierId} 阈值 → ${threshold}`,
                )
              }
              className="px-2 py-1 rounded bg-sky-700 hover:bg-sky-600 text-white disabled:opacity-40"
            >
              增量重推
            </button>
          </div>
        </div>
      </div>
      <div className="text-zinc-500">
        每次变更仅重推受影响的时间区间与来源，并自动与整体重推逐字段核对。
      </div>
      {changeLog.length > 0 && (
        <div className="space-y-1">
          <div className="text-zinc-300 font-semibold">变更记录</div>
          <div className="space-y-1 max-h-40 overflow-auto">
            {changeLog.map((c, i) => (
              <div key={i} className={`rounded border px-2 py-1 ${c.ok ? "border-emerald-800 bg-emerald-950/30" : "border-red-800 bg-red-950/30"}`}>
                <span className={c.ok ? "text-emerald-300" : "text-red-300"}>{c.ok ? "✓" : "✗"}</span>{" "}
                {c.name} — 影响起点 t={Number.isFinite(c.impactStart) ? c.impactStart.toFixed(3) : "无"}
                ，{c.resumedFromSnapshot ? "复用快照增量重推" : "从头重推（无可用快照）"}
                ，与整体重推{c.ok ? "一致" : "不一致"}
                {c.failures.length > 0 && (
                  <div className="text-red-300 mt-0.5">{c.failures.join("；")}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
