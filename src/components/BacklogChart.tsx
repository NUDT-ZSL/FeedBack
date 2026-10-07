import { useMemo, useState } from 'react';
import type { BacklogSample, SourceResult, SwitchRecord, TierConfig } from '../engine/types.ts';
import { tierColor } from './colors.ts';

interface Props {
  sources: Record<string, SourceResult>;
  selectedSource: string | 'all';
  tiers: TierConfig[];
  switches: SwitchRecord[];
  horizon: number;
  timeRange: [number, number] | null;
  selectedSwitchId: string | null;
  onSelectSwitch: (id: string) => void;
  onSelectRange: (range: [number, number]) => void;
}

const W = 960;
const H = 260;
const PAD = { left: 44, right: 12, top: 18, bottom: 22 };

export default function BacklogChart(props: Props) {
  const { sources, selectedSource, tiers, switches, horizon, timeRange, selectedSwitchId } = props;
  const [hover, setHover] = useState<{ tick: number; backlog: number; tierId: string } | null>(null);

  const tierIds = tiers.map((t) => t.id);
  const [from, to] = timeRange ?? [0, horizon];
  const span = Math.max(1, to - from);

  const samples: BacklogSample[] = useMemo(() => {
    if (selectedSource !== 'all') return sources[selectedSource]?.samples ?? [];
    // 全部来源：按 tick 聚合积压
    const byTick = new Map<number, BacklogSample>();
    for (const sourceResult of Object.values(sources)) {
      for (const sample of sourceResult.samples) {
        const existing = byTick.get(sample.tick);
        if (existing) {
          existing.backlog += sample.backlog;
          existing.paused = existing.paused || sample.paused;
        } else {
          byTick.set(sample.tick, { ...sample });
        }
      }
    }
    return [...byTick.values()].sort((a, b) => a.tick - b.tick);
  }, [sources, selectedSource]);

  const visible = samples.filter((s) => s.tick >= from && s.tick <= to);
  const maxBacklog = Math.max(1, ...visible.map((s) => s.backlog), ...tiers.map((t) => t.upThreshold));
  const yMax = maxBacklog * 1.15;

  const x = (tick: number) => PAD.left + ((tick - from) / span) * (W - PAD.left - PAD.right);
  const y = (value: number) => PAD.top + (1 - value / yMax) * (H - PAD.top - PAD.bottom);

  const areaPath = useMemo(() => {
    if (visible.length === 0) return '';
    const points = visible.map((s) => `${x(s.tick).toFixed(1)},${y(s.backlog).toFixed(1)}`);
    return `M${x(visible[0].tick).toFixed(1)},${y(0)} L${points.join(' L')} L${x(visible[visible.length - 1].tick).toFixed(1)},${y(0)} Z`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, from, to, yMax]);

  const linePath = useMemo(() => {
    if (visible.length === 0) return '';
    return `M${visible.map((s) => `${x(s.tick).toFixed(1)},${y(s.backlog).toFixed(1)}`).join(' L')}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, from, to, yMax]);

  const visibleSwitches = switches.filter((sw) => sw.tick >= from && sw.tick <= to);
  const pauseSpans = useMemo(() => {
    const spans: [number, number][] = [];
    let start: number | null = null;
    for (const sample of visible) {
      if (sample.paused && start === null) start = sample.tick;
      if (!sample.paused && start !== null) {
        spans.push([start, sample.tick]);
        start = null;
      }
    }
    if (start !== null) spans.push([start, visible[visible.length - 1]?.tick ?? start]);
    return spans;
  }, [visible]);

  const thresholds = [...new Set(tiers.map((t) => t.upThreshold))].filter((t) => t > 0);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full select-none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const tick = Math.round(from + ((px - PAD.left) / (W - PAD.left - PAD.right)) * span);
          const sample = visible.find((s) => s.tick === tick);
          if (sample) setHover({ tick, backlog: sample.backlog, tierId: sample.tierId });
          else setHover(null);
        }}
        onClick={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const tick = Math.round(from + ((px - PAD.left) / (W - PAD.left - PAD.right)) * span);
          props.onSelectRange([Math.max(0, tick - 50), Math.min(horizon, tick + 50)]);
        }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0b1220" rx={8} />
        {/* 暂停区间 */}
        {pauseSpans.map(([s, e], i) => (
          <rect key={i} x={x(s)} y={PAD.top} width={Math.max(1, x(e) - x(s))} height={H - PAD.top - PAD.bottom} fill="#f97316" opacity={0.12} />
        ))}
        {/* 阈值线 */}
        {thresholds.map((threshold) => (
          <g key={threshold}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(threshold)} y2={y(threshold)} stroke="#64748b" strokeDasharray="5 4" strokeWidth={1} />
            <text x={W - PAD.right - 4} y={y(threshold) - 3} textAnchor="end" fontSize={10} fill="#94a3b8">
              阈值 {threshold}
            </text>
          </g>
        ))}
        {/* 积压曲线 */}
        <path d={areaPath} fill="#38bdf8" opacity={0.15} />
        <path d={linePath} fill="none" stroke="#38bdf8" strokeWidth={1.6} />
        {/* 档位切换标记 */}
        {visibleSwitches.map((sw) => {
          const color = tierColor(tierIds, sw.toTier);
          const cx = x(sw.tick);
          const selected = sw.id === selectedSwitchId;
          return (
            <g key={sw.id} className="cursor-pointer" onClick={(e) => { e.stopPropagation(); props.onSelectSwitch(sw.id); }}>
              <circle cx={cx} cy={PAD.top + 6} r={selected ? 8 : 6} fill={color} stroke={sw.conflict ? '#f43f5e' : '#0b1220'} strokeWidth={sw.conflict ? 2.5 : 1.5} />
              {sw.adjudication && <circle cx={cx} cy={PAD.top + 6} r={11} fill="none" stroke="#facc15" strokeWidth={1.5} />}
              <text x={cx} y={PAD.top + 9.5} textAnchor="middle" fontSize={7} fill="#0b1220" fontWeight={700}>
                {sw.toTier.slice(0, 2)}
              </text>
            </g>
          );
        })}
        {/* 坐标轴 */}
        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke="#334155" />
        <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={H - PAD.bottom} stroke="#334155" />
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <text key={f} x={PAD.left - 5} y={y(yMax * f) + 3} textAnchor="end" fontSize={9} fill="#64748b">
            {Math.round(yMax * f)}
          </text>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <text key={f} x={x(from + span * f)} y={H - 8} textAnchor="middle" fontSize={9} fill="#64748b">
            {Math.round(from + span * f)}
          </text>
        ))}
        {hover && (
          <line x1={x(hover.tick)} x2={x(hover.tick)} y1={PAD.top} y2={H - PAD.bottom} stroke="#e2e8f0" strokeWidth={0.8} opacity={0.6} />
        )}
      </svg>
      <div className="absolute right-3 top-2 rounded bg-slate-900/85 px-2 py-1 text-xs text-slate-200 border border-slate-700">
        {hover
          ? `t=${hover.tick} 积压=${hover.backlog} 档位=${hover.tierId}`
          : `区间 [${from}, ${to}] · 点击曲线局部放大`}
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-400">
        {tiers.map((tier) => (
          <span key={tier.id} className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: tierColor(tierIds, tier.id) }} />
            {tier.label ?? tier.id}（速率 {tier.rate}，阈值 {tier.upThreshold}）
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: '#f97316', opacity: 0.5 }} />
          暂停区间
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-rose-500" />
          冲突判定
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-yellow-400" />
          已人工裁决
        </span>
      </div>
    </div>
  );
}
