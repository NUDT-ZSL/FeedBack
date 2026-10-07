import { useEffect, useState } from "react";
import ImportPanel from "@/components/ImportPanel";
import ConfigPanel from "@/components/ConfigPanel";
import TimelineChart from "@/components/TimelineChart";
import SwitchLog from "@/components/SwitchLog";
import EventInspector from "@/components/EventInspector";
import IncrementalPanel from "@/components/IncrementalPanel";
import BatchPanel from "@/components/BatchPanel";
import StatsBar from "@/components/StatsBar";
import { generateSample } from "@/lib/sample";
import { useSimStore } from "@/store/simStore";

type Tab = "backlog" | "switches" | "events" | "rederive" | "batch";

const TABS: { key: Tab; label: string }[] = [
  { key: "backlog", label: "积压时间轴" },
  { key: "switches", label: "档位切换记录" },
  { key: "events", label: "事件处置核查" },
  { key: "rederive", label: "增量重推" },
  { key: "batch", label: "批量验证" },
];

export default function Home() {
  const [tab, setTab] = useState<Tab>("backlog");
  const rawEvents = useSimStore((s) => s.rawEvents);
  const loadEvents = useSimStore((s) => s.loadEvents);
  const setConfig = useSimStore((s) => s.setConfig);
  useEffect(() => {
    if (rawEvents.length === 0) {
      const { events, config } = generateSample(20261007);
      loadEvents(events);
      setConfig(config);
    }
  }, [rawEvents.length, loadEvents, setConfig]);
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-4 py-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-base font-semibold">背压分级推演台</h1>
          <span className="text-xs text-zinc-500">
            离线事件流 · 多档消费速率 · 丢弃/降采样/扩容/暂停 · 可追溯决策与增量重推
          </span>
        </div>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 p-4">
        <aside className="space-y-4">
          <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-3">
            <h2 className="text-sm font-semibold">① 事件流导入</h2>
            <ImportPanel />
          </section>
          <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-3">
            <h2 className="text-sm font-semibold">② 档位配置与裁决</h2>
            <ConfigPanel />
          </section>
        </aside>
        <main className="space-y-4 min-w-0">
          <StatsBar />
          <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
            <div className="flex gap-1 mb-3 border-b border-zinc-800 flex-wrap">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-3 py-1.5 text-sm rounded-t ${
                    tab === t.key
                      ? "text-sky-300 border-b-2 border-sky-400 -mb-px"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {tab === "backlog" && <TimelineChart />}
            {tab === "switches" && <SwitchLog />}
            {tab === "events" && <EventInspector />}
            {tab === "rederive" && <IncrementalPanel />}
            {tab === "batch" && <BatchPanel />}
          </section>
        </main>
      </div>
    </div>
  );
}
