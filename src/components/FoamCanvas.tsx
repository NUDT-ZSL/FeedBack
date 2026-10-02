import React, { useRef, useEffect, useCallback } from 'react';
import { useGameStore } from '@/store/gameStore';
import type { TeaPattern } from '@/types';

interface FoamCanvasProps {
  onPatternClick?: (pattern: TeaPattern, thumbnail: string) => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  opacity: number;
  life: number;
  maxLife: number;
  active: boolean;
}

export const FoamCanvas: React.FC<FoamCanvasProps> = ({ onPatternClick }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const foamThickness = useGameStore(state => state.foamThickness);
  const foamColor = useGameStore(state => state.foamColor);
  const phase = useGameStore(state => state.phase);
  const currentPattern = useGameStore(state => state.currentPattern);
  const userScore = useGameStore(state => state.userScore);
  
  const particlesRef = useRef<Particle[]>([]);
  const animationRef = useRef<number>(0);
  const particlePoolRef = useRef<Particle[]>([]);
  const patternProgressRef = useRef(0);
  const patternStartTimeRef = useRef(0);
  
  const getParticleFromPool = useCallback((): Particle => {
    const pooled = particlePoolRef.current.find(p => !p.active);
    if (pooled) {
      pooled.active = true;
      return pooled;
    }
    const newParticle: Particle = {
      x: 0, y: 0, vx: 0, vy: 0, radius: 0,
      opacity: 0, life: 0, maxLife: 0, active: true
    };
    particlePoolRef.current.push(newParticle);
    return newParticle;
  }, []);

  const spawnParticle = useCallback((centerX: number, centerY: number, radius: number) => {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * radius * 0.8;
    const p = getParticleFromPool();
    
    p.x = centerX + Math.cos(angle) * dist;
    p.y = centerY + Math.sin(angle) * dist;
    p.vx = (Math.random() - 0.5) * 0.5;
    p.vy = -Math.random() * 0.3 - 0.1;
    p.radius = 2 + Math.random() * 6;
    p.opacity = 0.6 + Math.random() * 0.4;
    p.life = 0;
    p.maxLife = 60 + Math.random() * 120;
    p.active = true;
  }, [getParticleFromPool]);

  const getFoamColor = useCallback((opacity: number) => {
    const whiteLevel = Math.min(100, Math.max(0, foamColor));
    const r = Math.round(240 + (250 - 240) * (whiteLevel / 100));
    const g = Math.round(212 + (245 - 212) * (whiteLevel / 100));
    const b = Math.round(160 + (232 - 160) * (whiteLevel / 100));
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }, [foamColor]);

  const drawFoam = useCallback((ctx: CanvasRenderingContext2D, centerX: number, centerY: number, radius: number, thickness: number) => {
    const foamRadius = radius * 0.85;
    const particleCount = Math.floor(thickness / 100 * 150);
    
    for (let i = 0; i < particleCount; i++) {
      if (particlesRef.current.filter(p => p.active).length < 200) {
        spawnParticle(centerX, centerY, foamRadius);
      }
    }
    
    const gradient = ctx.createRadialGradient(
      centerX, centerY, foamRadius * 0.3,
      centerX, centerY, foamRadius
    );
    gradient.addColorStop(0, getFoamColor(0.85));
    gradient.addColorStop(0.5, getFoamColor(0.75));
    gradient.addColorStop(0.8, getFoamColor(0.6));
    gradient.addColorStop(1, getFoamColor(0));
    
    ctx.beginPath();
    ctx.arc(centerX, centerY, foamRadius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
    
    particlesRef.current.forEach(p => {
      if (!p.active) return;
      
      p.life++;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.01;
      
      if (p.life > p.maxLife * 0.7) {
        p.opacity -= 0.02;
      }
      
      if (p.life >= p.maxLife || p.opacity <= 0) {
        p.active = false;
        return;
      }
      
      const particleGradient = ctx.createRadialGradient(
        p.x, p.y, 0,
        p.x, p.y, p.radius
      );
      particleGradient.addColorStop(0, `rgba(255, 255, 255, ${p.opacity * 0.9})`);
      particleGradient.addColorStop(0.4, getFoamColor(p.opacity * 0.7));
      particleGradient.addColorStop(1, getFoamColor(0));
      
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = particleGradient;
      ctx.fill();
    });
    
    if (thickness > 30) {
      ctx.strokeStyle = getFoamColor(0.9);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(centerX, centerY, foamRadius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, [getFoamColor, spawnParticle]);

  const drawPattern = useCallback((ctx: CanvasRenderingContext2D, pattern: TeaPattern, centerX: number, centerY: number, scale: number, progress: number) => {
    const drawProgress = Math.min(1, progress);
    
    pattern.paths.forEach(path => {
      if (path.points.length < 2) return;
      
      const totalPoints = path.points.length - 1;
      const pointsToDraw = Math.ceil(totalPoints * drawProgress);
      
      if (pointsToDraw < 1) return;
      
      ctx.beginPath();
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.7 * drawProgress})`;
      ctx.lineWidth = path.strokeWidth || 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      const [firstX, firstY] = path.points[0];
      ctx.moveTo(
        centerX + (firstX - 50) * scale,
        centerY + (firstY - 50) * scale
      );
      
      for (let i = 1; i <= pointsToDraw; i++) {
        const [x, y] = path.points[i];
        if (i === pointsToDraw && drawProgress < 1) {
          const t = (drawProgress * totalPoints) % 1;
          const [prevX, prevY] = path.points[i - 1];
          const interpX = prevX + (x - prevX) * t;
          const interpY = prevY + (y - prevY) * t;
          ctx.lineTo(
            centerX + (interpX - 50) * scale,
            centerY + (interpY - 50) * scale
          );
        } else {
          ctx.lineTo(
            centerX + (x - 50) * scale,
            centerY + (y - 50) * scale
          );
        }
      }
      
      ctx.stroke();
    });
  }, []);

  const handleCanvasClick = useCallback(() => {
    if (phase !== 'pattern_showing' || !currentPattern || !onPatternClick) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const thumbnail = canvas.toDataURL('image/png');
    onPatternClick(currentPattern, thumbnail);
  }, [phase, currentPattern, onPatternClick]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    const animate = () => {
      const rect = canvas.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const radius = Math.min(rect.width, rect.height) * 0.4;
      
      ctx.clearRect(0, 0, rect.width, rect.height);
      
      if (phase !== 'idle' && phase !== 'pouring') {
        const thickness = phase === 'whisking' 
          ? Math.min(100, foamThickness * 1.5)
          : foamThickness;
        
        if (thickness > 5) {
          drawFoam(ctx, centerX, centerY, radius, thickness);
        }
      }
      
      if (currentPattern && phase === 'pattern_showing') {
        if (patternStartTimeRef.current === 0) {
          patternStartTimeRef.current = performance.now();
        }
        
        const elapsed = performance.now() - patternStartTimeRef.current;
        const progress = Math.min(1, elapsed / 2000);
        patternProgressRef.current = progress;
        
        const patternScale = radius * 0.016;
        drawPattern(ctx, currentPattern, centerX, centerY, patternScale, progress);
      } else {
        patternStartTimeRef.current = 0;
        patternProgressRef.current = 0;
      }
      
      animationRef.current = requestAnimationFrame(animate);
    };
    
    animate();
    
    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationRef.current);
    };
  }, [phase, foamThickness, currentPattern, drawFoam, drawPattern]);

  return (
    <div className="absolute inset-0 pointer-events-none">
      <canvas
        ref={canvasRef}
        className={`w-full h-full ${phase === 'pattern_showing' ? 'pointer-events-auto cursor-pointer' : ''}`}
        style={{
          position: 'absolute',
          inset: 0,
        }}
        onClick={handleCanvasClick}
      />
      {phase === 'pattern_showing' && currentPattern && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-center pointer-events-none">
          <div className="font-title text-lg text-amber-900 mb-1">
            {currentPattern.name}
          </div>
          <div className="text-xs font-kai text-amber-800 opacity-80">
            点击图案保存到图鉴
          </div>
        </div>
      )}
      {phase === 'scoring' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div className="font-title text-2xl text-amber-900 mb-2">
              {userScore.total > 0 ? '评分中...' : ''}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
