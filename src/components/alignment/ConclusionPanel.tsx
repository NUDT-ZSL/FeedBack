import { useAlignmentStore } from '@/store/alignmentStore';
import type { DriftTrend } from '@/alignment';

const TREND_LABEL: Record<DriftTrend, { text: string; className: string }> = {
  stable: { text: '稳定', className: 'bg-emerald-100 text-emerald-700' },
  'drifting-later': { text: '向后漂移', className: 'bg-sky-100 text-sky-700' },
  'drifting-earlier': { text: '向前漂移', className: 'bg-violet-100 text-violet-700' },
  unknown: { text: '未知', className: 'bg-slate-100 text-slate-500' },
};

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  derived: { text: '已推导', className: 'bg-emerald-100 text-emerald-700' },
  'pending-adjudication': { text: '待裁决', className: 'bg-amber-100 text-amber-700' },
  excluded: { text: '裁决排除', className: 'bg-slate-200 text-slate-500' },
};

export default function ConclusionPanel() {
  const conclusions = useAlignmentStore((s) => s.state.conclusions);
  const lastRun = useAlignmentStore((s) => s.lastRun);
  const runCount = useAlignmentStore((s) => s.runCount);
  const rerunFull = useAlignmentStore((s) => s.rerunFull);
  const affected = new Set(lastRun?.affectedIds ?? []);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">对齐结论与漂移趋势</h2>
        <div className="flex items-center gap-2 text-xs">
          {lastRun && (
            <span className="rounded bg-slate-100 px-2 py-1 text-slate-600">
              第 {runCount} 次推演 · {lastRun.kind === 'full' ? '整体重推' : `增量重推 ${lastRun.affectedIds.length} 条`}
            </span>
          )}
          {lastRun && lastRun.kind === 'incremental' && (
            <span
              className={`rounded px-2 py-1 ${
                lastRun.consistentWithFull ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
              }`}
            >
              {lastRun.consistentWithFull ? '与整体重推一致 ✓' : '与整体重推不一致 ✗'}
            </span>
          )}
          <button className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50" onClick={rerunFull}>
            整体重推
          </button>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-400">
            <th className="py-1">片段</th>
            <th>状态</th>
            <th>偏移</th>
            <th>漂移趋势</th>
            <th>依据（锚点 / 顺序 / 裁决）</th>
          </tr>
        </thead>
        <tbody>
          {conclusions.map((c) => {
            const trend = TREND_LABEL[c.driftTrend];
            const status = STATUS_LABEL[c.status];
            return (
              <tr key={c.segmentId} className={`border-t border-slate-100 ${affected.has(c.segmentId) ? 'bg-sky-50' : ''}`}>
                <td className="py-1 pr-2 font-mono text-xs">
                  {c.segmentId}
                  {affected.has(c.segmentId) && (
                    <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] text-sky-700">本次重推</span>
                  )}
                </td>
                <td>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${status.className}`}>{status.text}</span>
                </td>
                <td className="text-xs">
                  {c.offsetMs !== null ? (
                    <span>
                      {c.offsetMs >= 0 ? '+' : ''}
                      {Math.round(c.offsetMs)}ms
                      <span className="ml-1 text-slate-400">({c.offsetFrames}f)</span>
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${trend.className}`}>{trend.text}</span>
                  {c.driftSlopeMsPerSec !== null && (
                    <span className="ml-1 text-xs text-slate-400">
                      {c.driftSlopeMsPerSec >= 0 ? '+' : ''}
                      {c.driftSlopeMsPerSec.toFixed(1)}ms/s
                    </span>
                  )}
                </td>
                <td className="text-xs text-slate-500">
                  {c.basis ? (
                    <span className="font-mono">
                      锚点[{c.basis.anchorIds.join(', ') || '无'}] · 顺序[{c.basis.prevSegmentId ?? '∅'} ←{' '}
                      {c.segmentId} → {c.basis.nextSegmentId ?? '∅'}] · 裁决[
                      {c.basis.adjudicationIds.join(', ') || '无'}]
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
