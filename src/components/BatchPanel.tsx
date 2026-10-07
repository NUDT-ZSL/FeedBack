import { useState } from "react";
import { useSimStore } from "@/store/simStore";
import { BatchCase } from "@/engine";

export default function BatchPanel() {
  const batchReports = useSimStore((s) => s.batchReports);
  const runBatchCases = useSimStore((s) => s.runBatchCases);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runBuiltin = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/cases/samples.json");
      const cases: BatchCase[] = await res.json();
      runBatchCases(cases);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runFiles = async (files: FileList) => {
    setBusy(true);
    setError(null);
    try {
      const cases: BatchCase[] = [];
      for (const f of Array.from(files)) {
        const parsed = JSON.parse(await f.text());
        cases.push(...(Array.isArray(parsed) ? parsed : [parsed]));
      }
      runBatchCases(cases);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 text-xs">
      <div className="flex gap-2 items-center flex-wrap">
        <button onClick={runBuiltin} disabled={busy}
          className="px-3 py-1.5 rounded bg-violet-700 hover:bg-violet-600 text-white disabled:opacity-40">
          运行内置批量用例
        </button>
        <label className="px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100 cursor-pointer">
          导入用例文件并运行
          <input type="file" multiple accept=".json,application/json" className="hidden"
            onChange={(e) => { if (e.target.files?.length) runFiles(e.target.files); e.target.value = ""; }} />
        </label>
        <span className="text-zinc-500">等价命令行入口：npm run batch -- cases/*.json</span>
      </div>
      {error && <div className="text-red-400">{error}</div>}
      {batchReports && (
        <div className="space-y-1">
          <div className="text-zinc-300 font-semibold">
            批量结果：{batchReports.filter((r) => r.ok).length}/{batchReports.length} 通过
          </div>
          {batchReports.map((r, i) => (
            <div key={i} className={`rounded border px-2 py-1.5 ${r.ok ? "border-emerald-800 bg-emerald-950/20" : "border-red-800 bg-red-950/20"}`}>
              <div className={r.ok ? "text-emerald-300" : "text-red-300"}>
                {r.ok ? "✓" : "✗"} {r.caseName}
                {r.stats && (
                  <span className="text-zinc-400 ml-2">
                    共{r.stats.totalEvents} 保留{r.stats.kept} 丢弃{r.stats.dropped} 降采样{r.stats.downsampledOut} 暂存{r.stats.held}
                  </span>
                )}
              </div>
              {r.blockingIssues.map((b, j) => <div key={j} className="text-amber-300 ml-4">阻塞: {b}</div>)}
              {r.invariantReport?.invariants.filter((v) => !v.ok).map((v, j) => (
                <div key={j} className="text-red-300 ml-4">不变量✗ {v.name} {v.detail}</div>
              ))}
              {r.mutations.map((m, j) => (
                <div key={j} className={`ml-4 ${m.ok ? "text-zinc-400" : "text-red-300"}`}>
                  变更{m.ok ? "✓" : "✗"} {m.name}（{m.resumedFromSnapshot ? "增量复用快照" : "全量"}）
                  {m.failures.map((f, k) => <div key={k} className="ml-4 text-red-300">{f}</div>)}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
