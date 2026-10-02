import { useState } from 'react';
import { useWorkshop } from '@/hooks/useWorkshop';
import {
  LIMITS,
  recipeTotal,
  STAGE_LABELS,
  STAGE_ORDER,
  type Operation,
  type Recipe,
  type StageId,
} from '@/simulation';

function StageBadge({ done }: { done: boolean }) {
  return (
    <span className={`ml-1 inline-block h-2 w-2 rounded-full ${done ? 'bg-green-500' : 'bg-gray-300'}`} />
  );
}

function NumberField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-gray-600">{label}</span>
      <input
        type="number"
        className="rounded border border-gray-300 px-2 py-1 disabled:bg-gray-100"
        value={Number.isFinite(value) ? value : ''}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export default function Home() {
  const { recipe, setRecipe, state, started, apply, start, reset, history, saveRecord } =
    useWorkshop();
  const [duration, setDuration] = useState(60);
  const [scoops, setScoops] = useState(3);
  const [force, setForce] = useState(50);
  const [ticks, setTicks] = useState(5);
  const [points, setPoints] = useState(5);

  const total = recipeTotal(recipe);
  const totalOutOfRange = total < LIMITS.RECIPE_TOTAL_MIN || total > LIMITS.RECIPE_TOTAL_MAX;
  const completed = new Set<StageId>(state?.completed ?? []);
  const inter = state?.intermediates;
  const dryComplete = (inter?.dryness ?? 0) >= LIMITS.DRY_TARGET;

  const dispatch = (operation: Operation) => apply(operation);

  const stageEnabled = (stage: StageId): boolean => {
    if (!state) return false;
    if (completed.has(stage)) return false;
    if (stage === 'dry') return completed.has('press');
    const expected = STAGE_ORDER.find((s) => !completed.has(s));
    return expected === stage;
  };

  return (
    <div className="min-h-screen bg-[#f0f0f0] p-4 md:p-6">
      <div className="mx-auto max-w-6xl">
        <header className="mb-4 flex items-center justify-between rounded-lg bg-[#2c3e50] px-5 py-3 text-white">
          <h1 className="text-lg font-semibold">造纸作坊 · 生产推演台</h1>
          <div className="flex gap-2">
            {started ? (
              <button
                onClick={reset}
                className="rounded px-3 py-1 text-sm transition-colors hover:bg-white/20"
              >
                重新配料
              </button>
            ) : (
              <button
                onClick={start}
                className="rounded bg-white/10 px-3 py-1 text-sm transition-colors hover:bg-white/25"
              >
                开始生产
              </button>
            )}
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-3 font-semibold">配料单</h2>
            <div className="grid grid-cols-3 gap-3">
              <NumberField label="树皮 (kg)" value={recipe.bark} disabled={started} onChange={(v) => setRecipe((r: Recipe) => ({ ...r, bark: v }))} />
              <NumberField label="竹浆 (kg)" value={recipe.bamboo} disabled={started} onChange={(v) => setRecipe((r: Recipe) => ({ ...r, bamboo: v }))} />
              <NumberField label="水 (kg)" value={recipe.water} disabled={started} onChange={(v) => setRecipe((r: Recipe) => ({ ...r, water: v }))} />
            </div>
            <p className={`mt-2 text-sm ${totalOutOfRange ? 'text-red-600' : 'text-gray-600'}`}>
              配料总量：{total} kg（合理区间 {LIMITS.RECIPE_TOTAL_MIN}–{LIMITS.RECIPE_TOTAL_MAX}）
            </p>

            <h2 className="mb-3 mt-5 font-semibold">工序操作</h2>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="w-14">
                  配料
                  <StageBadge done={completed.has('mix')} />
                </span>
                <input
                  type="number"
                  min={0}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-28 rounded border border-gray-300 px-2 py-1"
                />
                <button
                  disabled={!stageEnabled('mix')}
                  onClick={() => dispatch({ type: 'mix', duration })}
                  className="flex-1 rounded bg-[#4A90D9] px-3 py-1 text-white disabled:bg-gray-300"
                >
                  开始搅拌
                </button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="w-14">
                  抄纸
                  <StageBadge done={completed.has('form')} />
                </span>
                <input
                  type="number"
                  min={1}
                  value={scoops}
                  onChange={(e) => setScoops(Number(e.target.value))}
                  className="w-28 rounded border border-gray-300 px-2 py-1"
                />
                <button
                  disabled={!stageEnabled('form')}
                  onClick={() => dispatch({ type: 'form', scoops })}
                  className="flex-1 rounded bg-[#4A90D9] px-3 py-1 text-white disabled:bg-gray-300"
                >
                  入槽抄纸
                </button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="w-14">
                  压榨
                  <StageBadge done={completed.has('press')} />
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={force}
                  onChange={(e) => setForce(Number(e.target.value))}
                  className="w-28"
                />
                <span className="w-12 text-center text-xs text-gray-500">{force}</span>
                <button
                  disabled={!stageEnabled('press')}
                  onClick={() => dispatch({ type: 'press', force })}
                  className="flex-1 rounded bg-[#4A90D9] px-3 py-1 text-white disabled:bg-gray-300"
                >
                  压榨（{LIMITS.PRESS_FORCE_MIN}–{LIMITS.PRESS_FORCE_MAX}）
                </button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="w-14">
                  晾晒
                  <StageBadge done={completed.has('dry')} />
                </span>
                <input
                  type="number"
                  min={1}
                  value={ticks}
                  onChange={(e) => setTicks(Number(e.target.value))}
                  className="w-28 rounded border border-gray-300 px-2 py-1"
                />
                <button
                  disabled={!stageEnabled('dry')}
                  onClick={() => dispatch({ type: 'dry', ticks })}
                  className="flex-1 rounded bg-[#4A90D9] px-3 py-1 text-white disabled:bg-gray-300"
                >
                  推进晾晒{dryComplete ? '（已完成）' : ''}
                </button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="w-14">
                  检验
                  <StageBadge done={completed.has('inspect')} />
                </span>
                <select
                  value={points}
                  onChange={(e) => setPoints(Number(e.target.value))}
                  className="w-28 rounded border border-gray-300 px-2 py-1"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={n}>
                      {n} 个检验点
                    </option>
                  ))}
                </select>
                <button
                  disabled={!state || completed.has('inspect') || !completed.has('press')}
                  onClick={() => dispatch({ type: 'inspect', points })}
                  className="flex-1 rounded bg-[#e67e22] px-3 py-1 text-white disabled:bg-gray-300"
                >
                  提交检验
                </button>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <h2 className="mb-3 font-semibold">中间量（纯推演层输出）</h2>
              <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
                {[
                  ['配料浓度', inter?.concentration ?? null],
                  ['均匀度', inter?.uniformity ?? null],
                  ['压榨力度', inter?.pressForce ?? null],
                  ['干燥进度', inter ? `${inter.dryness}%` : null],
                  ['检验得分', inter?.inspectScore ?? null],
                  ['压榨是否有效', inter ? (inter.pressEffective ? '有效' : '无效') : null],
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded-lg bg-gray-50 px-3 py-2">
                    <div className="text-xs text-gray-500">{label}</div>
                    <div className="font-mono text-base font-semibold">{value ?? '—'}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-semibold">最终结论</h2>
                {state?.conclusion && (
                  <button
                    onClick={saveRecord}
                    className="rounded bg-green-600 px-3 py-1 text-xs text-white hover:bg-green-700"
                  >
                    保存本批记录
                  </button>
                )}
              </div>
              {state?.conclusion ? (
                <div>
                  <div className="flex items-baseline gap-3">
                    <span className="text-3xl font-bold text-[#2c3e50]">
                      {state.conclusion.rating}
                    </span>
                    <span className="text-sm text-gray-500">
                      得分 {state.conclusion.score ?? '—'} ·{' '}
                      {state.conclusion.valid ? '结论有效' : '结论无效'}
                    </span>
                  </div>
                  {state.conclusion.reasons.length > 0 && (
                    <ul className="mt-2 list-inside list-disc text-xs text-gray-600">
                      {state.conclusion.reasons.map((reason, i) => (
                        <li key={i}>{reason}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-400">检验完成后给出评级与推导依据</p>
              )}
            </div>

            <div className="rounded-xl bg-white p-4 shadow-sm">
              <h2 className="mb-2 font-semibold">事件与边界记录</h2>
              {state && state.events.length > 0 ? (
                <ul className="max-h-48 space-y-1 overflow-auto text-xs">
                  {state.events.map((event, i) => (
                    <li key={i} className="rounded bg-amber-50 px-2 py-1 text-amber-800">
                      <span className="font-mono">[{STAGE_LABELS[event.stage]} / {event.code}]</span>{' '}
                      {event.message}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-gray-400">暂无边界事件</p>
              )}
            </div>
          </section>
        </div>

        <section className="mt-4 rounded-xl bg-white p-4 shadow-sm">
          <h2 className="mb-2 font-semibold">历史记录（含旧版迁移数据）</h2>
          {history.length === 0 ? (
            <p className="text-xs text-gray-400">暂无记录</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {history.map((record) => (
                <li key={record.id} className="flex items-center gap-3 rounded bg-gray-50 px-3 py-2">
                  <span className="w-32 text-gray-500">{new Date(record.createdAt).toLocaleString()}</span>
                  <span className="font-semibold text-[#2c3e50]">{record.conclusion.rating}</span>
                  <span className="font-mono">得分 {record.conclusion.score ?? '—'}</span>
                  <span className="text-gray-500">
                    配料 树皮{record.recipe.bark}/竹浆{record.recipe.bamboo}/水{record.recipe.water}
                  </span>
                  {record.operations.length === 0 && (
                    <span className="rounded bg-gray-200 px-1.5 py-0.5 text-gray-600">旧版迁移</span>
                  )}
                  {!record.conclusion.valid && (
                    <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700">无效批次</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
