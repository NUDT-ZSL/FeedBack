import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { getHexagramByBinary } from '@/data/hexagrams';
import { useDivinationStore } from '@/store';
import { formatDateTime } from '@/lib/utils';
import HexagramView from '@/components/HexagramView';

/** 归档列表：按起卦时刻倒序，支持单条删除与清空全部 */
export default function RecordList() {
  const { records, selectRecord, deleteRecord, clearRecords } = useDivinationStore();
  const [confirmingClear, setConfirmingClear] = useState(false);

  return (
    <div className="fade-in mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-kai text-xl font-bold text-amber-950">
          卦录 <span className="text-sm font-normal text-stone-500">（共 {records.length} 条，按时间倒序）</span>
        </h2>
        {records.length > 0 &&
          (confirmingClear ? (
            <span className="flex items-center gap-2 text-sm">
              <span className="text-red-800">确定清空全部记录？</span>
              <button
                type="button"
                onClick={() => {
                  clearRecords();
                  setConfirmingClear(false);
                }}
                className="rounded bg-red-800 px-2.5 py-1 text-white hover:bg-red-900"
              >
                确认清空
              </button>
              <button
                type="button"
                onClick={() => setConfirmingClear(false)}
                className="rounded border border-stone-400 px-2.5 py-1 text-stone-600"
              >
                取消
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingClear(true)}
              className="flex items-center gap-1 rounded-lg border border-red-800/40 px-3 py-1.5 text-sm text-red-800 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" /> 清空全部
            </button>
          ))}
      </div>

      {records.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-400 bg-[#f8f1e2] p-10 text-center text-stone-500">
          尚无归档记录，去「起卦」摇一卦吧。
        </div>
      ) : (
        <ul className="space-y-3">
          {records.map((record) => {
            const ben = getHexagramByBinary(record.benBinary);
            const bian = getHexagramByBinary(record.bianBinary);
            return (
              <li
                key={record.id}
                className="flex items-center gap-4 rounded-lg border border-amber-900/20 bg-[#f8f1e2] p-3 transition hover:border-amber-700/50 hover:shadow"
              >
                <button
                  type="button"
                  onClick={() => selectRecord(record.id)}
                  className="flex flex-1 items-center gap-4 text-left"
                >
                  <HexagramView binary={record.benBinary} movingPositions={record.movingPositions} compact />
                  <div className="min-w-0 flex-1">
                    <p className="font-kai text-lg font-bold text-stone-900">
                      {ben?.name ?? '未知卦'}
                      {record.bianBinary !== record.benBinary && (
                        <span className="ml-2 text-sm font-normal text-stone-500">之 {bian?.name}</span>
                      )}
                      {record.movingPositions.length > 0 && (
                        <span className="ml-2 rounded bg-red-800/10 px-1.5 text-xs text-red-800">
                          {record.movingPositions.length} 爻动
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-stone-500">{formatDateTime(record.createdAt)}</p>
                    {record.question && (
                      <p className="mt-1 truncate text-sm text-stone-600">问：{record.question}</p>
                    )}
                  </div>
                </button>
                <button
                  type="button"
                  aria-label="删除记录"
                  onClick={() => deleteRecord(record.id)}
                  className="rounded p-2 text-stone-400 transition hover:bg-red-50 hover:text-red-800"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
