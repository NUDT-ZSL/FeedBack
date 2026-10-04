import type { DyeRecord, DyeingResult } from '@/simulation';

interface CompletionModalProps {
  records: DyeRecord[];
  result: DyeingResult;
  onExport: () => void;
  onClose: () => void;
}

export default function CompletionModal({
  records,
  result,
  onExport,
  onClose,
}: CompletionModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-[#f5f0e1] p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-[#5a3d2b]">蓝染布匹完成！</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-3 py-1 text-sm text-[#8b7b68] hover:bg-[#e8dcc8]"
          >
            关闭
          </button>
        </div>
        <p className="mb-4 text-sm text-[#7a6a58]">
          共浸染 {result.dipCount} 次，布料已呈最深靛蓝（{result.colorHex}）。
        </p>
        <div className="mb-5 flex flex-col gap-2">
          {records.map((record) => (
            <div
              key={record.id}
              className="flex items-center gap-3 rounded-lg bg-white/60 px-3 py-2"
            >
              <span
                className="h-3 w-3 shrink-0 rounded-sm border border-black/10"
                style={{ backgroundColor: record.colorHex }}
              />
              <span className="text-sm font-semibold text-[#5a3d2b]">
                第 {record.round} 轮
              </span>
              <span className="ml-auto text-xs text-[#8b7b68]">
                {record.colorHex} · 氧化 {record.oxidationSeconds} 秒
              </span>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={onExport}
          className="w-full rounded-full bg-[#0a2c5d] py-3 font-semibold text-white transition hover:bg-[#0d3a7a]"
        >
          导出记录（JSON）
        </button>
      </div>
    </div>
  );
}
