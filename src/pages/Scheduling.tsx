import { useMemo, useState } from 'react'
import {
  reschedule,
  sampleInput,
  schedule,
} from '@/lib/scheduling'
import type {
  Allocation,
  ScheduleInput,
  ScheduleResult,
} from '@/lib/scheduling'

function fmtMin(t: number): string {
  const day = Math.floor(t / 1440)
  const within = t - day * 1440
  const hh = String(Math.floor(within / 60)).padStart(2, '0')
  const mm = String(within % 60).padStart(2, '0')
  return `D${day} ${hh}:${mm}`
}

function sameOutcome(a: ScheduleResult, b: ScheduleResult): boolean {
  return (
    JSON.stringify(a.allocations) === JSON.stringify(b.allocations) &&
    JSON.stringify(a.loomPlans) === JSON.stringify(b.loomPlans) &&
    JSON.stringify(a.completions) === JSON.stringify(b.completions) &&
    JSON.stringify(a.conflicts) === JSON.stringify(b.conflicts)
  )
}

const badgeClass: Record<string, string> = {
  full: 'bg-amber-100 text-amber-800 border-amber-300',
  incremental: 'bg-green-100 text-green-800 border-green-300',
  'violations-only': 'bg-blue-100 text-blue-800 border-blue-300',
  unchanged: 'bg-stone-100 text-stone-700 border-stone-300',
}

const modeLabel: Record<string, string> = {
  full: '整体重算',
  incremental: '局部重算',
  'violations-only': '仅重估裁决',
  unchanged: '无变化',
}

export default function Scheduling() {
  const [input, setInput] = useState<ScheduleInput>(() => sampleInput())
  const [result, setResult] = useState<ScheduleResult | null>(null)
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null)

  const loomName = useMemo(() => {
    const map = new Map(input.looms.map((l) => [l.id, l.name]))
    return (id: string) => map.get(id) ?? id
  }, [input])
  const orderName = useMemo(() => {
    const map = new Map(input.orders.map((o) => [o.id, o.name]))
    return (id: string) => map.get(id) ?? id
  }, [input])
  const opName = useMemo(() => {
    const map = new Map<string, string>()
    for (const o of input.orders) for (const op of o.operations) map.set(op.id, `${o.name}·${op.name}`)
    return (id: string) => map.get(id) ?? id
  }, [input])

  const runFull = () => {
    setResult(schedule(JSON.parse(JSON.stringify(input))))
    setCheck(null)
  }

  const runIncremental = () => {
    if (!result) return
    setResult(reschedule(result, JSON.parse(JSON.stringify(input))))
    setCheck(null)
  }

  const runConsistencyCheck = () => {
    const base = result ?? schedule(JSON.parse(JSON.stringify(input)))
    const nextInput = JSON.parse(JSON.stringify(input))
    const incrementalResult = reschedule(base, nextInput)
    const fullResult = schedule(nextInput)
    const ok = sameOutcome(incrementalResult, fullResult)
    setResult(incrementalResult)
    setCheck({
      ok,
      text: ok
        ? `一致：局部重算 ${incrementalResult.meta.recomputedOperationIds.length} 道、复用 ${incrementalResult.meta.reusedOperationIds.length} 道工序，结果与整体重算相同`
        : '不一致：局部重算与整体重算结果存在差异',
    })
  }

  const updateLoomEfficiency = (id: string, value: number) => {
    setInput((prev) => ({
      ...prev,
      looms: prev.looms.map((l) => (l.id === id ? { ...l, efficiency: value } : l)),
    }))
  }

  const updateOpMinutes = (orderId: string, opId: string, value: number) => {
    setInput((prev) => ({
      ...prev,
      orders: prev.orders.map((o) =>
        o.id !== orderId
          ? o
          : {
              ...o,
              operations: o.operations.map((op) =>
                op.id === opId ? { ...op, baseMinutes: value } : op,
              ),
            },
      ),
    }))
  }

  return (
    <div className="min-h-screen bg-[#fdf5e6] text-stone-800">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-[#6b4e3a]">织造排产与工时推演</h1>
          <p className="mt-1 text-sm text-stone-600">
            界面与 HTTP / CLI 共用同一离线推演引擎：同一批输入在任何入口得到相同的织机占用顺序、订单完成时刻与冲突裁决。
            原点 {input.originDate}，时刻形如 D1 08:00。
          </p>
        </header>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <button
            onClick={runFull}
            className="rounded-md border border-[#8b6f47] bg-[#8b6f47] px-4 py-2 text-sm font-medium text-[#fdf5e6] transition hover:scale-105"
          >
            整体推演
          </button>
          <button
            onClick={runIncremental}
            disabled={!result}
            className="rounded-md border border-[#8b6f47] bg-[#fdf5e6] px-4 py-2 text-sm font-medium text-[#6b4e3a] transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40"
          >
            参数修正后局部重算
          </button>
          <button
            onClick={runConsistencyCheck}
            className="rounded-md border border-[#6b4e3a] bg-[#6b4e3a] px-4 py-2 text-sm font-medium text-[#fdf5e6] transition hover:scale-105"
          >
            一致性校验（局部 vs 整体）
          </button>
          {result && (
            <span
              className={`rounded-full border px-3 py-1 text-xs ${badgeClass[result.meta.mode] ?? ''}`}
            >
              {modeLabel[result.meta.mode] ?? result.meta.mode}
            </span>
          )}
        </div>

        {check && (
          <div
            className={`mb-4 rounded-md border px-4 py-2 text-sm ${
              check.ok
                ? 'border-green-300 bg-green-50 text-green-800'
                : 'border-red-300 bg-red-50 text-red-800'
            }`}
          >
            {check.ok ? '✓ ' : '✗ '}
            {check.text}
          </div>
        )}

        {result && (
          <div className="mb-4 rounded-md border border-[#cbb89a] bg-white/70 px-4 py-2 text-xs text-stone-600">
            {result.meta.reason}
            {result.meta.horizonMin !== undefined && (
              <>；受影响时间段起点 {fmtMin(result.meta.horizonMin)}</>
            )}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-[#6b4e3a]">参数（可修正）</h2>
            <div className="rounded-lg border border-[#cbb89a] bg-white/80 p-4">
              <h3 className="mb-2 text-sm font-semibold">织机效率</h3>
              <div className="space-y-2">
                {input.looms.map((loom) => (
                  <label key={loom.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>{loom.name}</span>
                    <input
                      type="number"
                      step="0.05"
                      min="0.1"
                      className="w-24 rounded border border-stone-300 px-2 py-1 text-right"
                      value={loom.efficiency}
                      onChange={(e) => updateLoomEfficiency(loom.id, Number(e.target.value))}
                    />
                  </label>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-[#cbb89a] bg-white/80 p-4">
              <h3 className="mb-2 text-sm font-semibold">工序标准工时（分钟）</h3>
              <div className="space-y-3">
                {input.orders.map((order) => (
                  <div key={order.id}>
                    <div className="text-xs font-semibold text-stone-500">
                      {order.name}（优先级 {order.priority}
                      {order.dueMin !== undefined ? `，交付 ${fmtMin(order.dueMin)}` : ''}）
                    </div>
                    <div className="mt-1 space-y-1">
                      {[...order.operations]
                        .sort((a, b) => a.sequence - b.sequence)
                        .map((op) => (
                          <label
                            key={op.id}
                            className="flex items-center justify-between gap-2 text-sm"
                          >
                            <span className="text-stone-600">
                              {op.sequence}. {op.name}
                              {op.pinned ? ' 〔固定指派〕' : ''}
                            </span>
                            <input
                              type="number"
                              min="0"
                              className="w-24 rounded border border-stone-300 px-2 py-1 text-right"
                              value={op.baseMinutes}
                              onChange={(e) =>
                                updateOpMinutes(order.id, op.id, Number(e.target.value))
                              }
                            />
                          </label>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="space-y-4">
            {!result && (
              <div className="rounded-lg border border-dashed border-[#8b6f47] bg-white/50 p-10 text-center text-sm text-stone-500">
                点击「整体推演」开始排产与工时推演。
              </div>
            )}

            {result && (
              <>
                <div>
                  <h2 className="mb-2 text-lg font-semibold text-[#6b4e3a]">织机占用顺序</h2>
                  <div className="grid gap-3 md:grid-cols-3">
                    {Object.entries(result.loomPlans).map(([loomId, plan]) => (
                      <div key={loomId} className="rounded-lg border border-[#cbb89a] bg-white/80 p-3">
                        <h3 className="mb-2 text-sm font-semibold">{loomName(loomId)}</h3>
                        <ol className="space-y-1">
                          {plan.map((alloc: Allocation) => (
                            <li key={alloc.operationId} className="text-xs leading-relaxed">
                              <span className="font-medium">{opName(alloc.operationId)}</span>
                              <div className="text-stone-500">
                                {fmtMin(alloc.startMin)} → {fmtMin(alloc.endMin)}
                                <span className="ml-1">（工时 {alloc.workMinutes} 分）</span>
                              </div>
                            </li>
                          ))}
                        </ol>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h2 className="mb-2 text-lg font-semibold text-[#6b4e3a]">订单完成时刻</h2>
                  <div className="overflow-hidden rounded-lg border border-[#cbb89a]">
                    <table className="w-full bg-white/80 text-sm">
                      <thead className="bg-[#8b6f47] text-[#fdf5e6]">
                        <tr>
                          <th className="px-3 py-2 text-left">订单</th>
                          <th className="px-3 py-2 text-left">完成时刻</th>
                          <th className="px-3 py-2 text-left">交付时刻</th>
                          <th className="px-3 py-2 text-left">裁决</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.completions.map((c) => (
                          <tr key={c.orderId} className="border-t border-[#e8dcc8]">
                            <td className="px-3 py-2">{orderName(c.orderId)}</td>
                            <td className="px-3 py-2">{fmtMin(c.completedMin)}</td>
                            <td className="px-3 py-2">
                              {c.dueMin !== undefined ? fmtMin(c.dueMin) : '—'}
                            </td>
                            <td className="px-3 py-2">
                              {c.late ? (
                                <span className="text-red-700">逾期 {c.delayMin} 分（保留，见依据）</span>
                              ) : (
                                <span className="text-green-700">按期</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h2 className="mb-2 text-lg font-semibold text-[#6b4e3a]">冲突裁决与依据</h2>
                  {result.conflicts.length === 0 ? (
                    <div className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800">
                      无冲突。
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {result.conflicts.map((c) => (
                        <li key={c.id} className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
                          <div className="font-medium text-amber-900">{c.summary}</div>
                          <div className="mt-1 text-xs text-stone-600">
                            保留：{c.kept.map((id) => opName(id) || orderName(id)).join('、')}
                          </div>
                          <pre className="mt-2 overflow-x-auto rounded bg-white/70 p-2 text-[11px] text-stone-700">
                            {JSON.stringify(c.evidence, null, 2)}
                          </pre>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
