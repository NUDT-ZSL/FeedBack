import { useBackpressureStore } from '@/state/store';

const W = 900;
const H = 320;
const PAD = { top: 16, right: 16, bottom: 28, left: 56 };

export default function BacklogChart() {
  const { derivation, params } = useBackpressureStore();
  const { curve, decisions } = derivation;

  if (curve.length === 0) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900/80 p-4 text-sm text-slate-400">
        暂无曲线
      </div>
    );
  }

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const n = curve.length;
  const maxY = Math.max(
    params.highThreshold,
    params.lowThreshold,
    ...curve.map((point) => point.backlog),
    1,
  );
  const x = (tick: number) => PAD.left + (n <= 1 ? 0 : (tick / (n - 1)) * plotW);
  const y = (value: number) => PAD.top + plotH - (value / maxY) * plotH;

  const linePath = curve
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.tick).toFixed(1)},${y(point.backlog).toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L${x(n - 1).toFixed(1)},${(PAD.top + plotH).toFixed(1)} L${x(0).toFixed(1)},${(PAD.top + plotH).toFixed(1)} Z`;

  const disputedRanges: [number, number][] = [];
  for (const point of curve) {
    if (!point.disputed) continue;
    const last = disputedRanges[disputedRanges.length - 1];
    if (last && last[1] === point.tick - 1) last[1] = point.tick;
    else disputedRanges.push([point.tick, point.tick]);
  }

  const yTicks = 4;
  const tickStep = maxY / yTicks;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/80 p-4">
      <h2 className="mb-2 text-sm font-semibold text-slate-200">
        积压曲线与背压判定
        <span className="ml-2 text-xs font-normal text-slate-500">
          阴影=待裁决区间（不参与背压结论） · ▲触发 ▼解除
        </span>
      </h2>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const value = Number((tickStep * i).toFixed(1));
          return (
            <g key={i}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(value)}
                y2={y(value)}
                stroke="#1e293b"
              />
              <text x={PAD.left - 8} y={y(value) + 4} textAnchor="end" fontSize="11" fill="#64748b">
                {value}
              </text>
            </g>
          );
        })}

        {disputedRanges.map(([from, to], index) => (
          <rect
            key={index}
            x={x(from) - plotW / (n - 1) / 2}
            y={PAD.top}
            width={(to - from + 1) * (plotW / (n - 1))}
            height={plotH}
            fill="#f59e0b"
            opacity="0.10"
          />
        ))}

        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={y(params.highThreshold)}
          y2={y(params.highThreshold)}
          stroke="#ef4444"
          strokeDasharray="6 4"
          strokeWidth="1.2"
        />
        <text x={W - PAD.right} y={y(params.highThreshold) - 4} textAnchor="end" fontSize="10" fill="#f87171">
          high={params.highThreshold}
        </text>
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={y(params.lowThreshold)}
          y2={y(params.lowThreshold)}
          stroke="#22c55e"
          strokeDasharray="6 4"
          strokeWidth="1.2"
        />
        <text x={W - PAD.right} y={y(params.lowThreshold) - 4} textAnchor="end" fontSize="10" fill="#4ade80">
          low={params.lowThreshold}
        </text>

        <path d={areaPath} fill="#38bdf8" opacity="0.12" />
        <path d={linePath} fill="none" stroke="#38bdf8" strokeWidth="1.8" />

        {decisions.map((decision) => (
          <g key={`${decision.type}-${decision.seq}`}>
            <text
              x={x(decision.tick)}
              y={decision.type === 'trigger' ? y(decision.backlog) - 10 : y(decision.backlog) + 18}
              textAnchor="middle"
              fontSize="13"
              fill={decision.type === 'trigger' ? '#f87171' : '#4ade80'}
            >
              {decision.type === 'trigger' ? '▲' : '▼'}
            </text>
          </g>
        ))}

        <text x={PAD.left} y={H - 6} fontSize="11" fill="#64748b">
          #0
        </text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" fontSize="11" fill="#64748b">
          #{n - 1}（{((n - 1) * params.tickMs).toLocaleString()}ms）
        </text>
      </svg>
      <p className="text-right text-xs text-slate-500">当前积压：{curve[curve.length - 1]?.backlog ?? 0}</p>
    </div>
  );
}
