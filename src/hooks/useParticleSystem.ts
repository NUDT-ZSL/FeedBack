import { useRef, useCallback } from 'react';
import type { Particle } from '@/types';

const STEAM_EMIT_RATE = 30;
const MAX_PULP_PARTICLES = 200;
const WATER_DROP_FALL_SPEED = 100;
const WATER_DROP_RADIUS = 3;

type ParticleType = 'steam' | 'pulp' | 'waterdrop';

export function useParticleSystem(maxParticles: number) {
  const particlesRef = useRef<Particle[]>([]);
  const poolRef = useRef<Particle[]>([]);
  const particleTypeMapRef = useRef<Map<number, ParticleType>>(new Map());
  const nextIdRef = useRef(0);
  const steamEmitAccumulatorRef = useRef(0);
  const pulpCountRef = useRef(0);

  const acquireParticle = useCallback((): Particle | null => {
    if (poolRef.current.length > 0) {
      return poolRef.current.pop()!;
    }
    if (particlesRef.current.length < maxParticles) {
      return {
        id: nextIdRef.current++,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 0,
        size: 0,
        color: '#ffffff'
      };
    }
    return null;
  }, [maxParticles]);

  const releaseParticle = useCallback((particle: Particle) => {
    poolRef.current.push(particle);
  }, []);

  const update = useCallback((deltaTime: number) => {
    const particles = particlesRef.current;
    const typeMap = particleTypeMapRef.current;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * deltaTime;
      p.y += p.vy * deltaTime;
      p.z += p.vz * deltaTime;
      p.life -= deltaTime;

      if (p.life <= 0) {
        if (typeMap.get(p.id) === 'pulp') {
          pulpCountRef.current = Math.max(0, pulpCountRef.current - 1);
        }
        typeMap.delete(p.id);
        releaseParticle(p);
        particles.splice(i, 1);
      }
    }
  }, [releaseParticle]);

  const emitSteam = useCallback((x: number, y: number, z: number) => {
    steamEmitAccumulatorRef.current += STEAM_EMIT_RATE;
    while (steamEmitAccumulatorRef.current >= 1) {
      steamEmitAccumulatorRef.current -= 1;
      const p = acquireParticle();
      if (!p) break;

      const angle = Math.random() * Math.PI * 2;
      const speed = 10 + Math.random() * 20;
      const spread = Math.random() * 5;

      p.x = x + Math.cos(angle) * spread;
      p.y = y;
      p.z = z + Math.sin(angle) * spread;
      p.vx = Math.cos(angle) * 5;
      p.vy = -20 - Math.random() * 30;
      p.vz = Math.sin(angle) * 5;
      p.life = 1.5 + Math.random() * 1;
      p.maxLife = p.life;
      p.size = 3 + Math.random() * 4;
      p.color = `rgba(255, 255, 255, ${0.3 + Math.random() * 0.3})`;

      particleTypeMapRef.current.set(p.id, 'steam');
      particlesRef.current.push(p);
    }
  }, [acquireParticle]);

  const emitPulp = useCallback((x: number, y: number, z: number, color: string) => {
    if (pulpCountRef.current >= MAX_PULP_PARTICLES) return;

    const p = acquireParticle();
    if (!p) return;

    const angle = Math.random() * Math.PI * 2;
    const speed = 20 + Math.random() * 40;

    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = Math.cos(angle) * speed;
    p.vy = -10 - Math.random() * 20;
    p.vz = Math.sin(angle) * speed;
    p.life = 2 + Math.random() * 2;
    p.maxLife = p.life;
    p.size = 2 + Math.random() * 3;
    p.color = color;

    pulpCountRef.current++;
    particleTypeMapRef.current.set(p.id, 'pulp');
    particlesRef.current.push(p);
  }, [acquireParticle]);

  const emitWaterDrop = useCallback((x: number, y: number, z: number) => {
    const p = acquireParticle();
    if (!p) return;

    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = 0;
    p.vy = WATER_DROP_FALL_SPEED;
    p.vz = 0;
    p.life = 3;
    p.maxLife = 3;
    p.size = WATER_DROP_RADIUS * 2;
    p.color = 'rgba(100, 180, 255, 0.7)';

    particleTypeMapRef.current.set(p.id, 'waterdrop');
    particlesRef.current.push(p);
  }, [acquireParticle]);

  const getParticles = useCallback((): Particle[] => {
    return particlesRef.current;
  }, []);

  return {
    update,
    emitSteam,
    emitPulp,
    emitWaterDrop,
    getParticles
  };
}
