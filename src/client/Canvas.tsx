import React, { useRef, useEffect, useState, useCallback } from 'react';

export interface Point {
  x: number;
  y: number;
}

export interface CanvasElement {
  id: string;
  type: 'freehand' | 'rectangle' | 'circle' | 'line' | 'text' | 'sticker';
  color: string;
  width: number;
  points?: Point[];
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  text?: string;
  fontSize?: number;
  x?: number;
  y?: number;
  sticker?: string;
}

interface CanvasProps {
  color: string;
  brushSize: number;
  tool: 'freehand' | 'rectangle' | 'circle' | 'line' | 'text' | 'sticker';
  sticker: string;
  onDraw: (element: CanvasElement) => void;
  onMove: (id: string, x: number, y: number) => void;
  onDelete: (id: string) => void;
  elements: CanvasElement[];
  onAddElements: (elements: CanvasElement[]) => void;
}

let idCounter = 0;
function generateId(): string {
  idCounter += 1;
  return `el-${Date.now()}-${idCounter}`;
}

function drawElement(ctx: CanvasRenderingContext2D, el: CanvasElement, selected?: boolean) {
  ctx.save();
  ctx.strokeStyle = el.color;
  ctx.fillStyle = el.color;
  ctx.lineWidth = el.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (selected && (el.type === 'text' || el.type === 'sticker') && el.x != null && el.y != null) {
    const cx = el.x + 20;
    const cy = el.y + 20;
    ctx.translate(cx, cy);
    ctx.scale(1.05, 1.05);
    ctx.translate(-cx, -cy);
  }

  switch (el.type) {
    case 'freehand': {
      if (!el.points || el.points.length === 0) break;
      ctx.beginPath();
      ctx.moveTo(el.points[0].x, el.points[0].y);
      for (let i = 1; i < el.points.length; i++) {
        ctx.lineTo(el.points[i].x, el.points[i].y);
      }
      ctx.stroke();
      break;
    }
    case 'rectangle': {
      if (el.startX == null || el.startY == null || el.endX == null || el.endY == null) break;
      ctx.strokeRect(el.startX, el.startY, el.endX - el.startX, el.endY - el.startY);
      break;
    }
    case 'circle': {
      if (el.startX == null || el.startY == null || el.endX == null || el.endY == null) break;
      const cx = (el.startX + el.endX) / 2;
      const cy = (el.startY + el.endY) / 2;
      const rx = Math.abs(el.endX - el.startX) / 2;
      const ry = Math.abs(el.endY - el.startY) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'line': {
      if (el.startX == null || el.startY == null || el.endX == null || el.endY == null) break;
      ctx.beginPath();
      ctx.moveTo(el.startX, el.startY);
      ctx.lineTo(el.endX, el.endY);
      ctx.stroke();
      break;
    }
    case 'text': {
      if (el.text == null || el.x == null || el.y == null) break;
      ctx.font = `${el.fontSize || 16}px sans-serif`;
      ctx.fillText(el.text, el.x, el.y);
      if (selected) {
        const w = (el.text.length * (el.fontSize || 16) * 0.6) + 10;
        const h = (el.fontSize || 16) + 10;
        ctx.strokeStyle = '#00d4ff';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(el.x - 5, el.y - (el.fontSize || 16) - 5, w, h);
      }
      break;
    }
    case 'sticker': {
      if (el.sticker == null || el.x == null || el.y == null) break;
      ctx.save();
      ctx.font = '36px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
      ctx.textBaseline = 'top';
      const metrics = ctx.measureText(el.sticker);
      const textWidth = metrics.width;
      const textHeight = 36;
      const scale = Math.min(40 / textWidth, 40 / textHeight);
      const drawX = el.x + (40 - textWidth * scale) / 2;
      const drawY = el.y + (40 - textHeight * scale) / 2;
      ctx.translate(drawX, drawY);
      ctx.scale(scale, scale);
      ctx.fillText(el.sticker, 0, 0);
      ctx.restore();
      if (selected) {
        ctx.strokeStyle = '#00d4ff';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(el.x - 2, el.y - 2, 44, 44);
      }
      break;
    }
  }

  ctx.restore();
}

function hitTestElement(el: CanvasElement, px: number, py: number): boolean {
  const hitRadius = 20;
  if (el.type === 'text' && el.x != null && el.y != null) {
    const textWidth = (el.text || '').length * (el.fontSize || 16) * 0.6;
    return px >= el.x - 5 && px <= el.x + textWidth + 5 && py >= el.y - (el.fontSize || 16) - 5 && py <= el.y + 5;
  }
  if (el.type === 'sticker' && el.x != null && el.y != null) {
    return px >= el.x - hitRadius && px <= el.x + 40 + hitRadius && py >= el.y - hitRadius && py <= el.y + 40 + hitRadius;
  }
  return false;
}

const Canvas: React.FC<CanvasProps> = ({
  color,
  brushSize,
  tool,
  sticker,
  onDraw,
  onMove,
  onDelete,
  elements,
  onAddElements,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDrawingRef = useRef(false);
  const currentElementRef = useRef<CanvasElement | null>(null);
  const pointsRef = useRef<Point[]>([]);
  const startRef = useRef<Point>({ x: 0, y: 0 });
  const rafRef = useRef<number>(0);

  const [textInput, setTextInput] = useState<{ x: number; y: number; visible: boolean }>({
    x: 0,
    y: 0,
    visible: false,
  });
  const [textValue, setTextValue] = useState('');

  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number; lastX: number; lastY: number; lastPtX: number; lastPtY: number } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const getCanvasCoords = useCallback((clientX: number, clientY: number): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }, []);

  const redraw = useCallback((previewElement?: CanvasElement, selectedId?: string | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const el of elements) {
      drawElement(ctx, el, el.id === selectedId);
    }

    if (previewElement) {
      ctx.save();
      ctx.setLineDash([5, 5]);
      drawElement(ctx, previewElement);
      ctx.restore();
    }
  }, [elements]);

  const scheduleRedraw = useCallback((previewElement?: CanvasElement) => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(() => {
      redraw(previewElement);
    });
  }, [redraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
      }
      redraw();
    };

    resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [redraw]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  useEffect(() => {
    if (draggingId) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          onDelete(draggingId);
          setDraggingId(null);
          dragRef.current = null;
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [draggingId, onDelete]);

  const findElementAtPoint = useCallback((px: number, py: number): CanvasElement | null => {
    for (let i = elements.length - 1; i >= 0; i--) {
      if (hitTestElement(elements[i], px, py)) {
        return elements[i];
      }
    }
    return null;
  }, [elements]);

  const handlePointerDown = useCallback((clientX: number, clientY: number) => {
    const pt = getCanvasCoords(clientX, clientY);

    const hitEl = findElementAtPoint(pt.x, pt.y);
    if (hitEl && (hitEl.type === 'text' || hitEl.type === 'sticker')) {
      dragRef.current = {
        id: hitEl.id,
        offsetX: pt.x - (hitEl.x || 0),
        offsetY: pt.y - (hitEl.y || 0),
        lastX: hitEl.x || 0,
        lastY: hitEl.y || 0,
        lastPtX: pt.x,
        lastPtY: pt.y,
      };
      setDraggingId(hitEl.id);
      return;
    }

    if (tool === 'text') {
      setTextInput({ x: pt.x, y: pt.y, visible: true });
      setTextValue('');
      return;
    }

    if (tool === 'sticker') {
      const el: CanvasElement = {
        id: generateId(),
        type: 'sticker',
        color,
        width: brushSize,
        x: pt.x,
        y: pt.y,
        sticker,
      };
      onDraw(el);
      return;
    }

    isDrawingRef.current = true;
    startRef.current = pt;

    if (tool === 'freehand') {
      pointsRef.current = [pt];
      currentElementRef.current = {
        id: generateId(),
        type: 'freehand',
        color,
        width: brushSize,
        points: [pt],
      };
    } else {
      currentElementRef.current = {
        id: generateId(),
        type: tool,
        color,
        width: brushSize,
        startX: pt.x,
        startY: pt.y,
        endX: pt.x,
        endY: pt.y,
      };
    }
  }, [tool, color, brushSize, sticker, getCanvasCoords, findElementAtPoint, onDraw]);

  const handlePointerMove = useCallback((clientX: number, clientY: number) => {
    const pt = getCanvasCoords(clientX, clientY);

    if (dragRef.current) {
      const deltaX = pt.x - dragRef.current.lastPtX;
      const deltaY = pt.y - dragRef.current.lastPtY;
      dragRef.current.lastX += deltaX;
      dragRef.current.lastY += deltaY;
      dragRef.current.lastPtX = pt.x;
      dragRef.current.lastPtY = pt.y;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const el of elements) {
        if (el.id === dragRef.current.id) {
          const moved = { ...el, x: dragRef.current.lastX, y: dragRef.current.lastY };
          drawElement(ctx, moved, true);
        } else {
          drawElement(ctx, el);
        }
      }
      return;
    }

    if (!isDrawingRef.current || !currentElementRef.current) return;

    if (tool === 'freehand') {
      pointsRef.current.push(pt);
      currentElementRef.current = {
        ...currentElementRef.current,
        points: [...pointsRef.current],
      };
      scheduleRedraw(currentElementRef.current);
    } else {
      currentElementRef.current = {
        ...currentElementRef.current,
        endX: pt.x,
        endY: pt.y,
      };
      scheduleRedraw(currentElementRef.current);
    }
  }, [tool, getCanvasCoords, elements, scheduleRedraw]);

  const handlePointerUp = useCallback(() => {
    if (dragRef.current) {
      onMove(dragRef.current.id, dragRef.current.lastX, dragRef.current.lastY);
      dragRef.current = null;
      setDraggingId(null);
      redraw(undefined, null);
      return;
    }

    if (!isDrawingRef.current || !currentElementRef.current) return;
    isDrawingRef.current = false;

    const el = currentElementRef.current;
    currentElementRef.current = null;
    pointsRef.current = [];

    onDraw(el);
  }, [onDraw, onMove, redraw]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    handlePointerDown(e.clientX, e.clientY);
  }, [handlePointerDown]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    handlePointerMove(e.clientX, e.clientY);
  }, [handlePointerMove]);

  const handleMouseUp = useCallback(() => {
    handlePointerUp();
  }, [handlePointerUp]);

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const touch = e.touches[0];
    handlePointerDown(touch.clientX, touch.clientY);
  }, [handlePointerDown]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const touch = e.touches[0];
    handlePointerMove(touch.clientX, touch.clientY);
  }, [handlePointerMove]);

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    handlePointerUp();
  }, [handlePointerUp]);

  const handleTextInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && textValue.trim()) {
      const el: CanvasElement = {
        id: generateId(),
        type: 'text',
        color,
        width: brushSize,
        text: textValue.trim(),
        fontSize: 16,
        x: textInput.x,
        y: textInput.y,
      };
      onDraw(el);
      setTextInput((prev) => ({ ...prev, visible: false }));
      setTextValue('');
    } else if (e.key === 'Escape') {
      setTextInput((prev) => ({ ...prev, visible: false }));
      setTextValue('');
    }
  }, [textValue, textInput.x, textInput.y, color, brushSize, onDraw]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        overflow: 'hidden',
        minHeight: '600px',
        height: 'calc(100vh - 60px)',
        marginTop: '60px',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          cursor: tool === 'text' ? 'text' : tool === 'sticker' ? 'copy' : 'crosshair',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />

      {textInput.visible && (
        <input
          autoFocus
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          onKeyDown={handleTextInputKeyDown}
          onBlur={() => {
            setTextInput((prev) => ({ ...prev, visible: false }));
            setTextValue('');
          }}
          style={{
            position: 'absolute',
            left: textInput.x,
            top: textInput.y - 16,
            color,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            fontSize: '16px',
            fontFamily: 'sans-serif',
            minWidth: '100px',
            zIndex: 10,
          }}
        />
      )}
    </div>
  );
};

export default Canvas;
export type { CanvasElement, CanvasProps };
