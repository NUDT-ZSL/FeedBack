import React, { useRef, useEffect, useCallback } from 'react';

interface SpectrumVisualizerProps {
  frequencyData: Uint8Array | null;
  isPlaying: boolean;
}

interface BarState {
  currentHeight: number;
  targetHeight: number;
  velocity: number;
}

const SpectrumVisualizer: React.FC<SpectrumVisualizerProps> = ({
  frequencyData,
  isPlaying
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const barsRef = useRef<BarState[]>([]);
  const lastDataRef = useRef<Uint8Array | null>(null);

  const BAR_COUNT = 128;
  const SPRING = 0.15;
  const DAMPING = 0.85;
  const GRAVITY = 0.5;

  const initBars = useCallback(() => {
    barsRef.current = Array.from({ length: BAR_COUNT }, () => ({
      currentHeight: 0,
      targetHeight: 0,
      velocity: 0
    }));
  }, []);

  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
    }

    initBars();
  }, [initBars]);

  const getBarColor = useCallback((index: number, height: number, maxHeight: number): string => {
    const ratio = index / BAR_COUNT;
    const intensity = height / maxHeight;
    
    const r = Math.floor(0 + ratio * 255 + intensity * 50);
    const g = Math.floor(212 - ratio * 150 + intensity * 20);
    const b = Math.floor(255 - ratio * 200);
    
    return `rgb(${Math.min(255, r)}, ${Math.min(255, g)}, ${Math.min(255, b)})`;
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !container) return;

    const rect = container.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    ctx.clearRect(0, 0, width, height);

    const fadeGradient = ctx.createLinearGradient(0, height * 0.7, 0, height);
    fadeGradient.addColorStop(0, 'rgba(26, 26, 46, 0)');
    fadeGradient.addColorStop(1, 'rgba(26, 26, 46, 0.8)');

    const barGap = 2;
    const barWidth = (width - barGap * (BAR_COUNT - 1)) / BAR_COUNT;
    const maxBarHeight = height * 0.9;
    const minBarHeight = 2;

    if (frequencyData && frequencyData.length > 0) {
      const dataLength = Math.min(frequencyData.length, BAR_COUNT);
      
      for (let i = 0; i < dataLength; i++) {
        const normalizedValue = frequencyData[i] / 255;
        const targetHeight = Math.max(minBarHeight, normalizedValue * maxBarHeight);
        
        if (barsRef.current[i]) {
          barsRef.current[i].targetHeight = targetHeight;
        }
      }
      
      lastDataRef.current = frequencyData;
    }

    for (let i = 0; i < BAR_COUNT; i++) {
      const bar = barsRef.current[i];
      if (!bar) continue;

      if (isPlaying) {
        const force = (bar.targetHeight - bar.currentHeight) * SPRING;
        bar.velocity += force;
        bar.velocity *= DAMPING;
        
        if (bar.currentHeight > bar.targetHeight) {
          bar.velocity -= GRAVITY;
        }
        
        bar.currentHeight += bar.velocity;
        bar.currentHeight = Math.max(minBarHeight, Math.min(maxBarHeight, bar.currentHeight));
      } else {
        bar.currentHeight *= 0.95;
        if (bar.currentHeight < minBarHeight) {
          bar.currentHeight = minBarHeight;
        }
      }
    }

    for (let i = 0; i < BAR_COUNT; i++) {
      const bar = barsRef.current[i];
      if (!bar) continue;

      const x = i * (barWidth + barGap);
      const barHeight = bar.currentHeight;
      const y = height - barHeight;

      const color = getBarColor(i, barHeight, maxBarHeight);
      
      const gradient = ctx.createLinearGradient(x, y, x, height);
      gradient.addColorStop(0, color);
      gradient.addColorStop(0.7, color);
      gradient.addColorStop(1, 'rgba(26, 26, 46, 0.3)');

      ctx.fillStyle = gradient;
      
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      
      const radius = Math.min(barWidth / 2, 4);
      
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, [radius, radius, 0, 0]);
      ctx.fill();
      
      ctx.shadowBlur = 0;

      const peakY = y - 3;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(x, peakY, barWidth, 2);
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = fadeGradient;
    ctx.fillRect(0, 0, width, height);

    const glowGradient = ctx.createRadialGradient(
      width / 2, height, 0,
      width / 2, height, height * 0.6
    );
    glowGradient.addColorStop(0, 'rgba(0, 212, 255, 0.1)');
    glowGradient.addColorStop(1, 'rgba(0, 212, 255, 0)');
    ctx.fillStyle = glowGradient;
    ctx.fillRect(0, height * 0.4, width, height * 0.6);
  }, [frequencyData, isPlaying, getBarColor]);

  useEffect(() => {
    setupCanvas();
    
    const handleResize = () => {
      setupCanvas();
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [setupCanvas]);

  useEffect(() => {
    const animate = () => {
      draw();
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    animate();
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [draw]);

  return (
    <div ref={containerRef} className="spectrum-container">
      <canvas ref={canvasRef} />
    </div>
  );
};

export default SpectrumVisualizer;
