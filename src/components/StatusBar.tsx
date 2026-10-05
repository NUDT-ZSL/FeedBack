import { CheckCircle2, XCircle } from 'lucide-react';
import { SAMPLES } from '@/engine';
import type { SampleKey } from '@/engine';
import { useBackpressureStore } from '@/state/store';

const SAMPLE_KEYS = Object.keys(SAMPLES) as SampleKey[];

export default function StatusBar() {
  const { check, derivation, eventSet, params, sample, loadSample, injectPair } =
    useBackpressureStore();

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/80 p-4">
      <div className="flex flex-wrap items-center gap-3">
        {check.equal ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-medium text-emerald-300">
            <CheckCircle2 size={16} />
            逐区间重推 ≡ 整体重推（曲线 / 触发时刻 / 处置结论一致）
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-2 rounded-full bg-red-500/15 px-3 py-1 text-sm font-medium text-red-300"
            title={check.reason}
          >
            <XCircle size={16} />
            两条路径结果不一致：{check.reason}
          </span>
        )}
        <span className="text-xs text-slate-400">
          重推区间 {derivation.stats.rederivedTicks} · 复用区间 {derivation.stats.reusedTicks} ·
          峰值积压 {derivation.stats.peakBacklog} @#{derivation.stats.peakTick} ·
          事件集 v{eventSet.version} · 参数 v{params.version}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {SAMPLE_KEYS.map((key) => (
          <button
            key={key}
            onClick={() => loadSample(key)}
            className={`rounded border px-3 py-1 text-xs ${
              sample === key
                ? 'border-cyan-400 bg-cyan-400/10 text-cyan-200'
                : 'border-slate-600 text-slate-300 hover:border-slate-400'
            }`}
          >
            {SAMPLES[key].name}
          </button>
        ))}
        <button
          onClick={() => injectPair('duplicate')}
          className="rounded border border-amber-600 px-3 py-1 text-xs text-amber-300 hover:bg-amber-600/10"
        >
          注入重复事件
        </button>
        <button
          onClick={() => injectPair('conflict')}
          className="rounded border border-orange-600 px-3 py-1 text-xs text-orange-300 hover:bg-orange-600/10"
        >
          注入冲突事件
        </button>
      </div>
    </div>
  );
}
