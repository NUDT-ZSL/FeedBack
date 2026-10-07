import { useEffect, useRef } from 'react';
import { LanternRenderer } from './LanternRenderer';
import { Work } from './types';
import { loadWorkIntoRenderer } from './workUtils';

interface LanternThumbProps {
  work: Work;
  size: number;
  className?: string;
  onClick?: () => void;
}

export default function LanternThumb({ work, size, className, onClick }: LanternThumbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<LanternRenderer | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!rendererRef.current) {
      rendererRef.current = new LanternRenderer(canvas);
    }
    loadWorkIntoRenderer(rendererRef.current, work);
  }, [work]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: size, height: size }}
      onClick={onClick}
    />
  );
}
