import React, { useRef, useEffect, useCallback, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { StitchSegment, StitchType, ThreadColor, StitchPoint } from '../types/embroidery';
import { drawStitchByType } from '../utils/stitches';

interface EmbroideryCanvasProps {
  stitchType: StitchType;
  threadColor: ThreadColor;
  stitchRadius: number;
  onSegmentsChange?: (segments: StitchSegment[]) => void;
  ref?: React.RefObject<EmbroideryCanvasHandle | null>;
}

export interface EmbroideryCanvasHandle {
  undo: () => void;
  clear: () => void;
  exportImage: (includeBackground: boolean) => string;
  getSegments: () => StitchSegment[];
}

const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 450;

const EmbroideryCanvas: React.ForwardRefRenderFunction<
  EmbroideryCanvasHandle,
  EmbroideryCanvasProps
> = ({ stitchType, threadColor, stitchRadius, onSegmentsChange }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [showRipple, setShowRipple] = useState(false);
  const [showSilk, setShowSilk] = useState(false);
  
  const segmentsRef = useRef<StitchSegment[]>([]);
  const currentSegmentRef = useRef<StitchSegment | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const pendingPointsRef = useRef<StitchPoint[]>([]);

  const drawPeonySketch = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    ctx.fillStyle = 'rgba(252, 245, 232, 0.85)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    ctx.strokeStyle = 'rgba(120, 120, 120, 0.6)';
    ctx.lineWidth = 0.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    const cx = CANVAS_WIDTH / 2;
    const cy = CANVAS_HEIGHT / 2 - 20;
    
    for (let layer = 0; layer < 5; layer++) {
      const radius = 30 + layer * 25;
      const numPetals = 8 - layer;
      const startAngle = (layer % 2) * (Math.PI / numPetals);
      
      for (let i = 0; i < numPetals; i++) {
        const angle = startAngle + (i / numPetals) * Math.PI * 2;
        const nextAngle = startAngle + ((i + 1) / numPetals) * Math.PI * 2;
        
        const x1 = cx + Math.cos(angle) * radius * 0.3;
        const y1 = cy + Math.sin(angle) * radius * 0.3;
        const x2 = cx + Math.cos(angle + 0.15) * radius;
        const y2 = cy + Math.sin(angle + 0.15) * radius * 0.85;
        const x3 = cx + Math.cos((angle + nextAngle) / 2) * radius * 1.1;
        const y3 = cy + Math.sin((angle + nextAngle) / 2) * radius * 0.95;
        const x4 = cx + Math.cos(nextAngle - 0.15) * radius;
        const y4 = cy + Math.sin(nextAngle - 0.15) * radius * 0.85;
        const x5 = cx + Math.cos(nextAngle) * radius * 0.3;
        const y5 = cy + Math.sin(nextAngle) * radius * 0.3;
        
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(x2, y2, x3, y3);
        ctx.quadraticCurveTo(x4, y4, x5, y5);
        ctx.stroke();
        
        if (layer < 2) {
          ctx.beginPath();
          ctx.moveTo(x3, y3);
          ctx.quadraticCurveTo(
            cx + Math.cos((angle + nextAngle) / 2) * radius * 0.5,
            cy + Math.sin((angle + nextAngle) / 2) * radius * 0.4,
            cx, cy
          );
          ctx.stroke();
        }
      }
    }
    
    ctx.beginPath();
    ctx.arc(cx, cy, 15, 0, Math.PI * 2);
    ctx.stroke();
    
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * 8, cy + Math.sin(angle) * 8);
      ctx.lineTo(cx + Math.cos(angle) * 14, cy + Math.sin(angle) * 14);
      ctx.stroke();
    }
    
    const leafPositions = [
      { x: cx - 120, y: cy + 80, angle: -0.5, scale: 1 },
      { x: cx + 130, y: cy + 60, angle: 0.4, scale: 0.8 },
      { x: cx - 80, y: cy + 140, angle: -0.2, scale: 1.2 },
      { x: cx + 90, y: cy + 130, angle: 0.3, scale: 0.9 },
    ];
    
    leafPositions.forEach((leaf) => {
      ctx.save();
      ctx.translate(leaf.x, leaf.y);
      ctx.rotate(leaf.angle);
      ctx.scale(leaf.scale, leaf.scale);
      
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(30, -25, 60, 0);
      ctx.quadraticCurveTo(30, 25, 0, 0);
      ctx.stroke();
      
      ctx.beginPath();
      ctx.moveTo(5, 0);
      ctx.lineTo(50, 0);
      ctx.stroke();
      
      for (let i = 1; i <= 4; i++) {
        const lx = 10 + i * 10;
        ctx.beginPath();
        ctx.moveTo(lx, 0);
        ctx.lineTo(lx + 8, -8 - i * 2);
        ctx.moveTo(lx, 0);
        ctx.lineTo(lx + 8, 8 + i * 2);
        ctx.stroke();
      }
      
      ctx.restore();
    });
    
    ctx.beginPath();
    ctx.moveTo(cx, cy + 120);
    ctx.quadraticCurveTo(cx + 10, cy + 100, cx, cy + 80);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(cx, cy + 120);
    ctx.quadraticCurveTo(cx - 10, cy + 160, cx - 30, cy + 180);
    ctx.stroke();
  }, []);

  const initBackgroundCanvas = useCallback(() => {
    const offscreen = document.createElement('canvas');
    offscreen.width = CANVAS_WIDTH;
    offscreen.height = CANVAS_HEIGHT;
    const bgCtx = offscreen.getContext('2d');
    if (bgCtx) {
      drawPeonySketch(bgCtx);
    }
    bgCanvasRef.current = offscreen;
  }, [drawPeonySketch]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    if (bgCanvasRef.current) {
      ctx.drawImage(bgCanvasRef.current, 0, 0);
    }
    
    segmentsRef.current.forEach((segment) => {
      drawStitchByType(ctx, segment.type, segment.points, segment.color, segment.radius);
    });
    
    if (currentSegmentRef.current) {
      drawStitchByType(
        ctx,
        currentSegmentRef.current.type,
        currentSegmentRef.current.points,
        currentSegmentRef.current.color,
        currentSegmentRef.current.radius
      );
    }
    
    if (pendingPointsRef.current.length > 0 && currentSegmentRef.current) {
      drawStitchByType(
        ctx,
        currentSegmentRef.current.type,
        pendingPointsRef.current,
        currentSegmentRef.current.color,
        currentSegmentRef.current.radius
      );
    }
  }, []);

  const loop = useCallback(() => {
    if (pendingPointsRef.current.length > 0 && currentSegmentRef.current) {
      currentSegmentRef.current.points.push(...pendingPointsRef.current);
      pendingPointsRef.current = [];
      onSegmentsChange?.(segmentsRef.current);
    }
    render();
    animationFrameRef.current = requestAnimationFrame(loop);
  }, [render, onSegmentsChange]);

  const getCanvasCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = CANVAS_HEIGHT / rect.height;
    
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    
    const coords = getCanvasCoords(e);
    if (!coords) return;
    
    setIsDrawing(true);
    
    const newSegment: StitchSegment = {
      id: uuidv4(),
      type: stitchType,
      color: threadColor,
      points: [{ ...coords, pressure: 1, timestamp: Date.now() }],
      radius: stitchRadius,
    };
    currentSegmentRef.current = newSegment;
  }, [getCanvasCoords, stitchType, threadColor, stitchRadius]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoords(e);
    if (!coords) return;
    
    setCursorPos(coords);
    
    if (!isDrawing || !currentSegmentRef.current) return;
    
    const lastPoint = currentSegmentRef.current.points[currentSegmentRef.current.points.length - 1] || 
                     pendingPointsRef.current[pendingPointsRef.current.length - 1];
    
    if (lastPoint) {
      const dx = coords.x - lastPoint.x;
      const dy = coords.y - lastPoint.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1.5) return;
    }
    
    pendingPointsRef.current.push({
      ...coords,
      pressure: 1,
      timestamp: Date.now(),
    });
  }, [getCanvasCoords, isDrawing]);

  const handleMouseUp = useCallback(() => {
    if (!isDrawing || !currentSegmentRef.current) return;
    
    if (pendingPointsRef.current.length > 0) {
      currentSegmentRef.current.points.push(...pendingPointsRef.current);
      pendingPointsRef.current = [];
    }
    
    if (currentSegmentRef.current.points.length > 0) {
      segmentsRef.current.push(currentSegmentRef.current);
      onSegmentsChange?.([...segmentsRef.current]);
    }
    
    currentSegmentRef.current = null;
    setIsDrawing(false);
  }, [isDrawing, onSegmentsChange]);

  const handleMouseLeave = useCallback(() => {
    setCursorPos(null);
    if (isDrawing) {
      handleMouseUp();
    }
  }, [isDrawing, handleMouseUp]);

  const undo = useCallback(() => {
    const removeCount = Math.min(5, segmentsRef.current.length);
    segmentsRef.current.splice(-removeCount, removeCount);
    onSegmentsChange?.([...segmentsRef.current]);
  }, [onSegmentsChange]);

  const clear = useCallback(() => {
    setShowRipple(true);
    setTimeout(() => {
      segmentsRef.current = [];
      currentSegmentRef.current = null;
      pendingPointsRef.current = [];
      onSegmentsChange?.([]);
      setShowRipple(false);
    }, 1000);
  }, [onSegmentsChange]);

  const exportImage = useCallback((includeBackground: boolean): string => {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = CANVAS_WIDTH;
    exportCanvas.height = CANVAS_HEIGHT;
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return '';
    
    if (includeBackground && bgCanvasRef.current) {
      ctx.drawImage(bgCanvasRef.current, 0, 0);
    } else {
      ctx.fillStyle = '#fcf5e8';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
    
    segmentsRef.current.forEach((segment) => {
      drawStitchByType(ctx, segment.type, segment.points, segment.color, segment.radius);
    });
    
    return exportCanvas.toDataURL('image/png');
  }, []);

  const getSegments = useCallback((): StitchSegment[] => {
    return [...segmentsRef.current];
  }, []);

  React.useImperativeHandle(ref, () => ({
    undo,
    clear,
    exportImage,
    getSegments,
  }), [undo, clear, exportImage, getSegments]);

  useEffect(() => {
    initBackgroundCanvas();
    animationFrameRef.current = requestAnimationFrame(loop);
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [initBackgroundCanvas, loop]);

  useEffect(() => {
    if (showSilk) {
      const timer = setTimeout(() => setShowSilk(false), 500);
      return () => clearTimeout(timer);
    }
  }, [showSilk]);

  const triggerSilkEffect = useCallback(() => {
    setShowSilk(true);
  }, []);

  React.useEffect(() => {
    if (ref && 'current' in ref && ref.current) {
      (ref.current as EmbroideryCanvasHandle & { triggerSilkEffect?: () => void }).triggerSilkEffect = triggerSilkEffect;
    }
  }, [ref, triggerSilkEffect]);

  return (
    <div style={styles.canvasContainer}>
      <div style={styles.lotusColumnLeft}>
        <svg viewBox="0 0 30 450" style={styles.lotusSvg}>
          <path d="M15 10 Q25 20 15 30 Q5 20 15 10" fill="#6b4423" stroke="#5a3a1d" strokeWidth="1"/>
          <path d="M15 40 Q25 50 15 60 Q5 50 15 40" fill="#6b4423" stroke="#5a3a1d" strokeWidth="1"/>
          <path d="M15 70 Q25 80 15 90 Q5 80 15 70" fill="#6b4423" stroke="#5a3a1d" strokeWidth="1"/>
          <rect x="10" y="100" width="10" height="350" fill="#6b4423" rx="2"/>
          <path d="M15 380 Q25 390 15 400 Q5 390 15 380" fill="#6b4423" stroke="#5a3a1d" strokeWidth="1"/>
          <path d="M15 410 Q25 420 15 430 Q5 420 15 410" fill="#6b4423" stroke="#5a3a1d" strokeWidth="1"/>
        </svg>
      </div>
      
      <div style={styles.canvasWrapper}>
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          style={styles.canvas}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        />
        
        {cursorPos && !isDrawing && (
          <div
            style={{
              ...styles.cursorIndicator,
              left: `${(cursorPos.x / CANVAS_WIDTH) * 100}%`,
              top: `${(cursorPos.y / CANVAS_HEIGHT) * 100}%`,
              width: `${stitchRadius * 2 * (600 / CANVAS_WIDTH)}px`,
              height: `${stitchRadius * 2 * (450 / CANVAS_HEIGHT)}px`,
              borderColor: threadColor,
            }}
          />
        )}
        
        {showRipple && <div style={styles.ripple} />}
        
        {showSilk && <div style={styles.silkOverlay} />}
      </div>
      
      <div style={styles.lotusColumnRight}>
        <svg viewBox="0 0 30 450" style={styles.lotusSvg}>
          <path d="M15 10 Q25 20 15 30 Q5 20 15 10" fill="#6b4423" stroke="#5a3a1d" strokeWidth="1"/>
          <path d="M15 40 Q25 50 15 60 Q5 50 15 40" fill="#6b4423" stroke="#5a3a1d" strokeWidth="1"/>
          <path d="M15 70 Q25 80 15 90 Q5 80 15 70" fill="#6b4423" stroke="#5a3a1d" strokeWidth="1"/>
          <rect x="10" y="100" width="10" height="350" fill="#6b4423" rx="2"/>
          <path d="M15 380 Q25 390 15 400 Q5 390 15 380" fill="#6b4423" stroke="#5a3a1d" strokeWidth="1"/>
          <path d="M15 410 Q25 420 15 430 Q5 420 15 410" fill="#6b4423" stroke="#5a3a1d" strokeWidth="1"/>
        </svg>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  canvasContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8b5e3c',
    padding: '20px 10px',
    borderRadius: '8px',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 2px 4px rgba(255, 255, 255, 0.1)',
  },
  lotusColumnLeft: {
    width: '30px',
    height: '450px',
    marginRight: '5px',
  },
  lotusColumnRight: {
    width: '30px',
    height: '450px',
    marginLeft: '5px',
  },
  lotusSvg: {
    width: '100%',
    height: '100%',
  },
  canvasWrapper: {
    position: 'relative',
    width: '600px',
    height: '450px',
    borderRadius: '4px',
    overflow: 'hidden',
    boxShadow: 'inset 0 0 20px rgba(0, 0, 0, 0.2)',
  },
  canvas: {
    width: '100%',
    height: '100%',
    cursor: 'none',
    display: 'block',
  },
  cursorIndicator: {
    position: 'absolute',
    transform: 'translate(-50%, -50%)',
    border: '2px solid',
    borderRadius: '50%',
    pointerEvents: 'none',
    opacity: 0.8,
    transition: 'width 0.2s ease, height 0.2s ease',
  },
  ripple: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '10px',
    height: '10px',
    border: '3px solid rgba(100, 180, 255, 0.6)',
    borderRadius: '50%',
    animation: 'rippleExpand 1s ease-out forwards',
    pointerEvents: 'none',
  },
  silkOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    background: `
      linear-gradient(135deg, 
        rgba(255, 253, 231, 0.4) 0%, 
        rgba(255, 253, 231, 0.2) 25%,
        rgba(255, 253, 231, 0.4) 50%,
        rgba(255, 253, 231, 0.2) 75%,
        rgba(255, 253, 231, 0.4) 100%
      )
    `,
    backgroundSize: '200% 200%',
    animation: 'silkShimmer 0.5s ease-in-out',
    pointerEvents: 'none',
  },
};

const keyframesStyle = document.createElement('style');
keyframesStyle.textContent = `
  @keyframes rippleExpand {
    0% {
      width: 10px;
      height: 10px;
      opacity: 1;
    }
    100% {
      width: 800px;
      height: 800px;
      opacity: 0;
    }
  }
  @keyframes silkShimmer {
    0% {
      background-position: 0% 50%;
      opacity: 0;
    }
    50% {
      opacity: 1;
    }
    100% {
      background-position: 100% 50%;
      opacity: 0;
    }
  }
`;
document.head.appendChild(keyframesStyle);

export default React.forwardRef(EmbroideryCanvas);
