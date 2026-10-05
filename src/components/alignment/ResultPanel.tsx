import { useAlignmentStore } from '@/store/alignmentStore';
import { DRIFT_TREND_LABEL } from '@/alignment/types';

function fmt(t: number): string {
  if (!Number.isFinite(t)) return t < 0 ? '−∞' : '+∞';
  return `${t}s`;
}

export default function ResultPanel() {
  const { inputs, result, affected, recomputeAll } = useAlignmentStore();

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900/70 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-amber-300">对齐结论、漂移趋势与重推范围</h2>
        <button className="rounded bg-slate-700 px-3 py-1 text-xs hover:bg-slate-600" onClick={recomputeAll}>
          手动整体重推
        </button>
      </div>

      {affected && (
        <div className="mb-3 rounded border border-amber-700/50 bg-amber-950/20 p-2 text-xs text-amber-200">
          <div>{affected.reason}</div>
          <div className="mt-0.5 text-slate-400">
            本次重推片段结论 {affected.conclusionSegmentIds.length} 条（{affected.conclusionSegmentIds.join(', ') || '无'}）
            {' · '}漂移区间 {affected.intervalIds.length} 个
            {' · '}
            {affected.fullRebuild ? '整体重推' : affected.frameProjectionOnly ? '仅重投影帧字段' : '增量重推'}
          </div>
        </div>
      )}

      <h3 className="mb-1 text-xs font-semibold text-slate-400">漂移区间（沿锚点顺序推导）</h3>
      <div className="mb-4 overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-300">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400">
              <th className="py-1 pr-3">区间(字幕时刻)</th>
              <th className="py-1 pr-3">依据锚点</th>
              <th className="py-1 pr-3">漂移速率(s/s)</th>
              <th className="py-1 pr-3">漂移(帧/1000帧)</th>
              <th className="py-1">趋势</th>
            </tr>
          </thead>
          <tbody>
            {result.intervals.map((iv) => (
              <tr key={iv.id} className="border-b border-slate-800">
                <td className="py-1 pr-3 font-mono">
                  {fmt(iv.fromSec)} ~ {fmt(iv.toSec)}
                </td>
                <td className="py-1 pr-3 font-mono">{iv.anchorIds.join(' → ') || '无锚点'}</td>
                <td className="py-1 pr-3 font-mono">{iv.driftRateSecPerSec.toFixed(5)}</td>
                <td className="py-1 pr-3 font-mono">{iv.driftFramesPer1000.toFixed(1)}</td>
                <td className="py-1">
                  <span
                    className={
                      iv.trend === 'ahead'
                        ? 'rounded bg-red-900/50 px-1.5 text-red-300'
                        : iv.trend === 'behind'
                          ? 'rounded bg-sky-900/50 px-1.5 text-sky-300'
                          : iv.trend === 'stable'
                            ? 'rounded bg-emerald-900/50 px-1.5 text-emerald-300'
                            : 'rounded bg-slate-700 px-1.5 text-slate-300'
                    }
                  >
                    {DRIFT_TREND_LABEL[iv.trend]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mb-1 text-xs font-semibold text-slate-400">
        数据问题（{result.issues.length}）与矛盾组（{result.conflicts.length}）
      </h3>
      <ul className="mb-2 space-y-0.5 text-xs text-slate-300">
        {result.issues.map((i) => (
          <li key={i.id}>
            <span className="rounded bg-red-900/50 px-1 text-red-300">{i.kind}</span> {i.message}
          </li>
        ))}
        {result.conflicts.map((c) => (
          <li key={c.id}>
            <span className={'rounded px-1 ' + (c.adjudicationId ? 'bg-emerald-900/50 text-emerald-300' : 'bg-red-900/50 text-red-300')}>
              {c.adjudicationId ? '已裁决' : '待裁决'}
            </span>{' '}
            {c.reason}：[{c.segmentIds.join(', ')}]
            {c.chosenSegmentId && <>；采纳 {c.chosenSegmentId}，驳回 {c.rejectedSegmentIds.join(', ')}，裁决 {c.adjudicationId}</>}
          </li>
        ))}
        {result.issues.length === 0 && result.conflicts.length === 0 && (
          <li className="text-slate-500">无问题与矛盾</li>
        )}
      </ul>

      <p className="text-[11px] text-slate-500">
        当前共 {inputs.anchors.length} 个锚点、{inputs.segments.length} 条片段、{inputs.adjudications.length} 条裁决记录；
        每条结论均可在片段行的“查看依据”中追溯到锚点、顺序与裁决。
      </p>
    </section>
  );
}
