import { useEffect, useRef } from 'react';
import type { Particle } from '../types';

interface MillSceneProps {
  /** 转速 rpm */
  speed: number;
  /** 磨盘间隙 mm */
  gap: number;
  /** 负载 0-100 */
  load: number;
  overloaded: boolean;
}

const WOOD = '#8b5a2b';
const WOOD_LIGHT = '#d2b48c';
const DUST = '#f5e6c8';

/** 水轮 + 磨盘场景：水轮转速、磨盘间隙、负载警示、粉尘粒子 */
export default function MillScene({ speed, gap, load, overloaded }: MillSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const nextIdRef = useRef(1);
  const runningRef = useRef(false);
  runningRef.current = speed > 0 && !overloaded;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const { width, height } = canvas;

      if (runningRef.current && particlesRef.current.length < 60 && Math.random() < 0.5) {
        const angle = Math.random() * Math.PI * 2;
        const v = 20 + Math.random() * 40;
        particlesRef.current.push({
          id: nextIdRef.current++,
          x: width * 0.68,
          y: height * 0.42,
          vx: Math.cos(angle) * v,
          vy: Math.sin(angle) * v - 30,
          size: 3 + Math.random() * 3,
          opacity: 0.8,
          life: 1,
        });
      }

      particlesRef.current = particlesRef.current
        .map((p) => ({
          ...p,
          x: p.x + p.vx * dt,
          y: p.y + (p.vy += 60 * dt) * dt,
          life: p.life - dt * 0.8,
          opacity: Math.max(0, (p.life - dt * 0.8) * 0.8),
        }))
        .filter((p) => p.life > 0);

      ctx.clearRect(0, 0, width, height);
      for (const p of particlesRef.current) {
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = DUST;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const wheelPeriod = speed > 0 && !overloaded ? `${(60 / speed).toFixed(2)}s` : undefined;
  const loadColor = overloaded ? '#dc2626' : load > 60 ? '#d97706' : '#65a30d';
  // 间隙映射到两盘间距像素：0.5mm→4px，3mm→22px
  const gapPx = 4 + ((gap - 0.5) / 2.5) * 18;

  return (
    <div
      style={{
        position: 'relative',
        background: 'linear-gradient(135deg, #f5deb3 0%, #ecd3a3 60%, #e2c391 100%)',
        borderRadius: 12,
        padding: 16,
        boxShadow: 'inset -30px -20px 60px rgba(139,90,43,0.15)',
        minHeight: 300,
      }}
    >
      <canvas
        ref={canvasRef}
        width={520}
        height={280}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', flexWrap: 'wrap', gap: 16 }}>
        {/* 水轮 */}
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 140,
              height: 140,
              margin: '0 auto',
              borderRadius: '50%',
              border: `10px solid ${WOOD}`,
              position: 'relative',
              background: `radial-gradient(circle, ${WOOD_LIGHT} 0%, #b08d5f 100%)`,
              animation: wheelPeriod ? `wheel-spin ${wheelPeriod} linear infinite` : 'none',
              boxShadow: '6px 8px 16px rgba(90,60,20,0.35)',
            }}
          >
            {[0, 45, 90, 135].map((deg) => (
              <div
                key={deg}
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  width: 8,
                  height: '100%',
                  background: WOOD,
                  transform: `translate(-50%, -50%) rotate(${deg}deg)`,
                  borderRadius: 4,
                }}
              />
            ))}
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: 24,
                height: 24,
                background: '#5d3a1a',
                borderRadius: '50%',
                transform: 'translate(-50%, -50%)',
              }}
            />
          </div>
          <div style={{ marginTop: 8, color: WOOD, fontWeight: 600 }}>
            水轮 {speed.toFixed(1)} rpm
          </div>
        </div>

        {/* 磨盘 */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div
              style={{
                width: 110,
                height: 34,
                borderRadius: '50%',
                background: 'radial-gradient(ellipse, #a8a8a8 0%, #7a7a7a 100%)',
                border: '3px solid #666',
                animation: wheelPeriod ? `stone-turn ${wheelPeriod} linear infinite` : 'none',
                boxShadow: '4px 6px 10px rgba(0,0,0,0.25)',
              }}
            />
            <div
              style={{
                width: 8,
                height: gapPx,
                background: DUST,
                transition: 'height 0.4s ease-out',
                borderRadius: 2,
                opacity: runningRef.current ? 1 : 0.4,
              }}
              title={`间隙 ${gap.toFixed(1)}mm`}
            />
            <div
              style={{
                width: 120,
                height: 38,
                borderRadius: '50%',
                background: 'radial-gradient(ellipse, #b8b8b8 0%, #8a8a8a 100%)',
                border: '3px solid #666',
              }}
            />
          </div>
          <div style={{ marginTop: 8, color: WOOD, fontWeight: 600 }}>
            磨盘间隙 {gap.toFixed(1)} mm
          </div>
        </div>

        {/* 负载 */}
        <div style={{ width: 150 }}>
          <div style={{ color: WOOD, fontWeight: 600, marginBottom: 6 }}>
            磨盘负载 {load.toFixed(0)}%
          </div>
          <div style={{ height: 14, background: '#e8d5b0', borderRadius: 7, overflow: 'hidden', border: `2px solid ${WOOD}` }}>
            <div
              style={{
                height: '100%',
                width: `${load}%`,
                background: loadColor,
                transition: 'width 0.4s ease-out, background 0.4s ease-out',
                animation: overloaded ? 'overload-blink 0.6s ease-in-out infinite' : 'none',
              }}
            />
          </div>
          {overloaded && (
            <div style={{ color: '#dc2626', fontWeight: 700, marginTop: 6, fontSize: 13 }}>
              ⚠ 过载保护已停机
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
