import React, { useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGrindingStore } from '@/store/useGrindingStore';
import { Scratch } from '@/types';

const Mirror: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  
  const {
    grindingProgress,
    reflectivity,
    patternClarity,
    scratches,
    lightAngle,
    isDamaged,
    polishProgress,
  } = useGrindingStore();

  const patternBlur = Math.max(0, 10 - patternClarity / 10);
  const patternOpacity = Math.min(1, patternClarity / 100);

  const highlightPosition = React.useMemo(() => {
    const angleRad = (lightAngle * Math.PI) / 180;
    const radius = 40;
    return {
      x: 60 + Math.cos(angleRad) * radius,
      y: 60 + Math.sin(angleRad) * radius,
    };
  }, [lightAngle]);

  const drawScratches = useCallback((ctx: CanvasRenderingContext2D, scratches: Scratch[], size: number) => {
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';

    scratches.forEach((scratch) => {
      ctx.globalAlpha = scratch.opacity;
      ctx.beginPath();
      ctx.moveTo(scratch.x1 * size, scratch.y1 * size);
      ctx.lineTo(scratch.x2 * size, scratch.y2 * size);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = canvas.width;
    let currentScratches = [...scratches];

    const render = () => {
      drawScratches(ctx, currentScratches, size);
      animationRef.current = requestAnimationFrame(render);
    };

    currentScratches = [...scratches];
    render();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [scratches, drawScratches]);

  const grapeVinePattern = `
    M 20 30 Q 30 20, 40 30 T 60 30 T 80 30
    M 30 25 Q 35 15, 45 25
    M 55 25 Q 60 15, 70 25
    M 25 50 Q 35 40, 45 50 T 75 50
    M 35 45 Q 40 35, 50 45
    M 60 45 Q 65 35, 75 45
    M 20 70 Q 30 60, 40 70 T 80 70
    M 30 65 Q 35 55, 45 65
    M 55 65 Q 60 55, 70 65
    M 30 35 a 5 5 0 1 0 0.1 0
    M 50 35 a 5 5 0 1 0 0.1 0
    M 70 35 a 5 5 0 1 0 0.1 0
    M 40 55 a 5 5 0 1 0 0.1 0
    M 60 55 a 5 5 0 1 0 0.1 0
    M 35 75 a 5 5 0 1 0 0.1 0
    M 55 75 a 5 5 0 1 0 0.1 0
    M 75 75 a 5 5 0 1 0 0.1 0
  `;

  return (
    <div className="relative" style={{ width: 120, height: 120 }}>
      <AnimatePresence>
        {isDamaged && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.5, 0, 0.5, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, repeat: 2 }}
            className="absolute inset-0 rounded-full z-30 pointer-events-none"
            style={{
              background: 'radial-gradient(circle, rgba(255,0,0,0.4) 0%, transparent 70%)',
              boxShadow: '0 0 30px rgba(255,0,0,0.6), inset 0 0 20px rgba(255,0,0,0.4)',
            }}
          />
        )}
      </AnimatePresence>

      <motion.div
        className="relative rounded-full overflow-hidden"
        style={{
          width: 120,
          height: 120,
          background: `radial-gradient(ellipse at ${highlightPosition.x}% ${highlightPosition.y}%, 
            rgba(255, 215, 0, ${reflectivity / 200}) 0%, 
            #b87333 25%, 
            #4a2e1b 60%, 
            #2a1e10 100%)`,
          boxShadow: `
            inset 0 0 20px rgba(0,0,0,0.5),
            0 0 ${reflectivity / 3}px rgba(255, 215, 0, ${reflectivity / 300}),
            0 4px 15px rgba(0,0,0,0.4)
          `,
          transition: 'box-shadow 0.3s ease, background 0.3s ease',
        }}
        animate={{
          boxShadow: isDamaged 
            ? ['0 0 20px rgba(255,0,0,0.8)', '0 0 40px rgba(255,0,0,0.4)', '0 0 20px rgba(255,0,0,0.8)']
            : undefined,
        }}
        transition={{
          boxShadow: { duration: 0.3, repeat: isDamaged ? 3 : 0 },
        }}
      >
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            filter: `blur(${patternBlur}px)`,
            opacity: patternOpacity,
            transition: 'filter 0.3s ease, opacity 0.3s ease',
          }}
        >
          <svg viewBox="0 0 100 100" className="w-full h-full">
            <defs>
              <radialGradient id="patternGradient" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#d4a574" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#8b6914" stopOpacity="0.6" />
              </radialGradient>
            </defs>
            <path
              d={grapeVinePattern}
              stroke="url(#patternGradient)"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="30" cy="35" r="4" fill="rgba(74, 46, 27, 0.4)" />
            <circle cx="50" cy="35" r="4" fill="rgba(74, 46, 27, 0.4)" />
            <circle cx="70" cy="35" r="4" fill="rgba(74, 46, 27, 0.4)" />
            <circle cx="40" cy="55" r="4" fill="rgba(74, 46, 27, 0.4)" />
            <circle cx="60" cy="55" r="4" fill="rgba(74, 46, 27, 0.4)" />
            <circle cx="35" cy="75" r="4" fill="rgba(74, 46, 27, 0.4)" />
            <circle cx="55" cy="75" r="4" fill="rgba(74, 46, 27, 0.4)" />
            <circle cx="75" cy="75" r="4" fill="rgba(74, 46, 27, 0.4)" />
          </svg>
        </div>

        <div
          className="absolute rounded-full pointer-events-none"
          style={{
            left: `${highlightPosition.x - 15}%`,
            top: `${highlightPosition.y - 15}%`,
            width: '30%',
            height: '30%',
            background: `radial-gradient(circle, rgba(255, 255, 255, ${reflectivity / 150}) 0%, transparent 70%)`,
            transition: 'left 0.5s ease, top 0.5s ease, opacity 0.3s ease',
          }}
        />

        {polishProgress > 30 && (
          <motion.div
            className="absolute inset-0 rounded-full pointer-events-none"
            animate={{
              background: [
                'radial-gradient(circle, rgba(255,215,0,0) 0%, transparent 50%)',
                'radial-gradient(circle, rgba(255,215,0,0.15) 0%, transparent 50%)',
                'radial-gradient(circle, rgba(255,215,0,0) 0%, transparent 50%)',
              ],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        )}

        <canvas
          ref={canvasRef}
          width={120}
          height={120}
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ borderRadius: '50%' }}
        />

        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            background: `linear-gradient(${lightAngle + 135}deg, 
              rgba(255, 255, 255, ${reflectivity / 500}) 0%, 
              transparent 40%, 
              rgba(0, 0, 0, ${(100 - reflectivity) / 500}) 100%)`,
            transition: 'background 0.5s ease',
          }}
        />
      </motion.div>

      <div className="absolute -bottom-6 left-1/2 transform -translate-x-1/2 text-xs text-amber-900 font-medium whitespace-nowrap">
        进度 {Math.round(grindingProgress)}%
      </div>
    </div>
  );
};

export default Mirror;
