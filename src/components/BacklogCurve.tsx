import type { EngineResult, Params } from '@/engine/types';

interface Props {
  result: EngineResult;
  params: Params;
}

const W = 780;
const H = 260;
const PAD = { left: 44, right: 12, top: 12, bottom: 24 };

/** 积压曲线：分段线性 + 到达跳变，叠加阈值线、待裁决区间与决策标记 */
export default function BacklogCurve({ result, params }: Props) {
  const { curve, intervals, decisions } = result;
  const maxTime = Math.max(1, ...curve.map((p) => p.time));
  const maxBacklog = Math.max(1, params.threshold * 1.2, ...curve.map((p) => p.backlog));
  const x = (t: number) => PAD.left + (t / maxTime) * (W - PAD.left - PAD.right);
  const y = (b: number) => H - PAD.bottom - (b / maxBacklog) * (H - PAD.top - PAD.bottom);

  const path = curve
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.time).toFixed(1)},${y(p.backlog).toFixed(1)}`)
    .join(' ');

  const tainted = intervals.filter((r) => r.tainted);
  const ticks = 5;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded border border-slate-200 bg-white">
      {tainted.map((r) => (
        <rect
          key={`t${r.index}`}
          x={x(r.start)}
          y={PAD.top}
          width={Math.max(2, x(Math.min(r.end, maxTime)) - x(r.start))}
          height={H - PAD.top - PAD.bottom}
          fill="#f59e0b"
          opacity={0.15}
        >
          <title>{`区间#${r.index} 含待裁决冲突，暂缓结论`}</title>
        </rect>
      ))}
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const gy = PAD.top + ((H - PAD.top - PAD.bottom) / ticks) * i;
        const val = (maxBacklog * (ticks - i)) / ticks;
        return (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={gy} y2={gy} stroke="#e2e8f0" strokeWidth={1} />
            <text x={PAD.left - 6} y={gy + 4} textAnchor="end" fontSize={10} fill="#64748b">
              {Math.round(val)}
            </text>
          </g>
        );
      })}
      <line
        x1={PAD.left}
        x2={W - PAD.right}
        y1={y(params.threshold)}
        y2={y(params.threshold)}
        stroke="#ef4444"
        strokeDasharray="6 4"
        strokeWidth={1.5}
      >
        <title>{`背压阈值 ${params.threshold}`}</title>
      </line>
      <text x={W - PAD.right - 4} y={y(params.threshold) - 4} textAnchor="end" fontSize={10} fill="#ef4444">
        阈值 {params.threshold}
      </text>
      <path d={path} fill="none" stroke="#2563eb" strokeWidth={2} />
      {decisions.map((d) => {
        const cx = x(d.time);
        const cy = y(d.backlog);
        if (d.kind === 'trigger') {
          return (
            <polygon
              key={d.id}
              points={`${cx},${cy - 6} ${cx - 5},${cy + 4} ${cx + 5},${cy + 4}`}
              fill="#dc2626"
            >
              <title>{d.explanation}</title>
            </polygon>
          );
        }
        if (d.kind === 'release') {
          return (
            <circle key={d.id} cx={cx} cy={cy} r={4.5} fill="#16a34a">
              <title>{d.explanation}</title>
            </circle>
          );
        }
        return (
          <rect key={d.id} x={cx - 4} y={cy - 4} width={8} height={8} fill="#ea580c" transform={`rotate(45 ${cx} ${cy})`}>
            <title>{d.explanation}</title>
          </rect>
        );
      })}
      <text x={PAD.left} y={H - 6} fontSize={10} fill="#64748b">0s</text>
      <text x={W - PAD.right} y={H - 6} textAnchor="end" fontSize={10} fill="#64748b">
        {maxTime.toFixed(1)}s
      </text>
    </svg>
  );
}
