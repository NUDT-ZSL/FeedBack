import { useAlignmentStore } from '@/store/alignmentStore';

export default function MediaPanel() {
  const media = useAlignmentStore((s) => s.state.media);
  const setMedia = useAlignmentStore((s) => s.setMedia);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">媒体信息</h2>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          总时长 (ms)
          <input
            type="number"
            className="w-28 rounded border border-slate-300 px-2 py-1"
            value={media.durationMs}
            onChange={(e) => setMedia({ ...media, durationMs: Number(e.target.value) || 0 })}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          帧率 (fps)
          <input
            type="number"
            className="w-20 rounded border border-slate-300 px-2 py-1"
            value={media.frameRate}
            onChange={(e) => setMedia({ ...media, frameRate: Number(e.target.value) || 0 })}
          />
        </label>
      </div>
      <p className="mt-2 text-xs text-slate-400">调整帧率只会触发帧偏移换算的全量重推；时长不影响已推导结论。</p>
    </section>
  );
}
