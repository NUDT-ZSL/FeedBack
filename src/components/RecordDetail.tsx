import { useEffect, useState } from 'react';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import type { DivinationRecord } from '@/types';
import { getHexagramByBinary } from '@/data/hexagrams';
import { useDivinationStore } from '@/store';
import { formatDateTime } from '@/lib/utils';
import HexagramView from '@/components/HexagramView';
import DeductionView from '@/components/DeductionView';

interface RecordDetailProps {
  record: DivinationRecord;
}

function HexagramPanel({
  title,
  binary,
  movingPositions,
  changedPositions,
}: {
  title: string;
  binary: string;
  movingPositions?: number[];
  changedPositions?: number[];
}) {
  const hexagram = getHexagramByBinary(binary);
  if (!hexagram) return null;
  return (
    <div className="rounded-lg border border-amber-900/20 bg-[#f8f1e2] p-4">
      <h3 className="font-kai mb-3 text-center text-lg font-bold text-amber-900">{title}</h3>
      <div className="mb-3 flex justify-center">
        <HexagramView
          binary={binary}
          movingPositions={movingPositions}
          changedPositions={changedPositions}
        />
      </div>
      <p className="font-kai mb-2 text-center text-xl font-bold text-stone-900">{hexagram.name}</p>
      <div className="space-y-2">
        <p className="text-xs font-bold text-stone-500">卦辞</p>
        <p className="font-kai text-sm leading-relaxed text-stone-800">{hexagram.guaCi}</p>
        <p className="text-xs font-bold text-stone-500">象辞</p>
        <p className="font-kai text-sm leading-relaxed text-stone-800">{hexagram.xiangCi}</p>
      </div>
    </div>
  );
}

/** 归档记录详情：还原卦象爻位，本卦变卦对照，可编辑所问之事 */
export default function RecordDetail({ record }: RecordDetailProps) {
  const { selectRecord, deleteRecord, updateQuestion } = useDivinationStore();
  const [question, setQuestion] = useState(record.question);

  useEffect(() => {
    setQuestion(record.question);
  }, [record.id, record.question]);

  const changedPositions = record.yaos
    .filter((y) => y.isMoving)
    .map((y) => y.position);

  return (
    <div className="fade-in mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => selectRecord(null)}
          className="flex items-center gap-1 rounded-lg border border-stone-400 bg-[#f8f1e2] px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-200/60"
        >
          <ArrowLeft className="h-4 w-4" /> 返回卦录
        </button>
        <button
          type="button"
          onClick={() => deleteRecord(record.id)}
          className="flex items-center gap-1 rounded-lg border border-red-800/40 bg-red-50 px-3 py-1.5 text-sm text-red-800 hover:bg-red-100"
        >
          <Trash2 className="h-4 w-4" /> 删除此记录
        </button>
      </div>

      <div className="mb-4 rounded-lg border border-amber-900/20 bg-[#f8f1e2] p-4">
        <p className="text-sm text-stone-600">起卦时刻：{formatDateTime(record.createdAt)}</p>
        <p className="mt-0.5 text-xs text-stone-400">记录编号：{record.id}</p>
        <div className="mt-3">
          <label htmlFor="question" className="mb-1 block text-sm font-bold text-stone-700">
            所问之事
          </label>
          <div className="flex gap-2">
            <textarea
              id="question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={2}
              placeholder="补记本次起卦所问之事…"
              className="flex-1 resize-none rounded border border-stone-300 bg-white px-3 py-2 text-sm focus:border-amber-700 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => updateQuestion(record.id, question)}
              disabled={question === record.question}
              className="flex items-center gap-1 self-start rounded bg-amber-800 px-3 py-2 text-sm text-white hover:bg-amber-900 disabled:opacity-40"
            >
              <Save className="h-4 w-4" /> 保存
            </button>
          </div>
        </div>
      </div>

      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <HexagramPanel title="本卦" binary={record.benBinary} movingPositions={record.movingPositions} />
        <HexagramPanel
          title={record.bianBinary === record.benBinary ? '变卦（无动爻，与本卦一致）' : '变卦'}
          binary={record.bianBinary}
          changedPositions={changedPositions}
        />
      </div>

      <DeductionView benBinary={record.benBinary} movingPositions={record.movingPositions} />
    </div>
  );
}
