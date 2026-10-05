import MediaPanel from '@/components/alignment/MediaPanel';
import AnchorPanel from '@/components/alignment/AnchorPanel';
import SegmentPanel from '@/components/alignment/SegmentPanel';
import ConclusionPanel from '@/components/alignment/ConclusionPanel';
import { useAlignmentStore } from '@/store/alignmentStore';

export default function Home() {
  const loadDataset = useAlignmentStore((s) => s.loadDataset);

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-slate-800">字幕对齐推演</h1>
            <p className="text-sm text-slate-500">
              沿锚点与片段顺序推导各段偏移与漂移趋势；矛盾片段保留待裁决，变更后仅增量重推受影响区间。
            </p>
          </div>
          <button
            className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700"
            onClick={loadDataset}
          >
            载入验收数据集
          </button>
        </header>
        <MediaPanel />
        <AnchorPanel />
        <SegmentPanel />
        <ConclusionPanel />
      </div>
    </div>
  );
}
