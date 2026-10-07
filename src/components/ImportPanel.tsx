import { useRef, useState } from "react";
import { useSimStore } from "@/store/simStore";
import { generateSample } from "@/lib/sample";
import { BatchCase } from "@/engine";

export default function ImportPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const rawEvents = useSimStore((s) => s.rawEvents);
  const allIssues = useSimStore((s) => s.allIssues);
  const blockingIssues = useSimStore((s) => s.blockingIssues);
  const loadEvents = useSimStore((s) => s.loadEvents);
  const setConfig = useSimStore((s) => s.setConfig);

  const readFile = async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const events = Array.isArray(parsed) ? parsed : parsed.events;
      if (!Array.isArray(events)) throw new Error("JSON 需为事件数组或含 events 字段");
      const config = parsed.config;
      loadEvents(events);
      if (config?.tiers) setConfig(config);
    } catch (e) {
      setError(`导入失败: ${(e as Error).message}`);
    }
  };

  const loadSample = () => {
    const { events, config } = generateSample(Date.now() & 0xffff);
    setError(null);
    loadEvents(events);
    setConfig(config);
  };

  const loadSampleCases = async () => {
    const res = await fetch("/cases/samples.json");
    const cases: BatchCase[] = await res.json();
    const first = cases[0];
    setConfig(first.config);
    loadEvents(first.events);
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => fileRef.current?.click()}
          className="px-3 py-1.5 text-sm rounded bg-sky-600 hover:bg-sky-500 text-white"
        >
          导入事件流 JSON
        </button>
        <button
          onClick={loadSample}
          className="px-3 py-1.5 text-sm rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100"
        >
          生成示例流
        </button>
        <button
          onClick={loadSampleCases}
          className="px-3 py-1.5 text-sm rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100"
        >
          加载批量用例#1
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) readFile(f);
            e.target.value = "";
          }}
        />
      </div>
      <div className="text-xs text-zinc-400">
        已加载 <span className="text-zinc-200 font-mono">{rawEvents.length}</span> 条原始事件
        （格式：{"{ id, sourceId, arrivalTime, payload }"} 数组，或 {"{events, config}"}）
      </div>
      {error && <div className="text-xs text-red-400">{error}</div>}
      {allIssues.length > 0 && (
        <div className="text-xs space-y-0.5 max-h-28 overflow-auto rounded border border-zinc-700 p-2 bg-zinc-900/60">
          {allIssues.map((m, i) => (
            <div key={i} className={m.startsWith("[数据]") ? "text-amber-300/90" : "text-rose-300/90"}>
              {m}
            </div>
          ))}
        </div>
      )}
      {blockingIssues.length > 0 && (
        <div className="text-xs text-red-300 rounded border border-red-800 bg-red-950/40 p-2">
          存在未裁决冲突，推演已阻塞，请在「档位配置」中完成人工裁决。
        </div>
      )}
    </div>
  );
}
