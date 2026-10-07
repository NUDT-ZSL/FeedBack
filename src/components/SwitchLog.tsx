import { useSimStore } from "@/store/simStore";

export default function SwitchLog() {
  const output = useSimStore((s) => s.output);
  const selectedSwitchId = useSimStore((s) => s.selectedSwitchId);
  const selectSwitch = useSimStore((s) => s.selectSwitch);

  if (!output) return null;
  if (output.switches.length === 0) {
    return <div className="text-xs text-zinc-500 p-2">本次推演未发生档位切换。</div>;
  }
  return (
    <div className="overflow-auto max-h-72 text-xs">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 bg-zinc-900">
          <tr className="text-zinc-400 text-left">
            <th className="px-2 py-1">记录</th>
            <th className="px-2 py-1">时刻</th>
            <th className="px-2 py-1">切换</th>
            <th className="px-2 py-1">触发依据</th>
            <th className="px-2 py-1">影响区间</th>
            <th className="px-2 py-1">副作用</th>
          </tr>
        </thead>
        <tbody>
          {output.switches.map((sw) => (
            <tr
              key={sw.id}
              onClick={() => selectSwitch(sw.id === selectedSwitchId ? null : sw.id)}
              className={`cursor-pointer border-t border-zinc-800 ${
                sw.id === selectedSwitchId ? "bg-amber-900/30" : "hover:bg-zinc-800/60"
              }`}
            >
              <td className="px-2 py-1 font-mono text-zinc-300">{sw.id}</td>
              <td className="px-2 py-1 font-mono">{sw.time.toFixed(3)}s</td>
              <td className="px-2 py-1">
                <span className={sw.direction === "release" ? "text-green-400" : "text-red-400"}>
                  {sw.fromTier ?? "基础"} → {sw.toTier ?? "基础"}
                </span>
                {sw.adjudicationId && <span className="ml-1 text-amber-300">(裁决)</span>}
              </td>
              <td className="px-2 py-1 text-zinc-400">{sw.trigger.rule}</td>
              <td className="px-2 py-1 font-mono text-zinc-400">
                [{sw.range.start.toFixed(2)}, {sw.range.end.toFixed(2)})
              </td>
              <td className="px-2 py-1 text-zinc-400">
                {sw.effects.trimmedEventIds.length > 0
                  ? `裁剪 ${sw.effects.trimmedEventIds.length} 条`
                  : "—"}
                {sw.effects.capacity >= 0 ? ` 容量=${sw.effects.capacity}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
