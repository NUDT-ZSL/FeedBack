import { useSimulationStore } from '@/store/simulationStore';
import type { FieldResult } from '@/simulation/types';

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-md bg-white/70 px-3 py-2 shadow-sm">
      <div className="text-[11px] text-stone-500">{label}</div>
      <div className={`font-mono text-lg leading-tight ${accent ? 'text-sky-800' : 'text-stone-800'}`}>
        {value}
      </div>
    </div>
  );
}

/** 蓄水率沿刻度变化的迷你轨迹（界面只负责画引擎给出的数据） */
function TraceSparkline({ field }: { field: FieldResult }) {
  const width = 220;
  const height = 44;
  const points = field.trace.map((point, index) => {
    const x = (index / Math.max(1, field.trace.length - 1)) * width;
    const y = height - point.storageRatio * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const thresholdY = height - field.cropThreshold * height;
  return (
    <svg width={width} height={height} className="block">
      <line
        x1={0}
        x2={width}
        y1={thresholdY}
        y2={thresholdY}
        stroke="#b45309"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="#1a5276"
        strokeWidth={1.5}
      />
    </svg>
  );
}

function FieldCard({ field, recomputed }: { field: FieldResult; recomputed: boolean }) {
  return (
    <div
      className={`rounded-lg border p-3 shadow-sm transition-colors ${
        field.deficit ? 'border-amber-500/60 bg-amber-50/80' : 'border-emerald-700/30 bg-white/80'
      }`}
    >
      <div className="mb-1 flex items-center justify-between">
        <div className="text-sm font-semibold text-stone-800">
          {field.name}
          {recomputed && (
            <span className="ml-2 rounded bg-sky-800 px-1.5 py-0.5 text-[10px] text-white">
              已重算
            </span>
          )}
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            field.deficit ? 'bg-amber-500 text-white' : 'bg-emerald-700 text-white'
          }`}
        >
          {field.deficit ? '缺水' : '不缺水'}
        </span>
      </div>

      <div className="mb-1 h-3 w-full overflow-hidden rounded-full bg-stone-200">
        <div
          className={`h-full ${field.deficit ? 'bg-amber-500' : 'bg-emerald-600'}`}
          style={{ width: `${Math.min(100, field.storageRatio * 100).toFixed(1)}%` }}
        />
      </div>

      <TraceSparkline field={field} />

      <div className="mt-1 font-mono text-[11px] text-stone-500">
        蓄水 {field.finalStorage.toFixed(2)} / {field.capacity}（{(field.storageRatio * 100).toFixed(1)}%）
        ｜缺水 {field.deficitTicks}/{field.trace.length} 刻
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-stone-600">{field.basis}</p>
    </div>
  );
}

export default function ResultsPanel() {
  const result = useSimulationStore((state) => state.result);
  const consistent = useSimulationStore((state) => state.consistent);
  const fingerprint = useSimulationStore((state) => state.fingerprint);

  const recomputed = new Set(result.meta.recomputedFields);

  return (
    <div className="flex-1 space-y-4 overflow-y-auto">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Stat label="水车转速" value={result.wheelSpeed.toFixed(3)} accent />
        <Stat label="提水量/刻" value={result.liftedFlow.toFixed(3)} />
        <Stat label="总来流/刻" value={result.totalInflow.toFixed(3)} accent />
        <Stat
          label="增量 ≡ 整体"
          value={consistent ? '一致' : '不一致'}
        />
        <Stat label="结果指纹" value={fingerprint} />
      </div>

      <div className="rounded-lg bg-white/70 p-3 shadow-sm">
        <div className="mb-2 text-sm font-semibold text-emerald-900">
          渠道分流
          <span className="ml-2 text-xs font-normal text-stone-500">
            本次局部重算：{result.meta.recomputedFields.length > 0
              ? result.meta.recomputedFields.join('、')
              : '全部沿用缓存'}
          </span>
        </div>
        <div className="space-y-1.5">
          {result.channels.map((channel) => {
            const maxFlow = Math.max(1, ...result.channels.map((item) => item.flow));
            return (
              <div key={channel.channelId} className="flex items-center gap-2 text-xs">
                <span className="w-24 shrink-0 text-stone-700">
                  {channel.name}（比例 {(channel.ratio * 100).toFixed(0)}%）
                </span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-stone-200">
                  <div
                    className="h-full bg-sky-700"
                    style={{ width: `${(channel.flow / maxFlow) * 100}%` }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right font-mono text-stone-600">
                  {channel.flow.toFixed(3)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-emerald-900">田块蓄水与缺水判定</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {result.fields.map((field) => (
            <FieldCard key={field.fieldId} field={field} recomputed={recomputed.has(field.fieldId)} />
          ))}
        </div>
      </div>
    </div>
  );
}
