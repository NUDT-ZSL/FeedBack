import { useEffect, useMemo } from 'react';
import { ParticleSystem } from '@/core/particleSystem';

/**
 * Thin React adapter over the framework-agnostic ParticleSystem core.
 * The core is disposed on unmount so no canvas/particle references
 * outlive the component.
 */
export function useParticleSystem(maxParticles: number) {
  const system = useMemo(() => new ParticleSystem({ maxParticles }), [maxParticles]);

  useEffect(() => {
    return () => {
      system.dispose();
    };
  }, [system]);

  return {
    update: system.update.bind(system),
    emitSteam: system.emitSteam.bind(system),
    emitPulp: system.emitPulp.bind(system),
    emitWaterDrop: system.emitWaterDrop.bind(system),
    getParticles: system.getParticles.bind(system),
    attachCanvas: system.attachCanvas.bind(system),
    detachCanvas: system.detachCanvas.bind(system),
    dispose: system.dispose.bind(system),
    system,
  };
}
