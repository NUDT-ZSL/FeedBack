import { useState } from 'react';
import { useAlignmentStore, newId } from '@/store/alignmentStore';
import type { SubtitleSegment } from '@/alignment';

const EMPTY: Omit<SubtitleSegment, 'id'> = { startMs: 0, endMs: 0, text: '', source: 'asr' };

export default function SegmentPanel() {
  const sortedIds = useAlignmentStore((s) => s.state.sortedIds);
  const segments = useAlignmentStore((s) => s.state.segments);
  const anomalies = useAlignmentStore((s) => s.state.anomalies);
  const conflicts = useAlignmentStore((s) => s.state.conflicts);
  const adjudications = useAlignmentStore((s) => s.state.adjudications);
  const upsertSegment = useAlignmentStore((s) => s.upsertSegment);
  const removeSegment = useAlignmentStore((s) => s.removeSegment);
  const adjudicate = useAlignmentStore((s) => s.adjudicate);
  const [draft, setDraft] = useState(EMPTY);

  const byId = new Map(segments.map((seg) => [seg.id, seg]));
  const reversedIds = new Set(anomalies.filter((a) => a.kind === 'reversed').map((a) => a.segmentId));
  const overlapOf = new Map<string, string>();
  anomalies
    .filter((a) => a.kind === 'overlap')
    .forEach((a) => overlapOf.set(a.segmentId, a.otherSegmentId));
  const conflictBySegment = new Map<string, string>();
  conflicts.forEach((c) => c.segmentIds.forEach((id) => conflictBySegment.set(id, c.key)));
  const winnerByKey = new Map<string, string>();
  adjudications.forEach((adj) => winnerByKey.set(adj.conflictKey, adj.winnerSegmentId));

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">字幕片段（按时间轴排序展示，保留全部录入）</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-400">
            <th className="py-1">ID</th>
            <th>起 (ms)</th>
            <th>止 (ms)</th>
            <th>文本</th>
            <th>来源</th>
            <th>异常标记</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sortedIds.map((id) => {
            const seg = byId.get(id)!;
            const conflictKey = conflictBySegment.get(id);
            const isWinner = conflictKey && winnerByKey.get(conflictKey) === id;
            return (
              <tr key={id} className="border-t border-slate-100 align-middle">
                <td className="py-1 pr-2 font-mono text-xs">{seg.id}</td>
                <td>
                  <input
                    type="number"
                    className="w-20 rounded border border-slate-200 px-1 py-0.5"
                    value={seg.startMs}
                    onChange={(e) => upsertSegment({ ...seg, startMs: Number(e.target.value) || 0 })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    className="w-20 rounded border border-slate-200 px-1 py-0.5"
                    value={seg.endMs}
                    onChange={(e) => upsertSegment({ ...seg, endMs: Number(e.target.value) || 0 })}
                  />
                </td>
                <td>
                  <input
                    className="w-48 rounded border border-slate-200 px-1 py-0.5"
                    value={seg.text}
                    onChange={(e) => upsertSegment({ ...seg, text: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="w-16 rounded border border-slate-200 px-1 py-0.5 text-xs"
                    value={seg.source}
                    onChange={(e) => upsertSegment({ ...seg, source: e.target.value })}
                  />
                </td>
                <td className="text-xs">
                  <div className="flex flex-wrap gap-1">
                    {reversedIds.has(id) && (
                      <span className="rounded bg-rose-100 px-1.5 py-0.5 text-rose-700">起止倒序</span>
                    )}
                    {overlapOf.has(id) && (
                      <span className="rounded bg-orange-100 px-1.5 py-0.5 text-orange-700">
                        与 {overlapOf.get(id)} 重叠
                      </span>
                    )}
                    {conflictKey && !isWinner && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">矛盾·待裁决</span>
                    )}
                    {isWinner && (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700">裁决保留</span>
                    )}
                  </div>
                </td>
                <td>
                  <button className="text-xs text-rose-500 hover:underline" onClick={() => removeSegment(id)}>
                    删除
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {conflicts.some((c) => c.status === 'pending') && (
        <div className="mt-4 rounded border border-amber-200 bg-amber-50 p-3">
          <h3 className="mb-2 text-sm font-semibold text-amber-800">待裁决矛盾片段（双方均保留，未静默择一）</h3>
          {conflicts
            .filter((c) => c.status === 'pending')
            .map((conflict) => (
              <div key={conflict.key} className="mb-2">
                <div className="mb-1 text-xs text-amber-700">{conflict.key} · t={conflict.startMs}ms</div>
                <div className="flex flex-wrap gap-2">
                  {conflict.segmentIds.map((id) => {
                    const seg = byId.get(id)!;
                    return (
                      <button
                        key={id}
                        className="rounded border border-amber-300 bg-white px-2 py-1 text-left text-xs hover:border-amber-500"
                        onClick={() => adjudicate(conflict.key, id)}
                      >
                        <span className="font-mono">{id}</span>
                        <span className="ml-1 text-slate-500">[{seg.source}]</span>
                        <div className="max-w-56 truncate text-slate-700">{seg.text}</div>
                        <div className="mt-0.5 text-amber-600">点此裁定保留该条</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <input
          type="number"
          className="w-24 rounded border border-slate-300 px-2 py-1"
          placeholder="起 ms"
          value={draft.startMs || ''}
          onChange={(e) => setDraft({ ...draft, startMs: Number(e.target.value) || 0 })}
        />
        <input
          type="number"
          className="w-24 rounded border border-slate-300 px-2 py-1"
          placeholder="止 ms"
          value={draft.endMs || ''}
          onChange={(e) => setDraft({ ...draft, endMs: Number(e.target.value) || 0 })}
        />
        <input
          className="w-48 rounded border border-slate-300 px-2 py-1"
          placeholder="文本"
          value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
        />
        <input
          className="w-20 rounded border border-slate-300 px-2 py-1"
          placeholder="来源"
          value={draft.source}
          onChange={(e) => setDraft({ ...draft, source: e.target.value })}
        />
        <button
          className="rounded bg-slate-800 px-3 py-1 text-white disabled:opacity-40"
          disabled={!draft.text}
          onClick={() => {
            upsertSegment({ ...draft, id: newId('S') });
            setDraft(EMPTY);
          }}
        >
          添加片段
        </button>
      </div>
    </section>
  );
}
