import { useRef, useEffect, useState, useCallback } from 'react';
import { layoutImagery, traditionalColors } from './utils/imagery';
import { drawImageryElement, drawInkSplash, drawPaperTexture } from './utils/inkElements';
import { drawBrushStroke, calculatePressure } from './utils/brush';
import type { ImageryMatch, BrushConfig, BrushType, DrawPoint, PoemData } from './types';

interface PaintingCanvasProps {
  imageryMatches: ImageryMatch[];
  poemData: PoemData;
  brushConfig: BrushConfig;
}

export function PaintingCanvas({ imageryMatches, poemData, brushConfig }: PaintingCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageryCanvasRef = useRef<HTMLCanvasElement>(null);
  const doodleCanvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 500 });
  const [isDrawing, setIsDrawing] = useState(false);
  const animationRef = useRef<number | null>(null);
  const currentPointsRef = useRef<DrawPoint[]>([]);
  const lastPointRef = useRef<DrawPoint | null>(null);
  const animatingElementsRef = useRef<{ match: ImageryMatch; startTime: number }[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const renderedMatchesRef = useRef<ImageryMatch[]>([]);

  const ANIMATION_DURATION = 600;

  const resizeCanvas = useCallback(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const aspectRatio = 16 / 9;
    let width = rect.width - 40;
    let height = rect.height - 40;

    if (width / height > aspectRatio) {
      width = height * aspectRatio;
    } else {
      height = width / aspectRatio;
    }

    width = Math.floor(width);
    height = Math.floor(height);

    setCanvasSize({ width, height });

    [imageryCanvasRef.current, doodleCanvasRef.current].forEach((canvas) => {
      if (canvas) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.scale(dpr, dpr);
        }
      }
    });

    renderImagery(imageryMatches);
  }, [imageryMatches]);

  const renderImagery = useCallback((matches: ImageryMatch[]) => {
    const canvas = imageryCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;

    ctx.clearRect(0, 0, width, height);
    drawPaperTexture(ctx, width, height);

    if (matches.length === 0) return;

    const layouted = layoutImagery(matches, width, height);
    renderedMatchesRef.current = layouted;

    animatingElementsRef.current = layouted.map((match, index) => ({
      match,
      startTime: performance.now() + index * 150,
    }));

    animationFrameRef.current = requestAnimationFrame(animateElements);
  }, []);

  const animateElements = useCallback(() => {
    const canvas = imageryCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;

    const now = performance.now();
    let allDone = true;

    ctx.clearRect(0, 0, width, height);
    drawPaperTexture(ctx, width, height);

    animatingElementsRef.current.forEach(({ match, startTime }) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / ANIMATION_DURATION, 1);
      const easeProgress = 1 - Math.pow(1 - progress, 3);

      if (progress < 1) {
        allDone = false;
        drawInkSplash(
          ctx,
          match.x,
          match.y,
          60 * match.scale,
          match.inkOpacity,
          easeProgress
        );
      }

      if (progress > 0.3) {
        const elementProgress = Math.min((progress - 0.3) / 0.7, 1);
        const elementEase = 1 - Math.pow(1 - elementProgress, 2);
        ctx.globalAlpha = elementEase;
        drawImageryElement(
          ctx,
          match.keyword,
          match.x,
          match.y,
          match.scale,
          match.inkOpacity
        );
        ctx.globalAlpha = 1;
      }
    });

    if (!allDone) {
      animationFrameRef.current = requestAnimationFrame(animateElements);
    } else {
      animationFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handleResize = () => {
      resizeCanvas();
    };

    window.addEventListener('resize', handleResize);
    resizeCanvas();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [resizeCanvas]);

  useEffect(() => {
    if (imageryMatches.length > 0) {
      renderImagery(imageryMatches);
    }
  }, [imageryMatches, renderImagery]);

  const getCanvasPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const canvas = doodleCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const startDrawing = (x: number, y: number) => {
    setIsDrawing(true);
    const point: DrawPoint = {
      x,
      y,
      pressure: 0.5,
      timestamp: performance.now(),
    };
    currentPointsRef.current = [point];
    lastPointRef.current = point;
  };

  const continueDrawing = (x: number, y: number) => {
    if (!isDrawing) return;

    const point: DrawPoint = {
      x,
      y,
      pressure: 0.5,
      timestamp: performance.now(),
    };

    point.pressure = calculatePressure(point, lastPointRef.current, brushConfig.size);

    currentPointsRef.current.push(point);

    const canvas = doodleCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const lastTwo = currentPointsRef.current.slice(-2);
        drawBrushStroke(
          ctx,
          lastTwo,
          brushConfig.color,
          brushConfig.size,
          brushConfig.type
        );
      }
    }

    lastPointRef.current = point;
  };

  const endDrawing = () => {
    setIsDrawing(false);
    currentPointsRef.current = [];
    lastPointRef.current = null;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasPoint(e.clientX, e.clientY);
    startDrawing(x, y);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasPoint(e.clientX, e.clientY);
    continueDrawing(x, y);
  };

  const handleMouseUp = () => {
    endDrawing();
  };

  const handleMouseLeave = () => {
    if (isDrawing) {
      endDrawing();
    }
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (e.touches.length > 0) {
      const touch = e.touches[0];
      const { x, y } = getCanvasPoint(touch.clientX, touch.clientY);
      startDrawing(x, y);
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (e.touches.length > 0 && isDrawing) {
      const touch = e.touches[0];
      const { x, y } = getCanvasPoint(touch.clientX, touch.clientY);
      continueDrawing(x, y);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    endDrawing();
  };

  return (
    <div className="canvas-wrapper" ref={containerRef}>
      <div
        className={`canvas-container ${isDrawing ? 'drawing' : ''}`}
        style={{
          width: `${canvasSize.width}px`,
          height: `${canvasSize.height}px`,
        }}
      >
        <canvas
          ref={imageryCanvasRef}
          className="paint-canvas"
          style={{ zIndex: 1 }}
        />
        <canvas
          ref={doodleCanvasRef}
          className="paint-canvas"
          style={{ zIndex: 2 }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        />
      </div>
    </div>
  );
}

interface ToolbarProps {
  brushConfig: BrushConfig;
  setBrushConfig: (config: BrushConfig) => void;
  onSave: () => void;
  onClear: () => void;
}

export function Toolbar({ brushConfig, setBrushConfig, onSave, onClear }: ToolbarProps) {
  const brushTypes: { type: BrushType; label: string; icon: string }[] = [
    { type: 'brush', label: '毛笔', icon: '🖌️' },
    { type: 'pencil', label: '铅笔', icon: '✏️' },
    { type: 'spray', label: '喷枪', icon: '💨' },
  ];

  const handleBrushChange = (type: BrushType) => {
    setBrushConfig({ ...brushConfig, type });
  };

  const handleColorChange = (color: string) => {
    setBrushConfig({ ...brushConfig, color });
  };

  const handleSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBrushConfig({ ...brushConfig, size: Number(e.target.value) });
  };

  return (
    <div className="toolbar">
      <div className="tool-group">
        {brushTypes.map((brush) => (
          <button
            key={brush.type}
            className={`tool-btn ${brushConfig.type === brush.type ? 'active' : ''}`}
            onClick={() => handleBrushChange(brush.type)}
            title={brush.label}
          >
            <span>{brush.icon}</span>
            <span className="tooltip">{brush.label}</span>
          </button>
        ))}
      </div>

      <div className="tool-divider" />

      <div className="tool-group">
        <div className="color-palette">
          {traditionalColors.map((color) => (
            <div
              key={color.name}
              className={`color-swatch ${brushConfig.color === color.value ? 'active' : ''}`}
              style={{ backgroundColor: color.value }}
              onClick={() => handleColorChange(color.value)}
              title={color.name}
            />
          ))}
        </div>
      </div>

      <div className="tool-divider" />

      <div className="tool-group">
        <div className="size-slider">
          <span style={{ fontSize: '13px', color: '#666' }}>细</span>
          <input
            type="range"
            min="2"
            max="30"
            value={brushConfig.size}
            onChange={handleSizeChange}
          />
          <span style={{ fontSize: '13px', color: '#666' }}>粗</span>
          <span className="size-value">{brushConfig.size}px</span>
        </div>
      </div>

      <div className="tool-divider" />

      <div className="tool-group">
        <button className="tool-btn" onClick={onClear} title="清空涂鸦">
          <span>🗑️</span>
          <span className="tooltip">清空涂鸦</span>
        </button>
        <button className="save-btn" onClick={onSave}>
          保存作品
        </button>
      </div>
    </div>
  );
}
