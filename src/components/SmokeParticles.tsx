import { useEffect, useRef } from 'react';
import type { SmokeParticle } from '../types';

interface SmokeParticlesProps {
  active: boolean;
  color?: string;
  particleCount?: number;
  riseHeight?: number;
  duration?: number;
}

export function SmokeParticles({
  active,
  color = 'rgba(255, 255, 255, 0.6)',
  particleCount = 50,
  riseHeight = 200,
  duration = 4000,
}: SmokeParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<SmokeParticle[]>([]);
  const animationRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const spawnTimerRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const centerX = width / 2;
    const baseY = height * 0.3;

    function createParticle(): SmokeParticle {
      const size = 8 + Math.random() * 12;
      return {
        x: centerX + (Math.random() - 0.5) * 20,
        y: baseY,
        vx: (Math.random() - 0.5) * 0.5,
        vy: -(0.8 + Math.random() * 0.6),
        size,
        opacity: 0.1 + Math.random() * 0.3,
        life: 0,
        maxLife: duration * (0.8 + Math.random() * 0.4),
      };
    }

    function updateParticles(deltaTime: number) {
      particlesRef.current = particlesRef.current.filter((p) => {
        p.life += deltaTime;
        if (p.life >= p.maxLife) return false;

        p.x += p.vx * (deltaTime / 16);
        p.y += p.vy * (deltaTime / 16);
        p.vx += (Math.random() - 0.5) * 0.02;
        p.vy *= 0.998;
        p.opacity = Math.sin((p.life / p.maxLife) * Math.PI) * 0.4;
        p.size += 0.03 * (deltaTime / 16);

        return true;
      });
    }

    function drawParticles() {
      ctx.clearRect(0, 0, width, height);

      particlesRef.current.forEach((p) => {
        const gradient = ctx.createRadialGradient(
          p.x,
          p.y,
          0,
          p.x,
          p.y,
          p.size
        );
        gradient.addColorStop(0, color.replace(/[\d.]+\)$/, `${p.opacity})`));
        gradient.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
      });
    }

    function animate(timestamp: number) {
      if (!lastTimeRef.current) lastTimeRef.current = timestamp;
      const deltaTime = timestamp - lastTimeRef.current;
      lastTimeRef.current = timestamp;

      if (active) {
        spawnTimerRef.current += deltaTime;
        const spawnInterval = duration / particleCount;

        while (
          spawnTimerRef.current >= spawnInterval &&
          particlesRef.current.length < particleCount
        ) {
          particlesRef.current.push(createParticle());
          spawnTimerRef.current -= spawnInterval;
        }
      }

      updateParticles(deltaTime);
      drawParticles();

      animationRef.current = requestAnimationFrame(animate);
    }

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [active, color, particleCount, riseHeight, duration]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: '-200px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '200px',
        height: '300px',
        pointerEvents: 'none',
        zIndex: 10,
      }}
    />
  );
}
