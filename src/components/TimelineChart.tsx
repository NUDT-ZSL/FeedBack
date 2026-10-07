import { useEffect, useMemo, useRef, useState } from "react";
import { useSimStore } from "@/store/simStore";
import { SwitchRecord } from "@/engine";

const TIER_COLORS = [
  "rgba(245,158,11,0.14)",
  "rgba(239,68,68,0.14)",
  "rgba(168,85,247,0.16)",
  "rgba(59,130,246,0.16)",
  "rgba(16,185,129,0.16)",
];
const SOURCE_COLORS = ["#38bdf8", "#f472b6", "#a3e635", "#fbbf24", "#c084fc", "#34d399"];

export default function TimelineChart() {
  const output = useSimStore((s) => s.output);
  const config = useSimStore((s) => s.config);
  const sourceFilter = useSimStore((s) => s.sourceFilter);
  const selectedSwitchId = useSimStore((s) => s.selectedSwitchId);
  const selectSwitch = useSimStore((s) => s.selectSwitch);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; text: string[] } | null>(null);

  const sources = useMemo(() => {
    const set = new Set<string>();
    output?.series.forEach((p) => Object.keys(p.perSource).forEach((k) => set.add(k)));
    output?.events.forEach((e) => set.add(e.sourceId));
    return [...set].sort();
  }, [output]);

  const layout = useMemo(() => {
    if (!output || output.series.length === 0) return null;
    const t0 = output.series[0].time;
    const t1 = Math.max(output.stats.endTime, output.series[output.series.length - 1].time, t0 + 1e-6);
    const maxB = Math.max(
      1,
      ...output.series.map((p) => p.total),
      ...config.tiers.map((t) => t.threshold),
    );
    return { t0, t1, maxB };
  }, [output, config]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !output || !layout) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const padL = 44, padR = 12, padT = 14, padB = 22;
    const iw = W - padL - padR;
    const ih = H - padT - padB;
    const X = (t: number) => padL + ((t - layout.t0) / (layout.t1 - layout.t0)) * iw;
    const Y = (b: number) => padT + ih - (b / layout.maxB) * ih;

    // 档位生效区间底色
    for (let i = 0; i < output.switches.length; i++) {
      const sw = output.switches[i];
      if (!sw.toTier) continue;
      const tierIdx = config.tiers.findIndex((t) => t.id === sw.toTier);
      ctx.fillStyle = TIER_COLORS[tierIdx % TIER_COLORS.length];
      ctx.fillRect(X(sw.range.start), padT, Math.max(1, X(sw.range.end) - X(sw.range.start)), ih);
    }

    // 阈值虚线
    config.tiers.forEach((tier, i) => {
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(padL, Y(tier.threshold));
      ctx.lineTo(W - padR, Y(tier.threshold));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = "10px sans-serif";
      ctx.fillText(`${tier.id}(${tier.threshold})`, padL + 4, Y(tier.threshold) - 3 + (i % 2) * 10);
    });

    // 坐标轴
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + ih);
    ctx.lineTo(padL + iw, padT + ih);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "10px sans-serif";
    const ticks = 6;
    for (let i = 0; i <= ticks; i++) {
      const t = layout.t0 + ((layout.t1 - layout.t0) * i) / ticks;
      ctx.fillText(t.toFixed(1) + "s", X(t) - 10, padT + ih + 14);
    }
    for (let i = 0; i <= 4; i++) {
      const b = (layout.maxB * i) / 4;
      ctx.fillText(String(Math.round(b)), 6, Y(b) + 3);
    }

    // 积压曲线（总量）
    ctx.strokeStyle = "#f8fafc";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    output.series.forEach((p, i) => {
      const x = X(p.time), y = Y(p.total);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 分来源曲线
    if (sourceFilter) {
      ctx.strokeStyle = SOURCE_COLORS[sources.indexOf(sourceFilter) % SOURCE_COLORS.length];
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      output.series.forEach((p, i) => {
        const x = X(p.time), y = Y(p.perSource[sourceFilter] ?? 0);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // 档位切换标记
    output.switches.forEach((sw) => {
      const x = X(sw.time);
      const up = sw.direction !== "release";
      ctx.fillStyle = sw.id === selectedSwitchId ? "#fbbf24" : up ? "#ef4444" : "#22c55e";
      ctx.beginPath();
      const y = padT + 6;
      if (up) { ctx.moveTo(x, y); ctx.lineTo(x - 5, y + 9); ctx.lineTo(x + 5, y + 9); }
      else { ctx.moveTo(x, y + 9); ctx.lineTo(x - 5, y); ctx.lineTo(x + 5, y); }
      ctx.closePath();
      ctx.fill();
      if (sw.id === selectedSwitchId) {
        ctx.strokeStyle = "#fbbf24";
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + ih);
        ctx.stroke();
      }
    });
  }, [output, layout, config, sourceFilter, selectedSwitchId, sources]);

  if (!output) return null;
  if (output.series.length === 0) {
    return <div className="text-sm text-zinc-400 p-4">事件流为空，无积压数据。</div>;
  }

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!layout) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const padL = 44, padR = 12;
    const iw = rect.width - padL - padR;
    const t = layout.t0 + ((px - padL) / iw) * (layout.t1 - layout.t0);
    let best: SwitchRecord | null = null;
    for (const sw of output.switches) {
      if (!best || Math.abs(sw.time - t) < Math.abs(best.time - t)) best = sw;
    }
    if (best && Math.abs(best.time - t) / (layout.t1 - layout.t0) < 0.03) {
      selectSwitch(best.id === selectedSwitchId ? null : best.id);
    } else {
      selectSwitch(null);
    }
  };

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!layout) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const padL = 44, padR = 12;
    const iw = rect.width - padL - padR;
    const t = layout.t0 + ((px - padL) / iw) * (layout.t1 - layout.t0);
    const series = output.series;
    let idx = 0;
    for (let i = 0; i < series.length; i++) if (series[i].time <= t) idx = i;
    const p = series[idx];
    if (!p) return;
    const lines = [
      `t=${p.time.toFixed(3)}s 积压=${p.total} 档位=${p.tierId ?? "基础"}`,
      ...Object.entries(p.perSource).map(([k, v]) => `  ${k}: ${v}`),
    ];
    setHover({ x: px, y: e.clientY - rect.top, text: lines });
  };

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        className="w-full h-64 cursor-crosshair"
        onClick={onClick}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      />
      {hover && (
        <div
          className="absolute pointer-events-none bg-zinc-900/95 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 whitespace-pre z-10"
          style={{ left: Math.min(hover.x + 12, 320), top: hover.y + 8 }}
        >
          {hover.text.join("\n")}
        </div>
      )}
      <div className="flex gap-3 mt-1 text-xs text-zinc-400 flex-wrap">
        <span><span className="text-red-400">▲</span> 升级</span>
        <span><span className="text-green-400">▼</span> 释放</span>
        <span><span className="text-amber-300">▲</span> 选中</span>
        <span>虚线=档位阈值；底色=档位生效区间</span>
      </div>
    </div>
  );
}
