import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDivinationStore, sortRecords } from '@/store/divinationStore';
import HexagramFigure from '@/components/HexagramFigure';
import { formatDateTime } from '@/utils/datetime';

const KIND_TEXT: Record<string, string> = {
  none: '无动爻',
  single: '一爻动',
  double: '两爻动',
  multiple: '多爻动',
  all: '六爻全动',
};

export default function ArchivePage() {
  const records = useDivinationStore((s) => s.records);
  const deleteRecord = useDivinationStore((s) => s.deleteRecord);
  const clearRecords = useDivinationStore((s) => s.clearRecords);
  const [confirmClear, setConfirmClear] = useState(false);

  const sorted = sortRecords(records);

  if (sorted.length === 0) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-[#8a6d1f]/50 bg-[#faf3e3] p-10 text-center text-stone-500">
        <p className="text-lg">卦档空空，尚无起卦记录</p>
        <Link
          to="/"
          className="rounded-lg bg-[#5d3a1a] px-5 py-2 text-sm text-[#f0e6d3] transition hover:bg-[#6b4423]"
        >
          前去起卦
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <p className="text-sm text-stone-600">共 {sorted.length} 条记录，按起卦时刻倒序排列</p>
        {confirmClear ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-stone-600">确认清空全部记录？</span>
            <button
              type="button"
              onClick={() => {
                clearRecords();
                setConfirmClear(false);
              }}
              className="rounded-lg bg-red-700 px-3 py-1.5 text-sm text-white hover:bg-red-800"
            >
              确认清空
            </button>
            <button
              type="button"
              onClick={() => setConfirmClear(false)}
              className="rounded-lg border border-stone-400 px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="rounded-lg border border-red-700/50 px-3 py-1.5 text-sm text-red-700 transition hover:bg-red-700/10"
          >
            清空全部
          </button>
        )}
      </header>

      <ul className="grid gap-3 sm:grid-cols-2">
        {sorted.map((record) => (
          <li
            key={record.id}
            className="group relative rounded-xl border border-[#8a6d1f]/40 bg-[#faf3e3] p-4 shadow-sm transition hover:shadow-md"
          >
            <Link to={`/records/${record.id}`} className="flex items-center gap-4">
              <HexagramFigure
                binary={record.benGua.binary}
                movingPositions={record.movingPositions}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-[#2a1a0a]">
                    {record.benGua.fullName}
                  </span>
                  {record.bianGua.binary !== record.benGua.binary && (
                    <span className="truncate text-sm text-[#8a6d1f]">
                      之 {record.bianGua.fullName}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-stone-500">{formatDateTime(record.createdAt)}</p>
                <p className="mt-1 truncate text-sm text-stone-700">
                  {record.question || <span className="text-stone-400">未记所问之事</span>}
                </p>
                <span className="mt-1 inline-block rounded-full bg-[#b8860b]/15 px-2 py-0.5 text-xs text-[#8a6d1f]">
                  {KIND_TEXT[record.deduction.kind]}
                  {record.movingPositions.length > 0 &&
                    `（${record.movingPositions.map((p) => '一二三四五六'[p - 1]).join('、')}）`}
                </span>
              </div>
            </Link>
            <button
              type="button"
              aria-label="删除该记录"
              onClick={() => {
                if (window.confirm('确认删除这条起卦记录？')) deleteRecord(record.id);
              }}
              className="absolute right-2 top-2 rounded p-1 text-stone-400 opacity-0 transition hover:text-red-700 group-hover:opacity-100"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
