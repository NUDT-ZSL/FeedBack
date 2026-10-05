import { useState } from 'react';
import { useAlignmentStore } from '@/store/alignmentStore';
import { DRIFT_TREND_LABEL } from '@/alignment/types';
import type { ConflictGroup, Issue, SegmentConclusion } from '@/alignment/types';

const inputCls =
  'w-20 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100 focus:border-amber-400 focus:outline-none';

const ISSUE_LABEL: Record<Issue['kind'], string> = {
  'reversed-time': '时刻倒序',
  'out-of-media': '超出媒体时长',
  overlap: '区间重叠',
  'dangling-anchor': '锚点指向缺失',
};

function Badges({ conclusion, issues }: { conclusion?: SegmentConclusion; issues: Issue[] }) {
  const conflict = useAlignmentStore((s) =>
    conclusion?.conflictId ? s.result.conflicts.find((c) => c.id === conclusion.conflictId) : undefined,
  );
  const labels = issues
    .map((i) => ISSUE_LABEL[i.kind])
    .concat(conflict ? (conflict.adjudicationId ? '已裁决' : '待裁决矛盾') : '')
    .filter(Boolean);
  return (
    <div className="flex flex-wrap gap-1">
      {conclusion?.rejected && (
        <span className="rounded bg-slate-700 px-1.5 py-0.5 text-slate-400">裁决驳回（保留）</span>
      )}
      {labels.map((label, i) => (
        <span
          key={i}
          className={
            label.includes('矛盾') || label === '时刻倒序' || label === '超出媒体时长'
              ? 'rounded bg-red-900/60 px-1.5 py-0.5 text-red-300'
              : 'rounded bg-orange-900/50 px-1.5 py-0.5 text-orange-300'
          }
        >
          {label}
        </span>
      ))}
    </div>
  );
}

export default function SegmentPanel() {
  const { inputs, result, addSegment, updateSegment, removeSegment, adjudicate } = useAlignmentStore();
  const [draft, setDraft] = useState({ startSec: 0, endSec: 0, text: '', source: 'ASR' });
  const [expanded, setExpanded] = useState<string | null>(null);

  const issuesBySegment = new Map<string, Issue[]>();
  for (const issue of result.issues) {
    for (const sid of issue.segmentIds ?? []) {
      if (!issuesBySegment.has(sid)) issuesBySegment.set(sid, []);
      issuesBySegment.get(sid)!.push(issue);
    }
  }

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900/70 p-4">
      <h2 className="mb-3 text-sm font-semibold text-amber-300">字幕片段（按字幕时间轴排序）</h2>
      <div className="space-y-1">
        {result.conclusions.map((c) => {
          const seg = inputs.segments.find((s) => s.id === c.segmentId)!;
          const conflict: ConflictGroup | undefined = c.conflictId
            ? result.conflicts.find((g) => g.id === c.conflictId)
            : undefined;
          const isOpen = expanded === seg.id;
          return (
            <div
              key={seg.id}
              className={
                'rounded border px-2 py-1.5 ' +
                (c.rejected
                  ? 'border-slate-700 bg-slate-800/40 opacity-70'
                  : conflict && !conflict.adjudicationId
                    ? 'border-red-700 bg-red-950/20'
                    : 'border-slate-700 bg-slate-800/40')
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-8 text-xs text-slate-500">#{c.orderIndex}</span>
                <input
                  type="number"
                  className={inputCls}
                  value={seg.startSec}
                  onChange={(e) => updateSegment(seg.id, { startSec: Number(e.target.value) })}
                />
                <span className="text-slate-500">~</span>
                <input
                  type="number"
                  className={inputCls}
                  value={seg.endSec}
                  onChange={(e) => updateSegment(seg.id, { endSec: Number(e.target.value) })}
                />
                <input
                  className="min-w-40 flex-1 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100"
                  value={seg.text}
                  onChange={(e) => updateSegment(seg.id, { text: e.target.value })}
                />
                <input
                  className="w-20 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100"
                  value={seg.source}
                  onChange={(e) => updateSegment(seg.id, { source: e.target.value })}
                />
                <button
                  className="rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600"
                  onClick={() => setExpanded(isOpen ? null : seg.id)}
                >
                  {isOpen ? '收起依据' : '查看依据'}
                </button>
                <button
                  className="rounded bg-slate-700 px-2 py-1 text-xs hover:bg-red-800"
                  onClick={() => removeSegment(seg.id)}
                >
                  删除
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-10 text-xs">
                <Badges conclusion={c} issues={issuesBySegment.get(seg.id) ?? []} />
                <span className="text-slate-400">
                  偏移 {c.offsetSec.toFixed(3)}s / {c.offsetFrames} 帧 · 漂移趋势：
                  {DRIFT_TREND_LABEL[c.driftTrend]}
                </span>
              </div>

              {isOpen && <TraceDetail conclusion={c} conflict={conflict} onAdjudicate={adjudicate} />}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-300">
        <span className="text-slate-400">新增片段：</span>
        <input type="number" placeholder="起" className={inputCls} value={draft.startSec} onChange={(e) => setDraft({ ...draft, startSec: Number(e.target.value) })} />
        <span className="text-slate-500">~</span>
        <input type="number" placeholder="止" className={inputCls} value={draft.endSec} onChange={(e) => setDraft({ ...draft, endSec: Number(e.target.value) })} />
        <input
          placeholder="文本"
          className="min-w-40 flex-1 rounded border border-slate-600 bg-slate-800 px-2 py-1"
          value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
        />
        <input
          placeholder="来源"
          className="w-24 rounded border border-slate-600 bg-slate-800 px-2 py-1"
          value={draft.source}
          onChange={(e) => setDraft({ ...draft, source: e.target.value })}
        />
        <button
          className="rounded bg-amber-600 px-3 py-1 text-slate-900 hover:bg-amber-500"
          onClick={() => addSegment(draft)}
        >
          添加
        </button>
      </div>
    </section>
  );
}

function TraceDetail({
  conclusion,
  conflict,
  onAdjudicate,
}: {
  conclusion: SegmentConclusion;
  conflict?: ConflictGroup;
  onAdjudicate: (conflictId: string, chosenSegmentId: string, note?: string) => void;
}) {
  const { inputs } = useAlignmentStore();
  const anchorNames = conclusion.basis.anchorIds
    .map((id) => {
      const a = inputs.anchors.find((x) => x.id === id);
      return a ? `${id}(媒体${a.mediaTimeSec}s↔字幕${a.subtitleTimeSec}s)` : id;
    })
    .join('，');
  const adjudications = inputs.adjudications.filter((a) => conclusion.basis.adjudicationIds.includes(a.id));

  return (
    <div className="mt-2 space-y-1 rounded bg-slate-900/80 p-2 pl-10 text-xs text-slate-300">
      <div>推导顺序：字幕时间轴排序第 <b className="text-amber-300">{conclusion.orderIndex}</b> 位；代表时刻 {conclusion.midSec.toFixed(2)}s</div>
      <div>
        依据锚点：<b className="text-amber-300">{anchorNames || '无（偏移按 0 计）'}</b>
        {conclusion.basis.extrapolated && <span className="ml-1 text-orange-300">（覆盖范围外推）</span>}
      </div>
      <div>
        对齐到媒体轴：{conclusion.alignedMediaStartSec.toFixed(3)}s ~ {conclusion.alignedMediaEndSec.toFixed(3)}s ·
        漂移速率 {conclusion.driftRateSecPerSec.toFixed(5)} s/s · 区间 {conclusion.intervalId}
      </div>
      {adjudications.map((a) => (
        <div key={a.id} className="text-emerald-300">
          裁决记录 {a.id}：采纳 {a.chosenSegmentId}，驳回 {a.rejectedSegmentIds.join(', ') || '无'}
          {a.note ? `（${a.note}）` : ''}
        </div>
      ))}
      {conflict && !conflict.adjudicationId && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-red-300">该片段参与待裁决矛盾组，双方均保留；请裁决：</span>
          {conflict.segmentIds.map((sid) => (
            <button
              key={sid}
              className="rounded bg-red-800 px-2 py-0.5 hover:bg-red-700"
              onClick={() => onAdjudicate(conflict.id, sid)}
            >
              采纳 {sid}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
