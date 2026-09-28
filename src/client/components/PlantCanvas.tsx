import React, { useEffect, useRef } from 'react';
import type { Plant } from '../types';
import { SPECIES_DETAIL_COLORS } from '../constants';

export type AnimationType = 'none' | 'water' | 'fertilize' | 'light' | 'bounce' | 'thanks';

interface PlantCanvasProps {
  plant: Plant;
  width?: number;
  height?: number;
  animationType?: AnimationType;
  onAnimationEnd?: () => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  type?: 'water' | 'fertilize' | 'light' | 'thanks';
  emoji?: string;
  rotation?: number;
  rotationSpeed?: number;
}

export const PlantCanvas: React.FC<PlantCanvasProps> = ({
  plant,
  width = 160,
  height = 160,
  animationType = 'none',
  onAnimationEnd,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const frameCountRef = useRef(0);
  const bouncePhaseRef = useRef<{ bounces: number; maxBounces: number; amplitude: number; startTime: number } | null>(null);
  const lightPhaseRef = useRef<{ startTime: number; duration: number } | null>(null);
  const animationEndedRef = useRef(false);
  const currentAnimationRef = useRef<AnimationType>('none');

  useEffect(() => {
    if (currentAnimationRef.current !== animationType && animationType !== 'none') {
      currentAnimationRef.current = animationType;
      animationEndedRef.current = false;
      initializeAnimation(animationType);
    }
  }, [animationType]);

  const initializeAnimation = (type: AnimationType) => {
    const centerX = width / 2;
    const centerY = height / 2;

    if (type === 'water') {
      const particles: Particle[] = [];
      for (let i = 0; i < 25; i++) {
        particles.push({
          x: centerX + (Math.random() - 0.5) * 80,
          y: -10 - Math.random() * 40,
          vx: (Math.random() - 0.5) * 1.5,
          vy: 2.5 + Math.random() * 2,
          life: 1,
          maxLife: 90,
          size: 3 + Math.random() * 4,
          color: '#4FC3F7',
          type: 'water',
        });
      }
      particlesRef.current = [...particlesRef.current, ...particles];
    } else if (type === 'fertilize') {
      const particles: Particle[] = [];
      for (let i = 0; i < 30; i++) {
        particles.push({
          x: centerX + (Math.random() - 0.5) * 100,
          y: -10 - Math.random() * 60,
          vx: (Math.random() - 0.5) * 0.8,
          vy: 0.8 + Math.random() * 1.2,
          life: 1,
          maxLife: 150,
          size: 2 + Math.random() * 3,
          color: Math.random() > 0.5 ? '#FFD700' : '#FFA500',
          type: 'fertilize',
        });
      }
      particlesRef.current = [...particlesRef.current, ...particles];
    } else if (type === 'light') {
      lightPhaseRef.current = {
        startTime: performance.now(),
        duration: 2000,
      };
      const particles: Particle[] = [];
      for (let i = 0; i < 20; i++) {
        const angle = (i / 20) * Math.PI * 2;
        particles.push({
          x: centerX,
          y: centerY - 20,
          vx: Math.cos(angle) * (1 + Math.random()),
          vy: Math.sin(angle) * (1 + Math.random()),
          life: 1,
          maxLife: 120,
          size: 4 + Math.random() * 6,
          color: '#FFEB3B',
          type: 'light',
        });
      }
      particlesRef.current = [...particlesRef.current, ...particles];
    } else if (type === 'bounce') {
      bouncePhaseRef.current = {
        bounces: 0,
        maxBounces: 3,
        amplitude: 15,
        startTime: performance.now(),
      };
    } else if (type === 'thanks') {
      const particles: Particle[] = [];
      for (let i = 0; i < 12; i++) {
        particles.push({
          x: centerX + (Math.random() - 0.5) * 60,
          y: height - 40 + Math.random() * 20,
          vx: (Math.random() - 0.5) * 2,
          vy: -(1.5 + Math.random() * 2),
          life: 1,
          maxLife: 100 + Math.random() * 40,
          size: 16 + Math.random() * 12,
          color: '#EF4444',
          type: 'thanks',
          emoji: '❤️',
          rotation: (Math.random() - 0.5) * 0.5,
          rotationSpeed: (Math.random() - 0.5) * 0.05,
        });
      }
      particlesRef.current = [...particlesRef.current, ...particles];
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const colors = SPECIES_DETAIL_COLORS[plant.species];
    const healthMultiplier = (plant.health.water + plant.health.light + plant.health.nutrition) / 300;

    const drawPlant = (offsetY: number = 0) => {
      const centerX = width / 2;
      const baseY = height - 30 + offsetY;

      ctx.fillStyle = '#8B7355';
      ctx.beginPath();
      ctx.ellipse(centerX, baseY + 10, 45, 12, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#A0826D';
      ctx.beginPath();
      ctx.ellipse(centerX, baseY + 5, 36, 10, 0, 0, Math.PI * 2);
      ctx.fill();

      const swayOffset = Math.sin(frameCountRef.current * 0.02) * 2 * Math.max(0.3, healthMultiplier);

      if (plant.stage === 'seed') {
        ctx.fillStyle = '#8B4513';
        ctx.beginPath();
        ctx.ellipse(centerX, baseY - 5, 7, 5, Math.PI / 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#654321';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(centerX, baseY - 5, 7, 5, Math.PI / 6, 0, Math.PI * 2);
        ctx.stroke();
      } else if (plant.stage === 'sprout') {
        if (plant.species === 'cactus') {
          drawCactusSprout(ctx, centerX, baseY, swayOffset, colors);
        } else if (plant.species === 'sunflower') {
          drawSunflowerSprout(ctx, centerX, baseY, swayOffset, colors);
        } else {
          drawSucculentSprout(ctx, centerX, baseY, swayOffset, colors);
        }
      } else if (plant.stage === 'adult') {
        if (plant.species === 'cactus') {
          drawCactusAdult(ctx, centerX, baseY, swayOffset, colors);
        } else if (plant.species === 'sunflower') {
          drawSunflowerAdult(ctx, centerX, baseY, swayOffset, colors);
        } else {
          drawSucculentAdult(ctx, centerX, baseY, swayOffset, colors);
        }
      } else if (plant.stage === 'flowering') {
        if (plant.species === 'cactus') {
          drawCactusFlowering(ctx, centerX, baseY, swayOffset, colors);
        } else if (plant.species === 'sunflower') {
          drawSunflowerFlowering(ctx, centerX, baseY, swayOffset, colors);
        } else {
          drawSucculentFlowering(ctx, centerX, baseY, swayOffset, colors);
        }
      }
    };

    const drawCactusSprout = (ctx: CanvasRenderingContext2D, cx: number, by: number, sway: number, c: typeof colors) => {
      ctx.fillStyle = c.stem;
      ctx.beginPath();
      ctx.roundRect(cx - 6 + sway, by - 25, 12, 25, 6);
      ctx.fill();
      ctx.strokeStyle = c.leaf;
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        const y = by - 20 + i * 8;
        ctx.beginPath();
        ctx.moveTo(cx - 8 + sway, y);
        ctx.lineTo(cx - 12 + sway, y - 3);
        ctx.moveTo(cx + 8 + sway, y);
        ctx.lineTo(cx + 12 + sway, y - 3);
        ctx.stroke();
      }
    };

    const drawCactusAdult = (ctx: CanvasRenderingContext2D, cx: number, by: number, sway: number, c: typeof colors) => {
      ctx.fillStyle = c.stem;
      ctx.beginPath();
      ctx.roundRect(cx - 10 + sway, by - 60, 20, 60, 10);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(cx - 25 + sway, by - 45, 15, 30, 7);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(cx + 10 + sway, by - 50, 15, 35, 7);
      ctx.fill();
      ctx.strokeStyle = c.leaf;
      ctx.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        const y = by - 55 + i * 10;
        ctx.beginPath();
        ctx.moveTo(cx - 12 + sway, y);
        ctx.lineTo(cx - 17 + sway, y - 4);
        ctx.moveTo(cx + 12 + sway, y);
        ctx.lineTo(cx + 17 + sway, y - 4);
        ctx.stroke();
      }
    };

    const drawCactusFlowering = (ctx: CanvasRenderingContext2D, cx: number, by: number, sway: number, c: typeof colors) => {
      drawCactusAdult(ctx, cx, by, sway, c);
      const fx = cx + sway;
      const fy = by - 62;
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        ctx.fillStyle = c.flower;
        ctx.beginPath();
        ctx.ellipse(fx + Math.cos(angle) * 7, fy + Math.sin(angle) * 7, 5, 3, angle, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#FFD700';
      ctx.beginPath();
      ctx.arc(fx, fy, 4, 0, Math.PI * 2);
      ctx.fill();
    };

    const drawSunflowerSprout = (ctx: CanvasRenderingContext2D, cx: number, by: number, sway: number, c: typeof colors) => {
      ctx.strokeStyle = c.stem;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, by);
      ctx.quadraticCurveTo(cx + sway, by - 20, cx + sway * 1.5, by - 35);
      ctx.stroke();
      ctx.fillStyle = c.leaf;
      ctx.beginPath();
      ctx.ellipse(cx + sway * 1.5 - 7, by - 30, 7, 3.5, -Math.PI / 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + sway * 1.5 + 7, by - 30, 7, 3.5, Math.PI / 4, 0, Math.PI * 2);
      ctx.fill();
    };

    const drawSunflowerAdult = (ctx: CanvasRenderingContext2D, cx: number, by: number, sway: number, c: typeof colors) => {
      ctx.strokeStyle = c.stem;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx, by);
      ctx.quadraticCurveTo(cx + sway, by - 40, cx + sway * 1.5, by - 75);
      ctx.stroke();
      ctx.fillStyle = c.leaf;
      ctx.beginPath();
      ctx.ellipse(cx + sway * 1.5 - 14, by - 55, 14, 5.5, -Math.PI / 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + sway * 1.5 + 14, by - 55, 14, 5.5, Math.PI / 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + sway * 1.5 - 11, by - 38, 11, 4.5, -Math.PI / 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + sway * 1.5 + 11, by - 38, 11, 4.5, Math.PI / 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c.leaf;
      ctx.beginPath();
      ctx.arc(cx + sway * 1.5, by - 80, 11, 0, Math.PI * 2);
      ctx.fill();
    };

    const drawSunflowerFlowering = (ctx: CanvasRenderingContext2D, cx: number, by: number, sway: number, c: typeof colors) => {
      ctx.strokeStyle = c.stem;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx, by);
      ctx.quadraticCurveTo(cx + sway, by - 40, cx + sway * 1.5, by - 80);
      ctx.stroke();
      ctx.fillStyle = c.leaf;
      ctx.beginPath();
      ctx.ellipse(cx + sway * 1.5 - 16, by - 60, 16, 6.5, -Math.PI / 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + sway * 1.5 + 16, by - 60, 16, 6.5, Math.PI / 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + sway * 1.5 - 13, by - 42, 13, 5.5, -Math.PI / 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + sway * 1.5 + 13, by - 42, 13, 5.5, Math.PI / 4, 0, Math.PI * 2);
      ctx.fill();
      const fx = cx + sway * 1.5;
      const fy = by - 85;
      const petalCount = 14;
      for (let i = 0; i < petalCount; i++) {
        const angle = (i / petalCount) * Math.PI * 2 + frameCountRef.current * 0.003;
        const px = fx + Math.cos(angle) * 14;
        const py = fy + Math.sin(angle) * 14;
        ctx.fillStyle = c.flower;
        ctx.beginPath();
        ctx.ellipse(px, py, 11, 5, angle, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#8B4513';
      ctx.beginPath();
      ctx.arc(fx, fy, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#654321';
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
          if ((i + j) % 2 === 0) {
            const a = (i / 8) * Math.PI * 2;
            const r = 2 + (j / 8) * 5;
            ctx.beginPath();
            ctx.arc(fx + Math.cos(a) * r, fy + Math.sin(a) * r, 0.8, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    };

    const drawSucculentSprout = (ctx: CanvasRenderingContext2D, cx: number, by: number, sway: number, c: typeof colors) => {
      ctx.fillStyle = c.leaf;
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const lx = cx + sway + Math.cos(angle) * 6;
        const ly = by - 15 + Math.sin(angle) * 6;
        ctx.beginPath();
        ctx.ellipse(lx, ly, 7, 4, angle, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = c.stem;
      ctx.beginPath();
      ctx.arc(cx + sway, by - 15, 5, 0, Math.PI * 2);
      ctx.fill();
    };

    const drawSucculentAdult = (ctx: CanvasRenderingContext2D, cx: number, by: number, sway: number, c: typeof colors) => {
      const layers = 3;
      for (let layer = 0; layer < layers; layer++) {
        const leafCount = 5 + layer;
        const radius = 10 + layer * 8;
        const yOffset = by - 20 - layer * 12;
        ctx.fillStyle = layer === 0 ? c.stem : c.leaf;
        for (let i = 0; i < leafCount; i++) {
          const angle = (i / leafCount) * Math.PI * 2 + layer * 0.3;
          const lx = cx + sway + Math.cos(angle) * radius * 0.6;
          const ly = yOffset + Math.sin(angle) * radius * 0.3;
          ctx.beginPath();
          ctx.ellipse(lx, ly, 9 + layer * 2, 5 + layer, angle, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = c.stem;
      ctx.beginPath();
      ctx.arc(cx + sway, by - 45, 7, 0, Math.PI * 2);
      ctx.fill();
    };

    const drawSucculentFlowering = (ctx: CanvasRenderingContext2D, cx: number, by: number, sway: number, c: typeof colors) => {
      drawSucculentAdult(ctx, cx, by, sway, c);
      ctx.strokeStyle = c.stem;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx + sway, by - 50);
      ctx.quadraticCurveTo(cx + sway + 5, by - 65, cx + sway, by - 78);
      ctx.stroke();
      const fx = cx + sway;
      const fy = by - 80;
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2 - Math.PI / 2;
        ctx.fillStyle = c.flower;
        ctx.beginPath();
        ctx.ellipse(fx + Math.cos(angle) * 6, fy + Math.sin(angle) * 6, 5, 3, angle, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#FFD700';
      ctx.beginPath();
      ctx.arc(fx, fy, 3.5, 0, Math.PI * 2);
      ctx.fill();
    };

    const drawLightGlow = (intensity: number) => {
      if (intensity <= 0) return;
      const gradient = ctx.createRadialGradient(
        width / 2,
        height / 2 - 20,
        0,
        width / 2,
        height / 2 - 20,
        90
      );
      gradient.addColorStop(0, `rgba(255, 235, 59, ${0.45 * intensity})`);
      gradient.addColorStop(0.5, `rgba(255, 193, 7, ${0.2 * intensity})`);
      gradient.addColorStop(1, 'rgba(255, 235, 59, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    };

    const updateAndDrawParticles = () => {
      particlesRef.current = particlesRef.current.filter((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 1 / p.maxLife;

        if (p.type === 'water') {
          p.vy += 0.15;
          if (p.y > height - 45 && p.life > 0.3) {
            for (let i = 0; i < 4; i++) {
              particlesRef.current.push({
                x: p.x,
                y: height - 45,
                vx: (Math.random() - 0.5) * 3,
                vy: -Math.random() * 2 - 0.5,
                life: 0.8,
                maxLife: 20,
                size: 1.5 + Math.random() * 1.5,
                color: '#4FC3F7',
                type: 'water',
              });
            }
            return false;
          }
        } else if (p.type === 'fertilize') {
          p.vy += 0.03;
          p.vx += (Math.random() - 0.5) * 0.1;
        } else if (p.type === 'thanks') {
          p.vy -= 0.02;
          p.rotation = (p.rotation || 0) + (p.rotationSpeed || 0);
        }

        return p.life > 0 && p.y < height + 20 && p.x > -20 && p.x < width + 20;
      });

      for (const particle of particlesRef.current) {
        const alpha = Math.max(0, particle.life);
        ctx.globalAlpha = alpha;

        if (particle.type === 'thanks' && particle.emoji) {
          ctx.save();
          ctx.translate(particle.x, particle.y);
          ctx.rotate(particle.rotation || 0);
          ctx.font = `${particle.size}px serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(particle.emoji, 0, 0);
          ctx.restore();
        } else if (particle.type === 'light') {
          ctx.shadowColor = particle.color;
          ctx.shadowBlur = 12 * alpha;
          ctx.fillStyle = particle.color;
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, particle.size * alpha, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        } else if (particle.type === 'water') {
          ctx.fillStyle = particle.color;
          ctx.beginPath();
          ctx.ellipse(
            particle.x,
            particle.y,
            particle.size * alpha * 0.7,
            particle.size * alpha,
            0,
            0,
            Math.PI * 2
          );
          ctx.fill();
        } else {
          ctx.fillStyle = particle.color;
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, particle.size * alpha, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };

    const getBounceOffset = (): number => {
      if (!bouncePhaseRef.current) return 0;
      const { startTime, maxBounces, amplitude } = bouncePhaseRef.current;
      const elapsed = performance.now() - startTime;
      const bounceDuration = 350;
      const totalDuration = bounceDuration * maxBounces;

      if (elapsed >= totalDuration) {
        return 0;
      }

      const currentBounce = Math.floor(elapsed / bounceDuration);
      const bounceProgress = (elapsed % bounceDuration) / bounceDuration;
      const decayFactor = 1 - currentBounce * 0.25;
      const currentAmplitude = amplitude * decayFactor;

      const t = bounceProgress;
      const offset = -currentAmplitude * 4 * t * (1 - t);

      return offset;
    };

    const getLightIntensity = (): number => {
      if (!lightPhaseRef.current) return 0;
      const { startTime, duration } = lightPhaseRef.current;
      const elapsed = performance.now() - startTime;
      if (elapsed >= duration) return 0;

      const t = elapsed / duration;
      if (t < 0.3) {
        return t / 0.3;
      } else if (t < 0.7) {
        return 1;
      } else {
        return 1 - (t - 0.7) / 0.3;
      }
    };

    const checkAnimationEnd = () => {
      if (animationEndedRef.current || !onAnimationEnd) return;

      const activeTypes: AnimationType[] = [];
      if (particlesRef.current.length > 0) {
        const waterParticles = particlesRef.current.some(p => p.type === 'water');
        const fertilizeParticles = particlesRef.current.some(p => p.type === 'fertilize');
        const lightParticles = particlesRef.current.some(p => p.type === 'light');
        const thanksParticles = particlesRef.current.some(p => p.type === 'thanks');
        if (waterParticles) activeTypes.push('water');
        if (fertilizeParticles) activeTypes.push('fertilize');
        if (lightParticles) activeTypes.push('light');
        if (thanksParticles) activeTypes.push('thanks');
      }

      if (bouncePhaseRef.current) {
        const { startTime, maxBounces } = bouncePhaseRef.current;
        const elapsed = performance.now() - startTime;
        if (elapsed < 350 * maxBounces) {
          activeTypes.push('bounce');
        }
      }

      if (lightPhaseRef.current) {
        const { startTime, duration } = lightPhaseRef.current;
        const elapsed = performance.now() - startTime;
        if (elapsed < duration) {
          if (!activeTypes.includes('light')) activeTypes.push('light');
        }
      }

      if (activeTypes.length === 0 && currentAnimationRef.current !== 'none') {
        animationEndedRef.current = true;
        currentAnimationRef.current = 'none';
        onAnimationEnd();
      }
    };

    const animate = () => {
      ctx.clearRect(0, 0, width, height);

      const lightIntensity = getLightIntensity();
      drawLightGlow(lightIntensity);

      const bounceOffset = getBounceOffset();
      drawPlant(bounceOffset);

      updateAndDrawParticles();

      frameCountRef.current++;
      checkAnimationEnd();
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [plant, width, height, onAnimationEnd]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ display: 'block' }}
    />
  );
};

export default PlantCanvas;
