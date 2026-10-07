import { useEffect, useRef, useState } from 'react';
import {
  BASE_RATE,
  FIXED_DT,
  SoulFlameEngine,
} from '../soulflame/engine.ts';
import { flameVisuals } from '../soulflame/render.ts';
import type { FlameSnapshot, SoulSource, SourceType, Wick } from '../soulflame/types.ts';

const LANTERN_COLORS: Record<string, string> = {
  red: '#ff5555',
  blue: '#5599ff',
  gold: '#ffdd44',
};

const WICKS: Wick[] = [
  { id: 'red', name: '赤焰芯', sourceIds: ['ley-a', 'blood-a'] },
  { id: 'blue', name: '幽蓝芯', sourceIds: ['ley-a', 'spirit-a', 'spirit-b'] },
  { id: 'gold', name: '鎏金芯', sourceIds: ['ley-a', 'blood-a', 'spirit-a'] },
];

const INITIAL_SOURCES: SoulSource[] = [
  { id: 'ley-a', type: 'ley', priority: 2, intensity: 0.8 },
  { id: 'spirit-a', type: 'spirit', priority: 1, intensity: 0.9 },
  { id: 'spirit-b', type: 'spirit', priority: 1, intensity: 0.6 },
  { id: 'blood-a', type: 'blood', priority: 3, intensity: 0.4 },
];

const FORM_LABEL: Record<string, string> = {
  out: '熄灭',
  embers: '余烬',
  weak: '微弱',
  steady: '稳定',
  bright: '明亮',
  surging: '奔涌',
};

const TYPE_LABEL: Record<SourceType, string> = {
  ley: '地脉',
  spirit: '游魂',
  blood: '精血',
};

export default function SoulLantern() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<SoulFlameEngine | null>(null);
  const [snap, setSnap] = useState<FlameSnapshot | null>(null);
  const [sources, setSources] = useState<SoulSource[]>(INITIAL_SOURCES);
  const [wickId, setWickId] = useState<string>('red');
  const [artFlash, setArtFlash] = useState(false);

  useEffect(() => {
    const engine = new SoulFlameEngine({});
    for (const wick of WICKS) engine.addWick(wick);
    for (const s of INITIAL_SOURCES) engine.addSource(s);
    engine.switchWick('red');
    engineRef.current = engine;

    let raf = 0;
    let acc = 0;
    let last = performance.now();
    let frameCount = 0;

    const loop = (now: number) => {
      acc += Math.min(0.1, (now - last) / 1000);
      last = now;
      while (acc >= FIXED_DT) {
        engine.step();
        acc -= FIXED_DT;
      }
      frameCount += 1;
      if (frameCount % 6 === 0) setSnap(engine.getSnapshot());
      draw(canvasRef.current, engine.getSnapshot());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    setSnap(engine.getSnapshot());
    return () => cancelAnimationFrame(raf);
  }, []);

  const updateIntensity = (id: string, intensity: number) => {
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, intensity } : s)));
    engineRef.current?.setIntensity(id, intensity);
  };

  const handleWick = (id: string) => {
    if (engineRef.current?.switchWick(id)) {
      setWickId(id);
      setSnap(engineRef.current.getSnapshot());
    }
  };

  const handleSoulArt = () => {
    engineRef.current?.castSoulArt();
    setArtFlash(true);
    window.setTimeout(() => setArtFlash(false), 240);
  };

  const connectedIds = WICKS.find((w) => w.id === wickId)?.sourceIds ?? [];

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-[#0a0e1a] to-[#1a2a3a] text-slate-200 flex flex-col items-center py-8 gap-6 select-none">
      <header className="text-center">
        <h1 className="text-2xl tracking-[0.4em] text-amber-200/90">幽冥魂灯</h1>
        <p className="text-xs text-slate-400 mt-1">魂力流转 · 灯焰联动演示（固定步长，离线可复现）</p>
      </header>

      <div className="flex flex-col lg:flex-row gap-8 items-center">
        <div
          className="relative rounded-full border border-amber-100/10 bg-black/30 overflow-hidden cursor-grab active:cursor-grabbing"
          style={{ width: 320, height: 360 }}
          onPointerDown={() => engineRef.current?.setDragging(true)}
          onPointerUp={() => engineRef.current?.setDragging(false)}
          onPointerLeave={() => engineRef.current?.setDragging(false)}
        >
          <canvas ref={canvasRef} width={320} height={360} className="block touch-none" />
          {artFlash && <div className="absolute inset-0 bg-white/60 animate-pulse pointer-events-none" />}
          <div className="absolute bottom-2 left-0 right-0 text-center text-[11px] text-slate-400">
            按住灯体拖动 = 消耗魂力
          </div>
        </div>

        <div className="w-[300px] flex flex-col gap-4">
          <section className="rounded-lg bg-white/5 p-4">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-slate-300">形态</span>
              <span className="text-amber-200">{snap ? FORM_LABEL[snap.form] : '—'}</span>
            </div>
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-slate-300">亮度</span>
              <span className="text-amber-200 tabular-nums">
                {snap ? (snap.brightness * 100).toFixed(1) : '0'}%
              </span>
            </div>
            <div className="text-sm mb-1 text-slate-300">魂力储量</div>
            <div className="h-3 rounded-full bg-black/40 overflow-hidden">
              <div
                className="h-full rounded-full transition-[width] duration-100"
                style={{
                  width: `${(snap?.storageRatio ?? 0) * 100}%`,
                  background: snap?.lowReserve
                    ? 'linear-gradient(90deg,#5599ff,#88ccff)'
                    : 'linear-gradient(90deg,#ff8a3d,#ffdd44)',
                }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-slate-400 tabular-nums">
              <span>注 {snap?.injectionRate.toFixed(2) ?? '0'}/s</span>
              <span>耗 {snap?.consumptionRate.toFixed(2) ?? '0'}/s</span>
              <span>{snap?.storage.toFixed(1) ?? '0'} / {snap?.capacity ?? 100}</span>
            </div>
            {snap?.extinguishing && (
              <div className="mt-2 text-[11px] text-sky-300/80">灯焰熄灭过渡中…</div>
            )}
          </section>

          <section className="rounded-lg bg-white/5 p-4">
            <div className="text-sm text-slate-300 mb-2">灯芯</div>
            <div className="grid grid-cols-3 gap-2">
              {WICKS.map((w) => (
                <button
                  key={w.id}
                  onClick={() => handleWick(w.id)}
                  className="rounded-md px-2 py-1.5 text-xs border transition-colors"
                  style={{
                    borderColor: wickId === w.id ? LANTERN_COLORS[w.id] : 'rgba(255,255,255,0.15)',
                    color: wickId === w.id ? LANTERN_COLORS[w.id] : '#94a3b8',
                    background: wickId === w.id ? `${LANTERN_COLORS[w.id]}22` : 'transparent',
                  }}
                >
                  {w.name}
                </button>
              ))}
            </div>
            <button
              onClick={handleSoulArt}
              className="mt-3 w-full rounded-md px-2 py-1.5 text-xs border border-amber-200/40 text-amber-200 hover:bg-amber-200/10"
            >
              触发魂术（−20 魂力）
            </button>
          </section>

          <section className="rounded-lg bg-white/5 p-4">
            <div className="text-sm text-slate-300 mb-2">魂力来源强度</div>
            <div className="flex flex-col gap-2">
              {sources.map((s) => {
                const connected = connectedIds.includes(s.id);
                return (
                  <label key={s.id} className="flex items-center gap-2 text-xs">
                    <span
                      className="w-12 shrink-0"
                      style={{ color: connected ? '#e2e8f0' : '#64748b' }}
                    >
                      {TYPE_LABEL[s.type]}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={s.intensity}
                      disabled={!connected}
                      onChange={(e) => updateIntensity(s.id, Number(e.target.value))}
                      className="flex-1 accent-amber-300 disabled:opacity-30"
                    />
                    <span className="w-9 text-right tabular-nums text-slate-400">
                      {s.intensity.toFixed(2)}
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="mt-2 text-[10px] leading-4 text-slate-500">
              基础注入：地脉 {BASE_RATE.ley}、游魂 {BASE_RATE.spirit}、精血 {BASE_RATE.blood} 单位/秒；
              来源按优先级接纳，同级按强度比例分摊。
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

function draw(canvas: HTMLCanvasElement | null, snap: FlameSnapshot) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const v = flameVisuals(snap);
  const cx = W / 2;
  const baseY = H - 90;

  // 灯座
  ctx.fillStyle = '#20283a';
  ctx.beginPath();
  ctx.ellipse(cx, baseY + 18, 64, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2c3852';
  ctx.fillRect(cx - 40, baseY - 6, 80, 22);

  if (v.alpha <= 0.004) return;

  const flameH = 200 * v.height;
  const flameW = 70 * v.width;
  const sway = Math.sin(snap.tick * 0.17) * 6 * v.flicker;
  const hue = 32 + v.hueShift;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // 外辉光
  const glow = ctx.createRadialGradient(cx, baseY - flameH * 0.5, 4, cx, baseY - flameH * 0.5, 120 * v.glow + 10);
  glow.addColorStop(0, `hsla(${hue}, 90%, 65%, ${0.5 * v.alpha})`);
  glow.addColorStop(1, 'hsla(28, 90%, 55%, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // 火焰外焰
  const grad = ctx.createLinearGradient(0, baseY - flameH, 0, baseY);
  grad.addColorStop(0, `hsla(${hue + 10}, 95%, 70%, 0)`);
  grad.addColorStop(0.35, `hsla(${hue + 6}, 95%, 60%, ${0.75 * v.alpha})`);
  grad.addColorStop(1, `hsla(${hue - 6}, 95%, 48%, ${0.95 * v.alpha})`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(cx - flameW * 0.5, baseY);
  ctx.bezierCurveTo(cx - flameW * 0.7, baseY - flameH * 0.35, cx + sway - flameW * 0.25, baseY - flameH * 0.7, cx + sway, baseY - flameH);
  ctx.bezierCurveTo(cx + sway + flameW * 0.25, baseY - flameH * 0.7, cx + flameW * 0.7, baseY - flameH * 0.35, cx + flameW * 0.5, baseY);
  ctx.closePath();
  ctx.fill();

  // 内焰
  const innerH = flameH * 0.55;
  const innerW = flameW * 0.42;
  const inner = ctx.createLinearGradient(0, baseY - innerH, 0, baseY);
  inner.addColorStop(0, 'hsla(48, 100%, 85%, 0)');
  inner.addColorStop(0.5, `hsla(46, 100%, 78%, ${0.8 * v.alpha})`);
  inner.addColorStop(1, `hsla(40, 100%, 66%, ${0.95 * v.alpha})`);
  ctx.fillStyle = inner;
  ctx.beginPath();
  ctx.moveTo(cx - innerW * 0.5, baseY - 2);
  ctx.bezierCurveTo(cx - innerW * 0.8, baseY - innerH * 0.3, cx + sway * 0.5 - innerW * 0.2, baseY - innerH * 0.7, cx + sway * 0.5, baseY - innerH);
  ctx.bezierCurveTo(cx + sway * 0.5 + innerW * 0.2, baseY - innerH * 0.7, cx + innerW * 0.8, baseY - innerH * 0.3, cx + innerW * 0.5, baseY - 2);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}
