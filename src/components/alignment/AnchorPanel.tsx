import { useState } from 'react';
import { useAlignmentStore, newId } from '@/store/alignmentStore';

export default function AnchorPanel() {
  const anchors = useAlignmentStore((s) => s.state.anchors);
  const segments = useAlignmentStore((s) => s.state.segments);
  const anomalies = useAlignmentStore((s) => s.state.anomalies);
  const upsertAnchor = useAlignmentStore((s) => s.upsertAnchor);
  const removeAnchor = useAlignmentStore((s) => s.removeAnchor);
  const [segmentId, setSegmentId] = useState('');
  const [mediaTimeMs, setMediaTimeMs] = useState(0);

  const flagged = new Map(
    anomalies
      .filter((a) => a.kind === 'dangling-anchor' || a.kind === 'inactive-anchor-target')
      .map((a) => [a.anchorId, a.kind === 'dangling-anchor' ? '目标片段缺失' : '目标待裁决/已排除']),
  );

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">关键锚点</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-400">
            <th className="py-1">ID</th>
            <th>目标片段</th>
            <th>媒体时刻 (ms)</th>
            <th>状态</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {anchors.map((anchor) => (
            <tr key={anchor.id} className="border-t border-slate-100">
              <td className="py-1 font-mono text-xs">{anchor.id}</td>
              <td className="font-mono text-xs">{anchor.segmentId}</td>
              <td>
                <input
                  type="number"
                  className="w-24 rounded border border-slate-200 px-1 py-0.5"
                  value={anchor.mediaTimeMs}
                  onChange={(e) => upsertAnchor({ ...anchor, mediaTimeMs: Number(e.target.value) || 0 })}
                />
              </td>
              <td>
                {flagged.has(anchor.id) ? (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">{flagged.get(anchor.id)}</span>
                ) : (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700">有效</span>
                )}
              </td>
              <td>
                <button
                  className="text-xs text-rose-500 hover:underline"
                  onClick={() => removeAnchor(anchor.id)}
                >
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <select
          className="rounded border border-slate-300 px-2 py-1"
          value={segmentId}
          onChange={(e) => setSegmentId(e.target.value)}
        >
          <option value="">选择目标片段…</option>
          {segments.map((seg) => (
            <option key={seg.id} value={seg.id}>{seg.id} · {seg.text.slice(0, 12)}</option>
          ))}
        </select>
        <input
          type="number"
          className="w-28 rounded border border-slate-300 px-2 py-1"
          value={mediaTimeMs}
          onChange={(e) => setMediaTimeMs(Number(e.target.value) || 0)}
          placeholder="媒体时刻"
        />
        <button
          className="rounded bg-slate-800 px-3 py-1 text-white disabled:opacity-40"
          disabled={!segmentId}
          onClick={() => {
            upsertAnchor({ id: newId('A'), mediaTimeMs, segmentId });
            setSegmentId('');
          }}
        >
          添加锚点
        </button>
      </div>
    </section>
  );
}
