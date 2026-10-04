import type { DyeRecord } from '@/simulation';

interface ColorRecordProps {
  records: DyeRecord[];
  onRevert: (round: number) => void;
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? timestamp
    : date.toLocaleTimeString('zh-CN', { hour12: false });
}

export default function ColorRecord({ records, onRevert }: ColorRecordProps) {
  const timeline = [...records].sort((a, b) => b.round - a.round);

  return (
    <div className="flex h-full flex-col rounded-2xl bg-[#efe7d3] p-4">
      <h2 className="mb-3 text-lg font-semibold text-[#5a3d2b]">浸染记录</h2>
      <div className="record-scroll flex flex-col gap-2 overflow-y-auto pr-1" style={{ maxHeight: 560 }}>
        {timeline.length === 0 && (
          <div className="rounded-lg border border-dashed border-[#8b7b68] p-6 text-center text-sm text-[#8b7b68]">
            尚无浸染记录，点击「提拉一次」开始
          </div>
        )}
        {timeline.map((record) => (
          <button
            key={record.id}
            type="button"
            onClick={() => onRevert(record.round)}
            title="点击回退到该色阶"
            className="flex items-center gap-3 rounded-lg bg-[#f5f0e1] p-3 text-left transition hover:-translate-y-0.5 hover:bg-[#e8dcc8] hover:shadow-md"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm border border-black/10"
              style={{ backgroundColor: record.colorHex }}
            />
            <span className="flex-1">
              <span className="block text-sm font-semibold text-[#5a3d2b]">
                第 {record.round} 轮
              </span>
              <span className="block text-xs text-[#8b7b68]">
                {formatTime(record.timestamp)} · 氧化 {record.oxidationSeconds} 秒
              </span>
            </span>
            <span className="text-xs text-[#8b5e3c]">回退</span>
          </button>
        ))}
      </div>
    </div>
  );
}
