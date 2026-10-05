import { useState } from 'react';
import { useAlignmentStore } from '@/store/alignmentStore';

const inputCls =
  'w-24 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100 focus:border-amber-400 focus:outline-none';

export default function MediaPanel() {
  const { inputs, result, setMediaInfo, addAnchor, updateAnchor, removeAnchor } = useAlignmentStore();
  const [draft, setDraft] = useState({ mediaTimeSec: 0, subtitleTimeSec: 0, segmentId: '' });

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900/70 p-4">
      <h2 className="mb-3 text-sm font-semibold text-amber-300">媒体信息与关键锚点</h2>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-slate-300">
        <label>
          总时长(s)
          <input
            type="number"
            className={inputCls + ' ml-1'}
            value={inputs.media.durationSec}
            onChange={(e) => setMediaInfo({ durationSec: Number(e.target.value) })}
          />
        </label>
        <label>
          帧率(fps)
          <input
            type="number"
            className={inputCls + ' ml-1'}
            value={inputs.media.frameRate}
            onChange={(e) => setMediaInfo({ frameRate: Number(e.target.value) })}
          />
        </label>
        <span className="text-xs text-slate-500">帧率调整只重投影帧字段；总时长变更触发整体重推</span>
      </div>

      <table className="w-full text-left text-xs text-slate-300">
        <thead>
          <tr className="border-b border-slate-700 text-slate-400">
            <th className="py-1 pr-2">锚点</th>
            <th className="py-1 pr-2">媒体时刻(s)</th>
            <th className="py-1 pr-2">字幕时刻(s)</th>
            <th className="py-1 pr-2">依附片段</th>
            <th className="py-1 pr-2">状态</th>
            <th className="py-1" />
          </tr>
        </thead>
        <tbody>
          {inputs.anchors.map((a) => {
            const dangling = result.issues.some((i) => i.kind === 'dangling-anchor' && i.anchorId === a.id);
            return (
              <tr key={a.id} className="border-b border-slate-800">
                <td className="py-1 pr-2 font-mono">{a.id}</td>
                <td className="py-1 pr-2">
                  <input
                    type="number"
                    className={inputCls}
                    value={a.mediaTimeSec}
                    onChange={(e) => updateAnchor(a.id, { mediaTimeSec: Number(e.target.value) })}
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    type="number"
                    className={inputCls}
                    value={a.subtitleTimeSec}
                    onChange={(e) => updateAnchor(a.id, { subtitleTimeSec: Number(e.target.value) })}
                  />
                </td>
                <td className="py-1 pr-2 font-mono">{a.segmentId ?? '—'}</td>
                <td className="py-1 pr-2">
                  {dangling ? (
                    <span className="rounded bg-red-900/60 px-1.5 py-0.5 text-red-300">指向缺失</span>
                  ) : (
                    <span className="text-emerald-400">有效</span>
                  )}
                </td>
                <td className="py-1 text-right">
                  <button
                    className="rounded bg-slate-700 px-2 py-0.5 hover:bg-red-800"
                    onClick={() => removeAnchor(a.id)}
                  >
                    删除
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-300">
        <span className="text-slate-400">新增锚点：</span>
        <input
          type="number"
          placeholder="媒体时刻"
          className={inputCls}
          value={draft.mediaTimeSec}
          onChange={(e) => setDraft({ ...draft, mediaTimeSec: Number(e.target.value) })}
        />
        <input
          type="number"
          placeholder="字幕时刻"
          className={inputCls}
          value={draft.subtitleTimeSec}
          onChange={(e) => setDraft({ ...draft, subtitleTimeSec: Number(e.target.value) })}
        />
        <input
          placeholder="依附片段id(可空)"
          className={inputCls + ' w-32'}
          value={draft.segmentId}
          onChange={(e) => setDraft({ ...draft, segmentId: e.target.value })}
        />
        <button
          className="rounded bg-amber-600 px-3 py-1 text-slate-900 hover:bg-amber-500"
          onClick={() =>
            addAnchor({
              mediaTimeSec: draft.mediaTimeSec,
              subtitleTimeSec: draft.subtitleTimeSec,
              segmentId: draft.segmentId || undefined,
            })
          }
        >
          添加
        </button>
      </div>
    </section>
  );
}
