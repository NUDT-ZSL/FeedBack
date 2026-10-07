import BacklogChart from '../components/BacklogChart.tsx';
import BatchPanel from '../components/BatchPanel.tsx';
import ConfigPanel from '../components/ConfigPanel.tsx';
import EventTable from '../components/EventTable.tsx';
import IssueList from '../components/IssueList.tsx';
import SwitchLog from '../components/SwitchLog.tsx';
import { useAppStore } from '../store.ts';

export default function Home() {
  const {
    scenario,
    state,
    selectedSource,
    timeRange,
    selectedSwitchId,
    dispositionFilter,
    setSelectedSource,
    setTimeRange,
    setSelectedSwitch,
    setDispositionFilter,
    addAdjudication,
  } = useAppStore();

  const result = state.result;
  const sourceNames = Object.keys(result.sources).sort();
  const incremental = result.incremental;
  const errorCount = result.issues.filter((i) => i.severity === 'error').length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <header className="border-b border-slate-800 bg-slate-900/60 px-4 py-3">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold">背压分级处置推演台</h1>
            <p className="text-xs text-slate-400">
              场景 {scenario.id} · {scenario.events.length} 条输入事件 · 时间轴 [0, {result.horizon}] ·{' '}
              {result.switches.length} 次档位切换
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            {incremental && (
              <span className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-400">
                增量推导：复用块 {incremental.reusedBlocks} / 重算块 {incremental.recomputedBlocks}
                {incremental.affectedSources.length > 0 && (
                  <> · 受影响 {incremental.affectedSources.join(', ')} 自 t={incremental.affectedFromTick}</>
                )}
              </span>
            )}
            <span
              className={`rounded border px-2 py-1 ${
                result.issues.length === 0
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : errorCount > 0
                    ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
              }`}
            >
              输入问题 {result.issues.length}（错误 {errorCount}）
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1600px] grid-cols-1 gap-4 p-4 xl:grid-cols-[320px_1fr_360px]">
        <aside className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
          <ConfigPanel />
        </aside>

        <section className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-slate-200">积压曲线</span>
              <select
                className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-200"
                value={selectedSource}
                onChange={(e) => setSelectedSource(e.target.value)}
              >
                <option value="all">全部来源（聚合）</option>
                {sourceNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <div className="flex items-center gap-1 text-slate-400">
                区间
                <input
                  type="number"
                  className="w-20 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-slate-200"
                  value={timeRange?.[0] ?? 0}
                  onChange={(e) => setTimeRange([Number(e.target.value), timeRange?.[1] ?? result.horizon])}
                />
                —
                <input
                  type="number"
                  className="w-20 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-slate-200"
                  value={timeRange?.[1] ?? result.horizon}
                  onChange={(e) => setTimeRange([timeRange?.[0] ?? 0, Number(e.target.value)])}
                />
                <button
                  className="rounded border border-slate-600 px-2 py-0.5 hover:bg-slate-800"
                  onClick={() => setTimeRange(null)}
                >
                  全程
                </button>
              </div>
              <select
                className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-200"
                value={dispositionFilter}
                onChange={(e) => setDispositionFilter(e.target.value as never)}
              >
                <option value="all">全部结论</option>
                <option value="kept">仅保留</option>
                <option value="dropped">仅丢弃</option>
                <option value="consumed">仅已消费</option>
              </select>
            </div>
            <BacklogChart
              sources={result.sources}
              selectedSource={selectedSource}
              tiers={scenario.config.tiers}
              switches={
                selectedSource === 'all'
                  ? result.switches
                  : result.switches.filter((sw) => sw.source === selectedSource)
              }
              horizon={result.horizon}
              timeRange={timeRange}
              selectedSwitchId={selectedSwitchId}
              onSelectSwitch={setSelectedSwitch}
              onSelectRange={setTimeRange}
            />
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 space-y-2">
            <h2 className="text-sm font-semibold text-slate-200">档位切换记录（含触发依据与受影响区间）</h2>
            <SwitchLog
              switches={result.switches}
              tiers={scenario.config.tiers}
              selectedSource={selectedSource}
              timeRange={timeRange}
              selectedSwitchId={selectedSwitchId}
              onSelectSwitch={setSelectedSwitch}
              onAdjudicate={(source, tick, chosenTierId, reason) =>
                addAdjudication({ source, tick, chosenTierId, reason })
              }
            />
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 space-y-2">
            <h2 className="text-sm font-semibold text-slate-200">事件处置结论（点击行查看决策链）</h2>
            <EventTable
              sources={result.sources}
              switches={result.switches}
              selectedSource={selectedSource}
              timeRange={timeRange}
              dispositionFilter={dispositionFilter}
            />
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 space-y-2">
            <h2 className="text-sm font-semibold text-slate-200">输入校验与异常</h2>
            <IssueList issues={result.issues} />
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 space-y-2">
            <h2 className="text-sm font-semibold text-slate-200">批量验证（离线自洽性核对）</h2>
            <BatchPanel />
          </div>
        </aside>
      </main>
    </div>
  );
}
