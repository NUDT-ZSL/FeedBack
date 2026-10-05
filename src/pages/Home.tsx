import { useRef, useState } from 'react';
import BacklogCurve from '@/components/BacklogCurve';
import ConflictPanel from '@/components/ConflictPanel';
import DecisionList from '@/components/DecisionList';
import ParamForm from '@/components/ParamForm';
import { BackpressureEngine } from '@/engine/engine';
import { generateEvents, makeConflictPair } from '@/engine/sampleData';
import type { ConflictGroup, EngineResult, Params } from '@/engine/types';

/** 剥离血缘/复用标记后对比两条重推路径的结论本体 */
const stripLineage = (key: string, value: unknown) =>
  key === 'reusedFromCache' || key === 'basis' ? undefined : value;

export default function Home() {
  const engineRef = useRef<BackpressureEngine | null>(null);
  if (!engineRef.current) {
    const engine = new BackpressureEngine({ consumeRate: 6, threshold: 25, burstLimit: 30 });
    engine.store.ingest(generateEvents());
    engineRef.current = engine;
  }
  const engine = engineRef.current;

  const [result, setResult] = useState<EngineResult>(() => engine.compute());
  const [groups, setGroups] = useState<ConflictGroup[]>(() => engine.store.allGroups());
  const [checkMsg, setCheckMsg] = useState<string | null>(null);
  const [burstSeed, setBurstSeed] = useState(1);

  const refresh = () => {
    setResult(engine.compute());
    setGroups([...engine.store.allGroups()]);
  };

  const applyParams = (params: Params, fromTime: number) => {
    engine.setParams(params, fromTime);
    refresh();
  };

  const injectConflict = () => {
    const time = 10 + Math.floor(Math.random() * 100);
    engine.store.ingest(makeConflictPair('sensor-x', time, `cx${burstSeed}`));
    setBurstSeed((s) => s + 1);
    refresh();
  };

  const injectBurst = () => {
    const t = 20 + Math.floor(Math.random() * 80);
    const events = Array.from({ length: 12 }, (_, i) => ({
      id: `b${burstSeed}-${i}`,
      source: 'burst-src',
      time: t + i * 0.2,
      size: 15,
      payload: `burst-${burstSeed}-${i}`,
    }));
    engine.store.ingest(events);
    setBurstSeed((s) => s + 1);
    refresh();
  };

  const adjudicate = (groupId: string, eventId: string) => {
    engine.store.adjudicate(groupId, eventId);
    refresh();
  };

  const runConsistencyCheck = () => {
    const inc = JSON.stringify(engine.compute(), stripLineage);
    const full = JSON.stringify(engine.fullRecompute(), stripLineage);
    setCheckMsg(
      inc === full
        ? `一致 ✓ 逐区间重推与整体重推的积压曲线、触发时刻与处置结论完全相同（${engine.compute().intervals.length} 个区间）`
        : '不一致 ✗ 两条路径结果存在差异',
    );
    refresh();
  };

  const reused = result.intervals.filter((r) => r.reusedFromCache).length;
  const progress = result.totalArrived > 0 ? result.totalConsumed / result.totalArrived : 1;
  const backpressureActive =
    result.intervals.length > 0 && result.intervals[result.intervals.length - 1].backpressureActiveOut;

  return (
    <div className="min-h-screen bg-slate-50 p-6 text-slate-800">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-semibold">离线事件流背压调节</h1>
            <p className="text-xs text-slate-500">
              事件v{result.eventVersion} · 参数v{result.paramsVersion} · 本次重推复用 {reused}/
              {result.intervals.length} 个区间
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="rounded border border-slate-300 bg-white px-3 py-1 text-xs hover:bg-slate-100"
              onClick={injectBurst}
            >
              注入突发流量
            </button>
            <button
              className="rounded border border-slate-300 bg-white px-3 py-1 text-xs hover:bg-slate-100"
              onClick={injectConflict}
            >
              注入冲突事件
            </button>
            <button
              className="rounded bg-emerald-600 px-3 py-1 text-xs text-white hover:bg-emerald-700"
              onClick={runConsistencyCheck}
            >
              校验：增量 vs 整体
            </button>
          </div>
        </header>

        {checkMsg && (
          <div
            className={`rounded border px-3 py-2 text-sm ${
              checkMsg.startsWith('一致')
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                : 'border-red-300 bg-red-50 text-red-800'
            }`}
          >
            {checkMsg}
          </div>
        )}

        <section className="grid grid-cols-4 gap-3">
          <Stat label="当前积压" value={result.currentBacklog.toFixed(1)} />
          <Stat label="总到达" value={String(result.totalArrived)} />
          <Stat label="已消费" value={result.totalConsumed.toFixed(1)} />
          <Stat
            label="背压状态"
            value={backpressureActive ? '已触发' : '正常'}
            tone={backpressureActive ? 'bad' : 'ok'}
          />
        </section>

        <section className="rounded border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">积压曲线</span>
            <span className="text-xs text-slate-500">消费进度 {(progress * 100).toFixed(1)}%</span>
          </div>
          <div className="mb-2 h-1.5 w-full overflow-hidden rounded bg-slate-100">
            <div className="h-full bg-blue-500" style={{ width: `${progress * 100}%` }} />
          </div>
          <BacklogCurve result={result} params={engine.currentParams} />
          <p className="mt-1 text-xs text-slate-400">
            ▲ 触发 · ● 解除 · ◆ 突发越限 · 黄色区域为待裁决区间（暂缓结论）
          </p>
        </section>

        <div className="grid grid-cols-3 gap-4">
          <section className="rounded border border-slate-200 bg-white p-3">
            <h2 className="mb-2 text-sm font-medium">参数调整</h2>
            <ParamForm params={engine.currentParams} onApply={applyParams} />
          </section>
          <section className="rounded border border-slate-200 bg-white p-3">
            <h2 className="mb-2 text-sm font-medium">重复 / 冲突事件</h2>
            <ConflictPanel groups={groups} onAdjudicate={adjudicate} />
          </section>
          <section className="rounded border border-slate-200 bg-white p-3">
            <h2 className="mb-2 text-sm font-medium">背压决策（含依据）</h2>
            <DecisionList decisions={result.decisions} />
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'bad' }) {
  const color = tone === 'bad' ? 'text-red-600' : tone === 'ok' ? 'text-emerald-600' : 'text-slate-800';
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}
