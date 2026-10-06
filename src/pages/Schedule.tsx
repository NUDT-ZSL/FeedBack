/**
 * 排产与工时推演页面（薄界面层）：
 * 只读样例数据、调用统一管线（runScheduleViaUi / recomputeViaUi）、
 * 渲染织机占用顺序、订单完成时刻、冲突裁决与依据，不内嵌任何排产规则。
 */
import { useMemo, useState } from 'react'
import {
  applyRevision,
  isoToMinute,
  recomputeViaUi,
  runScheduleViaUi,
  sampleInput,
} from '@/scheduling'
import type { ScheduleResult, ScheduleRevision } from '@/scheduling'

const ORDER_COLORS: Record<string, string> = {
  O1: '#c0392b',
  O2: '#2c3e50',
  O3: '#7d8a6b',
  O4: '#b87333',
}

function formatAt(iso: string | null): string {
  if (!iso) return '未排产'
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate(),
  )} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
}

export default function Schedule() {
  // 界面路径：与离线脚本、HTTP 服务调用的是同一份引擎。
  const baseResult = useMemo(() => runScheduleViaUi(sampleInput), [])

  const [loomId, setLoomId] = useState(sampleInput.looms[2].id)
  const [efficiency, setEfficiency] = useState('0.90')
  const [operationId, setOperationId] = useState(sampleInput.operations[2].id)
  const [workMinutes, setWorkMinutes] = useState('900')
  const [revised, setRevised] = useState<{
    revision: ScheduleRevision
    incremental: ScheduleResult
    full: ScheduleResult
    affected: { fromAt: string; orderIds: string[]; operationIds: string[] }
  } | null>(null)

  const displayed = revised?.incremental ?? baseResult

  const horizonMinute = isoToMinute(sampleInput.horizonStart)
  const maxMinute = Math.max(...displayed.segments.map((segment) => segment.endMinute))
  const span = maxMinute - horizonMinute

  const applyLocal = () => {
    const revision: ScheduleRevision = {
      loomEfficiency: Number(efficiency) > 0 ? { [loomId]: Number(efficiency) } : {},
      operationWorkMinutes:
        workMinutes.trim().length > 0 ? { [operationId]: Number(workMinutes) } : {},
    }
    const incremental = recomputeViaUi(sampleInput, revision, baseResult)
    const full = runScheduleViaUi(applyRevision(sampleInput, revision))
    setRevised({
      revision,
      incremental: incremental.result,
      full,
      affected: incremental.affected,
    })
  }

  const reset = () => setRevised(null)

  return (
    <div className="min-h-screen p-6" style={{ backgroundColor: '#fdf5e6', color: '#3f2e1f' }}>
      <header className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: '#8b6f47' }}>
          织造排产与工时推演
        </h1>
        <p className="mt-1 text-sm opacity-70">
          界面路径直接调用离线引擎（runScheduleViaUi）；输入哈希 {baseResult.meta.inputHash}，结果摘要{' '}
          {displayed.meta.resultDigest}
        </p>
      </header>

      <section className="mb-6 rounded-lg border p-4" style={{ borderColor: '#cbb89a' }}>
        <h2 className="mb-3 text-lg font-semibold">织机占用顺序</h2>
        <div className="space-y-3">
          {sampleInput.looms.map((loom) => (
            <div key={loom.id} className="flex items-center gap-3">
              <div className="w-32 shrink-0 text-sm">
                <div className="font-medium">
                  {loom.id} {loom.name}
                </div>
                <div className="text-xs opacity-60">效率 {loom.efficiency}</div>
              </div>
              <div
                className="relative h-8 flex-1 rounded"
                style={{ backgroundColor: '#f0e6d2' }}
              >
                {displayed.segments
                  .filter((segment) => segment.loomId === loom.id)
                  .map((segment) => {
                    const left = span > 0 ? ((segment.startMinute - horizonMinute) / span) * 100 : 0
                    const width = span > 0 ? ((segment.endMinute - segment.startMinute) / span) * 100 : 100
                    return (
                      <div
                        key={segment.operationId}
                        className="absolute top-0 flex h-8 items-center justify-center overflow-hidden rounded text-[10px] text-white"
                        style={{
                          left: `${left}%`,
                          width: `${Math.max(width, 0.5)}%`,
                          backgroundColor: ORDER_COLORS[segment.orderId] ?? '#8b6f47',
                          opacity: segment.pinned ? 0.55 : 1,
                          border: segment.pinned ? '1px dashed #5a4632' : undefined,
                        }}
                        title={`${segment.operationId} ${segment.startAt} ~ ${segment.endAt}${
                          segment.pinned ? '（冻结保留）' : ''
                        }`}
                      >
                        {segment.operationId}
                      </div>
                    )
                  })}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-3 text-xs opacity-70">
          {Object.entries(ORDER_COLORS).map(([orderId, color]) => (
            <span key={orderId} className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
              {orderId}
            </span>
          ))}
          <span className="flex items-center gap-1">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: '#8b6f47', opacity: 0.55 }}
            />
            冻结保留段
          </span>
        </div>
      </section>

      <section className="mb-6 rounded-lg border p-4" style={{ borderColor: '#cbb89a' }}>
        <h2 className="mb-3 text-lg font-semibold">订单完成时刻</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left opacity-70">
              <th className="py-1">订单</th>
              <th className="py-1">完成时刻</th>
              <th className="py-1">冲突</th>
            </tr>
          </thead>
          <tbody>
            {displayed.orderCompletions.map((completion) => (
              <tr key={completion.orderId} className="border-t" style={{ borderColor: '#e6d9c0' }}>
                <td className="py-1">{completion.orderId}</td>
                <td className="py-1 font-mono text-xs">{formatAt(completion.completionAt)}</td>
                <td className="py-1">
                  {displayed.conflicts.filter((conflict) =>
                    conflict.operationIds.some((id) => id.startsWith(`${completion.orderId}-`)),
                  ).length || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mb-6 rounded-lg border p-4" style={{ borderColor: '#cbb89a' }}>
        <h2 className="mb-3 text-lg font-semibold">参数修正与局部重算</h2>
        <div className="flex flex-wrap items-end gap-4 text-sm">
          <label className="flex flex-col gap-1">
            织机
            <select
              className="rounded border px-2 py-1"
              value={loomId}
              onChange={(event) => setLoomId(event.target.value)}
            >
              {sampleInput.looms.map((loom) => (
                <option key={loom.id} value={loom.id}>
                  {loom.id} {loom.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            修正效率
            <input
              className="w-28 rounded border px-2 py-1"
              value={efficiency}
              onChange={(event) => setEfficiency(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            工序
            <select
              className="rounded border px-2 py-1"
              value={operationId}
              onChange={(event) => setOperationId(event.target.value)}
            >
              {sampleInput.operations.map((operation) => (
                <option key={operation.id} value={operation.id}>
                  {operation.id} {operation.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            修正工时（分钟）
            <input
              className="w-32 rounded border px-2 py-1"
              value={workMinutes}
              onChange={(event) => setWorkMinutes(event.target.value)}
            />
          </label>
          <button
            className="rounded px-4 py-2 text-sm text-white transition-transform hover:scale-105"
            style={{ backgroundColor: '#8b6f47' }}
            onClick={applyLocal}
          >
            局部重算
          </button>
          <button
            className="rounded border px-4 py-2 text-sm transition-transform hover:scale-105"
            style={{ borderColor: '#8b6f47' }}
            onClick={reset}
          >
            复位
          </button>
        </div>
        {revised && (
          <div className="mt-3 text-sm">
            <div>
              重算界（此前决定冻结保留）：<span className="font-mono text-xs">{revised.affected.fromAt}</span>
              ；受影响订单：{revised.affected.orderIds.join('、')}
            </div>
            <div className="mt-1">
              局部重算 vs 整体重算：
              {revised.incremental.meta.resultDigest === revised.full.meta.resultDigest ? (
                <span className="font-semibold" style={{ color: '#4d7c2f' }}>
                  一致 ✓（{revised.incremental.meta.resultDigest}）
                </span>
              ) : (
                <span className="font-semibold" style={{ color: '#c0392b' }}>
                  不一致 ✗
                </span>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="mb-6 rounded-lg border p-4" style={{ borderColor: '#cbb89a' }}>
        <h2 className="mb-3 text-lg font-semibold">冲突裁决与依据</h2>
        <div className="space-y-3 text-sm">
          {displayed.traces
            .filter((trace) => trace.kind !== 'assign')
            .map((trace, index) => (
              <div key={index} className="rounded p-2" style={{ backgroundColor: '#f6edda' }}>
                <div className="font-medium">
                  [{trace.kind}] {trace.rule}
                </div>
                <div className="text-xs opacity-80">{trace.detail}</div>
                {trace.contenders.length > 0 && (
                  <div className="text-xs opacity-60">相关工序：{trace.contenders.join('、')}</div>
                )}
              </div>
            ))}
          {displayed.traces.every((trace) => trace.kind === 'assign') && (
            <p className="text-xs opacity-60">当前输入无未裁决冲突；同刻竞争均已按统一规则裁决（见 assign 轨迹）。</p>
          )}
          {displayed.conflicts.map((conflict) => (
            <div key={conflict.id} className="rounded p-2" style={{ backgroundColor: '#f8e3dd' }}>
              <div className="font-medium" style={{ color: '#c0392b' }}>
                {conflict.id} {conflict.reason}：{conflict.adjudication}
              </div>
              <pre className="mt-1 overflow-x-auto rounded bg-white/60 p-2 text-[11px]">
                {JSON.stringify(conflict.evidence, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
