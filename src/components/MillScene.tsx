import { useEffect, useRef, useState } from 'react';
import {
  createParticle,
  updateParticle,
  MAX_PARTICLES,
  OVERLOAD_THRESHOLD,
} from '../MillCore';
import type { Particle } from '../types';

interface MillSceneProps {
  wheelSpeed: number;
  gap: number;
  load: number;
  isOverloaded: boolean;
  isRunning: boolean;
}

/** 水轮 + 磨盘场景：纯展示组件，粉尘粒子为本地视觉状态，不参与账目 */
export default function MillScene({
  wheelSpeed,
  gap,
  load,
  isOverloaded,
  isRunning,
}: MillSceneProps) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const particleSeq = useRef(0);
  const producing = isRunning && !isOverloaded;

  useEffect(() => {
    if (!producing) {
      setParticles([]);
      return;
    }
    let raf = 0;
    let last = performance.now();
    let spawnAcc = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      spawnAcc += dt;
      setParticles((prev) => {
        let next = prev
          .map((p) => updateParticle(p, dt))
          .filter((p): p is Particle => p !== null);
        // 每 ~90ms 生成一粒粉尘，上限 MAX_PARTICLES
        if (spawnAcc > 0.09 && next.length < MAX_PARTICLES) {
          spawnAcc = 0;
          particleSeq.current += 1;
          next = [
            ...next,
            createParticle(150, 120, `p-${particleSeq.current}`),
          ];
        }
        return next;
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [producing]);

  // 水轮旋转周期：转速 60 转/分时 1s 一圈
  const wheelDuration = wheelSpeed > 0 ? 60 / wheelSpeed : 0;
  const loadColor =
    load > OVERLOAD_THRESHOLD ? '#dc2626' : load > 60 ? '#d97706' : '#65a30d';

  return (
    <div
      className="relative flex flex-col items-center justify-between rounded-lg p-4"
      style={{
        background: 'linear-gradient(135deg, #d2b48c 0%, #c8a878 100%)',
        boxShadow: '8px 8px 16px rgba(139, 90, 43, 0.25)',
        minHeight: 340,
      }}
    >
      <div className="flex w-full items-start justify-around">
        {/* 水轮 */}
        <div className="flex flex-col items-center">
          <div
            className="relative rounded-full"
            style={{
              width: 120,
              height: 120,
              border: '8px solid #8b5a2b',
              background: '#a0784a',
              animation:
                wheelDuration > 0
                  ? `mill-spin ${wheelDuration}s linear infinite`
                  : 'none',
            }}
          >
            {[0, 60, 120].map((deg) => (
              <div
                key={deg}
                className="absolute left-1/2 top-1/2"
                style={{
                  width: 104,
                  height: 10,
                  background: '#6b4423',
                  borderRadius: 4,
                  transform: `translate(-50%, -50%) rotate(${deg}deg)`,
                }}
              />
            ))}
            <div
              className="absolute left-1/2 top-1/2 rounded-full"
              style={{
                width: 20,
                height: 20,
                background: '#5a3a1a',
                transform: 'translate(-50%, -50%)',
              }}
            />
          </div>
          <div className="mt-2 text-sm font-semibold" style={{ color: '#5a3a1a' }}>
            水轮 {wheelSpeed.toFixed(0)} 转/分
          </div>
        </div>

        {/* 磨盘 */}
        <div className="relative flex flex-col items-center">
          <div
            className="rounded-full"
            style={{
              width: 100,
              height: 28,
              background: 'linear-gradient(#9a9a9a, #7a7a7a)',
              border: '2px solid #666',
              animation:
                wheelDuration > 0 && !isOverloaded
                  ? `mill-spin ${wheelDuration}s linear infinite`
                  : 'none',
              borderRadius: '50%',
            }}
          />
          {/* 间隙指示 */}
          <div
            className="flex items-center justify-center text-xs font-bold"
            style={{
              width: 60,
              height: 4 + gap * 8,
              color: '#8b5a2b',
              transition: 'height 0.4s ease-out',
            }}
          >
            ⇕ {gap.toFixed(1)}mm
          </div>
          <div
            className="rounded-full"
            style={{
              width: 100,
              height: 28,
              background: 'linear-gradient(#8a8a8a, #6a6a6a)',
              border: '2px solid #666',
              borderRadius: '50%',
            }}
          />
          {/* 粉尘粒子 */}
          {particles.map((p) => (
            <div
              key={p.id}
              className="pointer-events-none absolute rounded-full"
              style={{
                left: p.x - 60,
                top: p.y - 60,
                width: p.size,
                height: p.size,
                background: '#f5e6c8',
                opacity: p.opacity,
              }}
            />
          ))}
          <div className="mt-2 text-sm font-semibold" style={{ color: '#5a3a1a' }}>
            {isOverloaded
              ? '过载停机！'
              : isRunning
                ? '研磨中…'
                : '停机'}
          </div>
        </div>
      </div>

      {/* 负载警示条 */}
      <div className="mt-4 w-full px-2">
        <div
          className="mb-1 flex justify-between text-xs font-semibold"
          style={{ color: '#5a3a1a' }}
        >
          <span>磨盘负载</span>
          <span style={{ color: loadColor }}>{load.toFixed(0)}%</span>
        </div>
        <div
          className="h-3 w-full overflow-hidden rounded-full"
          style={{ background: '#e8d5b0' }}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${load}%`,
              background: `linear-gradient(90deg, #65a30d, #d97706 60%, #dc2626 85%)`,
              backgroundSize: '340px 100%',
              transition: 'width 0.4s ease-out',
            }}
          />
        </div>
        {isOverloaded && (
          <div
            className="mt-1 animate-pulse text-center text-xs font-bold"
            style={{ color: '#dc2626' }}
          >
            负载超过 {OVERLOAD_THRESHOLD}%，过载保护已停机，请调大间隙或关小阀门
          </div>
        )}
      </div>

      <style>{`@keyframes mill-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
