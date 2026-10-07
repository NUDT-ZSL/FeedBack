import { useRef, useState } from 'react';
import { useAppStore } from '../store.ts';
import { generateSampleScenario } from '../engine/sample.ts';
import type { ActionKind, Scenario } from '../engine/types.ts';

function download(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

const ACTION_DEFAULT: Record<ActionKind, unknown> = {
  drop: { kind: 'drop', dropRatio: 0.5 },
  downsample: { kind: 'downsample', keepEvery: 2 },
  expand: { kind: 'expand', expandBy: 50 },
  pause: { kind: 'pause', pauseTicks: 10 },
};

export default function ConfigPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const {
    scenario,
    state,
    rateMultipliers,
    replaceScenario,
    mutateScenario,
    setRateMultiplier,
    applyRateMultipliers,
  } = useAppStore();

  const sourceIds = Array.from(
    new Set(scenario.events.map((e) => e.source).concat((scenario.config.sources ?? []).map((s) => s.id))),
  ).sort();

  const importFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as Scenario;
      if (!parsed.config || !Array.isArray(parsed.config.tiers) || !Array.isArray(parsed.events)) {
        throw new Error('缺少 config.tiers 或 events 字段');
      }
      setError('');
      replaceScenario(parsed);
    } catch (e) {
      setError(`导入失败：${(e as Error).message}`);
    }
  };

  const editTier = (tierId: string, patch: Partial<{ rate: number; upThreshold: number; downThreshold: number }>) => {
    mutateScenario((s) => {
      const tier = s.config.tiers.find((t) => t.id === tierId);
      if (tier) Object.assign(tier, patch);
      return s;
    });
  };

  const editActionKind = (tierId: string, kind: ActionKind | 'none') => {
    mutateScenario((s) => {
      const tier = s.config.tiers.find((t) => t.id === tierId);
      if (!tier) return s;
      tier.action = kind === 'none' ? undefined : (ACTION_DEFAULT[kind] as never);
      return s;
    });
  };

  const editActionParam = (tierId: string, key: string, value: number) => {
    mutateScenario((s) => {
      const tier = s.config.tiers.find((t) => t.id === tierId);
      if (tier?.action) Object.assign(tier.action, { [key]: value });
      return s;
    });
  };

  return (
    <div className="space-y-4 text-xs">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-200">数据与配置</h3>
        <div className="grid grid-cols-2 gap-2">
          <button
            className="rounded bg-sky-600 px-2 py-1.5 font-medium text-white hover:bg-sky-500"
            onClick={() => replaceScenario(generateSampleScenario('demo', { sources: 3, durationTicks: 400, seed: 42 }))}
          >
            加载示例场景
          </button>
          <button
            className="rounded border border-slate-600 px-2 py-1.5 text-slate-200 hover:bg-slate-800"
            onClick={() => fileRef.current?.click()}
          >
            导入场景 JSON
          </button>
          <button
            className="rounded border border-slate-600 px-2 py-1.5 text-slate-200 hover:bg-slate-800"
            onClick={() => download(`scenario-${scenario.id}.json`, JSON.stringify(scenario, null, 2))}
          >
            导出场景
          </button>
          <button
            className="rounded border border-slate-600 px-2 py-1.5 text-slate-200 hover:bg-slate-800"
            onClick={() => download(`derive-result-${scenario.id}.json`, JSON.stringify(state.result, null, 2))}
          >
            导出推导结果
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importFile(file);
            e.target.value = '';
          }}
        />
        {error && <div className="rounded border border-rose-500/50 bg-rose-500/10 p-2 text-rose-300">{error}</div>}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-200">消费档位（阈值/速率可改，自动增量重推）</h3>
        <div className="space-y-2">
          {scenario.config.tiers.map((tier) => (
            <div key={tier.id} className="rounded-lg border border-slate-700 bg-slate-900/50 p-2 space-y-1.5">
              <div className="flex items-center justify-between text-slate-200">
                <span className="font-medium">{tier.label ?? tier.id}</span>
                <span className="font-mono text-slate-500">{tier.id}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <label className="flex items-center gap-1 text-slate-400">
                  速率
                  <input
                    type="number"
                    className="w-14 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-slate-200"
                    value={tier.rate}
                    onChange={(e) => editTier(tier.id, { rate: Number(e.target.value) })}
                  />
                </label>
                <label className="flex items-center gap-1 text-slate-400">
                  上阈值
                  <input
                    type="number"
                    className="w-14 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-slate-200"
                    value={tier.upThreshold}
                    onChange={(e) => editTier(tier.id, { upThreshold: Number(e.target.value) })}
                  />
                </label>
                <label className="flex items-center gap-1 text-slate-400">
                  下阈值
                  <input
                    type="number"
                    className="w-14 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-slate-200"
                    value={tier.downThreshold ?? tier.upThreshold}
                    onChange={(e) => editTier(tier.id, { downThreshold: Number(e.target.value) })}
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-slate-400">
                <select
                  className="rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-slate-200"
                  value={tier.action?.kind ?? 'none'}
                  onChange={(e) => editActionKind(tier.id, e.target.value as ActionKind | 'none')}
                >
                  <option value="none">无动作</option>
                  <option value="drop">丢弃 drop</option>
                  <option value="downsample">降采样</option>
                  <option value="expand">缓冲扩容</option>
                  <option value="pause">暂停来源</option>
                </select>
                {tier.action?.kind === 'drop' && (
                  <label className="flex items-center gap-1">
                    比例
                    <input
                      type="number" step={0.1} min={0.01} max={1}
                      className="w-16 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-slate-200"
                      value={tier.action.dropRatio}
                      onChange={(e) => editActionParam(tier.id, 'dropRatio', Number(e.target.value))}
                    />
                  </label>
                )}
                {tier.action?.kind === 'downsample' && (
                  <label className="flex items-center gap-1">
                    每K留1
                    <input
                      type="number" min={2}
                      className="w-14 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-slate-200"
                      value={tier.action.keepEvery}
                      onChange={(e) => editActionParam(tier.id, 'keepEvery', Number(e.target.value))}
                    />
                  </label>
                )}
                {tier.action?.kind === 'expand' && (
                  <label className="flex items-center gap-1">
                    扩容
                    <input
                      type="number" min={1}
                      className="w-16 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-slate-200"
                      value={tier.action.expandBy}
                      onChange={(e) => editActionParam(tier.id, 'expandBy', Number(e.target.value))}
                    />
                  </label>
                )}
                {tier.action?.kind === 'pause' && (
                  <label className="flex items-center gap-1">
                    暂停tick
                    <input
                      type="number" min={1}
                      className="w-16 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-slate-200"
                      value={tier.action.pauseTicks}
                      onChange={(e) => editActionParam(tier.id, 'pauseTicks', Number(e.target.value))}
                    />
                  </label>
                )}
                {tier.allowedNext && (
                  <span className="text-slate-500">显式边：{tier.allowedNext.join(', ')}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-200">来源与到达速率</h3>
        <div className="space-y-1.5">
          {sourceIds.map((source) => {
            const count = scenario.events.filter((e) => e.source === source).length;
            const result = state.result.sources[source];
            const multiplier = rateMultipliers[source] ?? 1;
            return (
              <div key={source} className="rounded-lg border border-slate-700 bg-slate-900/50 p-2">
                <div className="flex items-center justify-between text-slate-200">
                  <span className="font-medium">{source}</span>
                  <span className="text-slate-500">{count} 事件</span>
                </div>
                {result && (
                  <div className="mt-0.5 text-slate-500">
                    消费 {result.stats.consumed} · 丢弃 {result.stats.dropped} · 滞留 {result.stats.pending}
                  </div>
                )}
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className="text-slate-400">速率倍率</span>
                  <input
                    type="number" step={0.1} min={0.1}
                    className="w-16 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-slate-200"
                    value={multiplier}
                    onChange={(e) => setRateMultiplier(source, Number(e.target.value))}
                  />
                  <button
                    className="rounded bg-slate-700 px-2 py-0.5 text-slate-100 hover:bg-slate-600"
                    onClick={applyRateMultipliers}
                  >
                    应用并重推
                  </button>
                  <span className="text-slate-600">（时刻 / 倍率）</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-200">推演参数</h3>
        <div className="flex flex-wrap gap-2 text-slate-400">
          <label className="flex items-center gap-1">
            分块大小
            <input
              type="number" min={1}
              className="w-16 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-slate-200"
              value={scenario.config.blockSize ?? 64}
              onChange={(e) =>
                mutateScenario((s) => {
                  s.config.blockSize = Number(e.target.value);
                  return s;
                })
              }
            />
          </label>
          <label className="flex items-center gap-1">
            时间轴
            <input
              type="number" min={1}
              className="w-20 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-slate-200"
              value={scenario.config.horizon ?? state.result.horizon}
              onChange={(e) =>
                mutateScenario((s) => {
                  s.config.horizon = Number(e.target.value);
                  return s;
                })
              }
            />
          </label>
        </div>
      </div>
    </div>
  );
}
