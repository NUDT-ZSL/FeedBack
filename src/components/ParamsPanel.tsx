import { useBackpressureStore } from '@/state/store';
import type { EngineParams } from '@/engine';

const FIELDS: { key: keyof Omit<EngineParams, 'version'>; label: string; hint: string }[] = [
  { key: 'tickMs', label: '区间长度 tickMs', hint: '毫秒' },
  { key: 'consumeRate', label: '消费速率', hint: '单位/区间' },
  { key: 'highThreshold', label: '触发阈值', hint: '积压高于此值开启背压' },
  { key: 'lowThreshold', label: '解除阈值', hint: '积压回落至此值（含）解除' },
  { key: 'burstLimit', label: '突发上限', hint: '单区间准入上限，超出顺延' },
];

export default function ParamsPanel() {
  const { params, setParams } = useBackpressureStore();

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/80 p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-200">
        背压参数 <span className="text-xs font-normal text-slate-500">v{params.version}</span>
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FIELDS.map(({ key, label, hint }) => (
          <label key={key} className="block">
            <span className="mb-1 block text-xs text-slate-400">
              {label}
              <span className="ml-1 text-slate-600">{hint}</span>
            </span>
            <input
              type="number"
              value={params[key]}
              onChange={(event) => setParams({ [key]: Number(event.target.value) })}
              className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
            />
          </label>
        ))}
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">
        仅调整阈值时积压曲线零重推；调整消费速率/突发上限/区间长度从受影响区间起重推，后缀状态重合即复用。
      </p>
    </div>
  );
}
