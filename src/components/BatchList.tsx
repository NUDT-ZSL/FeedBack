import { useState } from 'react';
import { getFlourTypeColor, getFlourTypeName } from '../MillCore';
import type { Batch } from '../types';

interface BatchListProps {
  batches: Batch[];
}

function BatchCard({ batch }: { batch: Batch }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="rounded-lg p-3"
      style={{
        background: '#f5e6c8',
        border: '1px solid #c8a878',
        color: '#5a3a1a',
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-4 w-4 rounded-full"
            style={{
              background: getFlourTypeColor(batch.type),
              border: '1px solid #8b5a2b',
            }}
          />
          <span className="font-bold">
            #{batch.seq} {getFlourTypeName(batch.type)}
          </span>
          <span className="text-sm">{batch.weight.toFixed(1)} 斤</span>
        </div>
        <span className="text-xs">{batch.timestamp}</span>
      </div>
      <div className="mt-1 text-xs" style={{ color: '#7a5a34' }}>
        加权平均间隙 {batch.avgGap.toFixed(2)}mm · 平均转速{' '}
        {batch.avgSpeed.toFixed(1)} · {batch.basis.length} 段依据
        <button
          className="ml-2 underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? '收起依据' : '查看依据'}
        </button>
      </div>
      {expanded && (
        <table className="mt-2 w-full text-xs" style={{ color: '#5a3a1a' }}>
          <thead>
            <tr className="text-left" style={{ color: '#8b5a2b' }}>
              <th className="pr-2">间隙</th>
              <th className="pr-2">转速</th>
              <th className="pr-2">时长</th>
              <th className="pr-2">配比(精/中/麸)</th>
              <th>贡献</th>
            </tr>
          </thead>
          <tbody>
            {batch.basis.map((seg, i) => (
              <tr key={i}>
                <td className="pr-2">{seg.gap.toFixed(1)}mm</td>
                <td className="pr-2">{seg.speed.toFixed(1)}</td>
                <td className="pr-2">{(seg.durationMs / 1000).toFixed(1)}s</td>
                <td className="pr-2">
                  {Math.round(seg.ratios.fine * 100)}/
                  {Math.round(seg.ratios.medium * 100)}/
                  {Math.round(seg.ratios.bran * 100)}
                </td>
                <td>{seg.contribution.toFixed(1)} 斤</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function BatchList({ batches }: BatchListProps) {
  const sorted = [...batches].sort((a, b) => b.seq - a.seq);
  return (
    <div
      className="rounded-lg p-4"
      style={{
        background: '#e8d5b0',
        border: '2px solid #8b5a2b',
        borderRadius: 8,
      }}
    >
      <h3 className="mb-3 text-base font-bold" style={{ color: '#5a3a1a' }}>
        生产批次记录（{batches.length}）
      </h3>
      {sorted.length === 0 ? (
        <p className="text-sm" style={{ color: '#7a5a34' }}>
          暂无批次。磨出面粉后点击「打包」装袋。
        </p>
      ) : (
        <div className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1">
          {sorted.map((batch) => (
            <BatchCard key={batch.id} batch={batch} />
          ))}
        </div>
      )}
    </div>
  );
}
