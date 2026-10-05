import { useState } from 'react';
import type { Params } from '@/engine/types';

interface Props {
  params: Params;
  onApply: (params: Params, fromTime: number) => void;
}

/** 参数调整表单：消费速率 / 阈值 / 突发上限，自指定时刻起生效 */
export default function ParamForm({ params, onApply }: Props) {
  const [consumeRate, setConsumeRate] = useState(params.consumeRate);
  const [threshold, setThreshold] = useState(params.threshold);
  const [burstLimit, setBurstLimit] = useState(params.burstLimit);
  const [fromTime, setFromTime] = useState(0);

  return (
    <div className="space-y-2 text-sm">
      <label className="flex items-center justify-between gap-2">
        消费速率
        <input
          type="number"
          min={0}
          value={consumeRate}
          onChange={(e) => setConsumeRate(Number(e.target.value))}
          className="w-24 rounded border border-slate-300 px-1.5 py-0.5 text-right"
        />
      </label>
      <label className="flex items-center justify-between gap-2">
        背压阈值
        <input
          type="number"
          min={0}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="w-24 rounded border border-slate-300 px-1.5 py-0.5 text-right"
        />
      </label>
      <label className="flex items-center justify-between gap-2">
        突发上限
        <input
          type="number"
          min={0}
          value={burstLimit}
          onChange={(e) => setBurstLimit(Number(e.target.value))}
          className="w-24 rounded border border-slate-300 px-1.5 py-0.5 text-right"
        />
      </label>
      <label className="flex items-center justify-between gap-2">
        生效时刻 (s)
        <input
          type="number"
          min={0}
          step={0.1}
          value={fromTime}
          onChange={(e) => setFromTime(Number(e.target.value))}
          className="w-24 rounded border border-slate-300 px-1.5 py-0.5 text-right"
        />
      </label>
      <button
        className="w-full rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
        onClick={() => onApply({ consumeRate, threshold, burstLimit }, fromTime)}
      >
        调整参数（只重推生效时刻起的区间）
      </button>
    </div>
  );
}
