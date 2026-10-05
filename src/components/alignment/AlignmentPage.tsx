import MediaPanel from './MediaPanel';
import SegmentPanel from './SegmentPanel';
import ResultPanel from './ResultPanel';
import { useAlignmentStore } from '@/store/alignmentStore';

export default function AlignmentPage() {
  const loadSample = useAlignmentStore((s) => s.loadSample);
  return (
    <div className="min-h-screen bg-slate-950 p-4 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-amber-300">字幕—媒体对齐推演</h1>
            <p className="text-xs text-slate-400">
              录入媒体信息与字幕片段，沿锚点顺序推导偏移与漂移；矛盾保留、可裁决，变更后增量重推且与整体重推一致
            </p>
          </div>
          <button className="rounded bg-slate-800 px-3 py-1 text-xs hover:bg-slate-700" onClick={loadSample}>
            重置为验收样例
          </button>
        </header>
        <MediaPanel />
        <SegmentPanel />
        <ResultPanel />
      </div>
    </div>
  );
}
