import { useSimStore } from "@/store/simStore";

export default function StatsBar() {
  const output = useSimStore((s) => s.output);
  if (!output) return null;
  const { stats } = output;
  const items: [string, number, string][] = [
    ["事件总数", stats.totalEvents, "text-zinc-100"],
    ["保留消费", stats.kept, "text-emerald-400"],
    ["丢弃", stats.dropped, "text-red-400"],
    ["降采样丢", stats.downsampledOut, "text-amber-400"],
    ["暂存", stats.held, "text-sky-400"],
    ["队列残留", stats.queued, "text-zinc-400"],
    ["切换次数", output.switches.length, "text-fuchsia-300"],
  ];
  return (
    <div className="flex gap-4 flex-wrap text-xs">
      {items.map(([label, v, cls]) => (
        <div key={label} className="rounded bg-zinc-900/70 border border-zinc-800 px-2.5 py-1">
          <span className="text-zinc-500">{label} </span>
          <span className={`font-mono font-semibold ${cls}`}>{v}</span>
        </div>
      ))}
    </div>
  );
}
