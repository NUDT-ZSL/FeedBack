import { useEffect, useMemo, useCallback } from 'react';
import { ParticleSystem } from '@/core/particleSystem';
import type { Particle } from '@/types';

/**
 * React 薄适配层：粒子生命周期与上限/回收逻辑全部在
 * `@/core/particleSystem` 中（可在无浏览器环境独立测试）。
 * 组件卸载时统一 dispose，释放粒子池与 canvas 引用，避免内存泄漏。
 */
export function useParticleSystem(maxParticles: number) {
  const system = useMemo(() => new ParticleSystem(maxParticles), [maxParticles]);

  useEffect(() => {
    return () => {
      system.dispose();
    };
  }, [system]);

  const update = useCallback((deltaTime: number) => system.update(deltaTime), [system]);
  const emitSteam = useCallback(
    (x: number, y: number, z: number) => system.emitSteam(x, y, z),
    [system],
  );
  const emitPulp = useCallback(
    (x: number, y: number, z: number, color: string) => system.emitPulp(x, y, z, color),
    [system],
  );
  const emitWaterDrop = useCallback(
    (x: number, y: number, z: number) => system.emitWaterDrop(x, y, z),
    [system],
  );
  const getParticles = useCallback((): Particle[] => system.getParticles(), [system]);
  const attachCanvas = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (canvas) {
        system.attachCanvas(canvas);
      } else {
        system.detachCanvas();
      }
    },
    [system],
  );

  return {
    update,
    emitSteam,
    emitPulp,
    emitWaterDrop,
    getParticles,
    attachCanvas,
    system,
  };
}
