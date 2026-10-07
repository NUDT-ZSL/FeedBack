import React, { useRef, useEffect, useState, useCallback } from 'react';
import { PRESET_PATTERNS } from '../utils/patterns';
import { useFanStore } from '../store/useFanStore';
import { BrushType, COLORS, MINERAL_COLORS, BRUSH_TYPES, OverlayPattern } from '../types';

const CANVAS_SIZE = 400;
const FAN_RADIUS = 200;

export const FanDesigner: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number; rotation: number } | null>(null);
  const [selectedPattern, setSelectedPattern] = useState<OverlayPattern | null>(null);

  const {
    currentFanSurface, isDrawing, currentBrush, currentColor, brushSize,
    is定型, show定型Animation, overlayOpacity, createFanSurface, addStroke,
    updateLastStroke, setIsDrawing, setCurrentBrush, setCurrentColor, setBrushSize,
    addOverlay, updateOverlay, setOverlayOpacity, 定型FanSurface,
    complete定型Animation, resetAll,
  } = useFanStore();

  const drawPaperTexture = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = '#faf6e9';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    const imgData = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    for (let i = 0; i < imgData.data.length; i += 4) {
      const n = Math.random() * 10 - 5;
      imgData.data[i] += n; imgData.data[i + 1] += n; imgData.data[i + 2] += n;
    }
    ctx.putImageData(imgData, 0, 0);
  }, []);

  const drawSilkTexture = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = COLORS.cream;
    ctx.beginPath();
    ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, FAN_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#e0d0b8';
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = 0.3;
    for (let i = 0; i < CANVAS_SIZE; i += 8) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, CANVAS_SIZE); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(CANVAS_SIZE, i); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }, []);

  const drawStroke = useCallback((
    ctx: CanvasRenderingContext2D, from: { x: number; y: number },
    to: { x: number; y: number }, brush: BrushType, color: string, size: number
  ) => {
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    switch (brush) {
      case 'fine':
        ctx.lineWidth = size; ctx.beginPath();
        ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
        break;
      case 'splash':
        ctx.lineWidth = size * 3; ctx.globalAlpha = 0.6;
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
        for (let i = 0; i < 5; i++) {
          ctx.globalAlpha = Math.random() * 0.3;
          ctx.beginPath();
          ctx.arc(to.x + (Math.random() - 0.5) * size * 4,
                  to.y + (Math.random() - 0.5) * size * 4,
                  Math.random() * size * 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        break;
      case 'dot':
        ctx.globalAlpha = 0.7 + Math.random() * 0.3;
        ctx.beginPath();
        ctx.arc(to.x, to.y, size * (0.5 + Math.random()), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      case 'row':
        ctx.lineWidth = size * 0.5; ctx.globalAlpha = 0.8;
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(from.x + i * size, from.y);
          ctx.lineTo(to.x + i * size, to.y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        break;
    }
  }, []);

  const render = useCallback(() => {
    const canvas = canvasRef.current, overlay = overlayCanvasRef.current;
    if (!canvas || !overlay) return;
    const ctx = canvas.getContext('2d'), octx = overlay.getContext('2d');
    if (!ctx || !octx) return;

    drawPaperTexture(ctx);
    if (!currentFanSurface) {
      ctx.fillStyle = '#9a8a7a'; ctx.font = '18px serif'; ctx.textAlign = 'center';
      ctx.fillText('请从左侧材料架拖拽扇面到此处', CANVAS_SIZE / 2, CANVAS_SIZE / 2);
      return;
    }

    drawSilkTexture(ctx);
    ctx.save();
    ctx.beginPath();
    ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, FAN_RADIUS - 5, 0, Math.PI * 2);
    ctx.clip();

    currentFanSurface.strokes.forEach(s => {
      for (let i = 1; i < s.points.length; i++) {
        drawStroke(ctx, s.points[i - 1], s.points[i], s.brushType, s.color, s.size);
      }
    });

    currentFanSurface.overlays.forEach(overlay => {
      const img = new Image();
      const url = URL.createObjectURL(new Blob([overlay.svgData], { type: 'image/svg+xml' }));
      img.onload = () => {
        ctx.save();
        ctx.globalAlpha = overlay.opacity / 100;
        ctx.translate(overlay.x + 100, overlay.y + 100);
        ctx.rotate(overlay.rotation * Math.PI / 180);
        ctx.scale(overlay.scale, overlay.scale);
        ctx.drawImage(img, -100, -100, 200, 200);
        ctx.restore();
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });

    ctx.restore();

    if (show定型Animation) {
      ctx.fillStyle = 'rgba(26, 26, 26, 0.1)';
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    }

    if (is定型) {
      ctx.strokeStyle = COLORS.wood; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, FAN_RADIUS - 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = COLORS.cinnabar; ctx.font = 'bold 14px serif'; ctx.textAlign = 'center';
      ctx.fillText('待组装', CANVAS_SIZE / 2, CANVAS_SIZE - 30);
    }

    octx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    if (selectedPattern) {
      octx.save();
      octx.globalAlpha = overlayOpacity / 100 * 0.6;
      octx.strokeStyle = '#6b4e3a'; octx.setLineDash([5, 5]); octx.lineWidth = 1;
      octx.translate(selectedPattern.x + 100, selectedPattern.y + 100);
      octx.rotate(selectedPattern.rotation * Math.PI / 180);
      octx.scale(selectedPattern.scale, selectedPattern.scale);
      octx.strokeRect(-100, -100, 200, 200);
      octx.restore();
    }
  }, [currentFanSurface, show定型Animation, is定型, selectedPattern, overlayOpacity,
      drawPaperTexture, drawSilkTexture, drawStroke]);

  useEffect(() => {
    const animate = () => { render(); animationRef.current = requestAnimationFrame(animate); };
    animationRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationRef.current);
  }, [render]);

  useEffect(() => {
    if (show定型Animation) {
      const t = setTimeout(complete定型Animation, 500);
      return () => clearTimeout(t);
    }
  }, [show定型Animation, complete定型Animation]);

  const getPoint = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : { x: 0, y: 0 };
  };

  const inFan = (p: { x: number; y: number }) =>
    Math.sqrt(Math.pow(p.x - CANVAS_SIZE / 2, 2) + Math.pow(p.y - CANVAS_SIZE / 2, 2)) <= FAN_RADIUS - 5;

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!currentFanSurface || is定型) return;
    const p = getPoint(e);
    if (!inFan(p)) return;
    if (e.ctrlKey && selectedPattern) {
      isDraggingRef.current = true;
      dragStartRef.current = { x: e.clientX, y: e.clientY, rotation: selectedPattern.rotation };
      return;
    }
    setIsDrawing(true);
    lastPointRef.current = p;
    addStroke({
      id: `stroke-${Date.now()}`,
      points: [p],
      brushType: currentBrush,
      color: currentColor,
      size: brushSize,
      opacity: 1,
    });
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const p = getPoint(e);
    if (isDraggingRef.current && selectedPattern && dragStartRef.current) {
      const rotation = dragStartRef.current.rotation + (p.x - dragStartRef.current.x) / 2;
      const updates = { x: p.x - 100, y: p.y - 100, rotation };
      updateOverlay(selectedPattern.id, updates);
      setSelectedPattern({ ...selectedPattern, ...updates });
      return;
    }
    if (!isDrawing || !currentFanSurface || is定型) return;
    if (!inFan(p)) return;
    updateLastStroke(p);
    lastPointRef.current = p;
  };

  const onMouseUp = () => {
    setIsDrawing(false);
    isDraggingRef.current = false;
    dragStartRef.current = null;
  };

  const handleSelectPattern = (preset: (typeof PRESET_PATTERNS)[number]) => {
    if (!currentFanSurface) {
      return;
    }
    const overlay: OverlayPattern = {
      ...preset,
      id: `${preset.id}-${Date.now()}`,
      x: CANVAS_SIZE / 2 - 100,
      y: CANVAS_SIZE / 2 - 100,
      scale: 1,
      rotation: 0,
      opacity: overlayOpacity,
    };
    addOverlay(overlay);
    setSelectedPattern(overlay);
  };

  const handleOpacityChange = (value: number) => {
    setOverlayOpacity(value);
    if (selectedPattern) {
      updateOverlay(selectedPattern.id, { opacity: value });
      setSelectedPattern({ ...selectedPattern, opacity: value });
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6 p-4 md:p-6 justify-center">
      <div className="w-full lg:w-64 space-y-5 rounded-lg border-4 p-4" style={{ borderColor: COLORS.wood, backgroundColor: COLORS.cream }}>
        <div>
          <h3 className="font-bold mb-2" style={{ color: COLORS.wood }}>材料架</h3>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => createFanSurface('round')}
              className="px-3 py-1 rounded text-sm text-white hover:opacity-90" style={{ backgroundColor: COLORS.azurite }}>
              圆形团扇
            </button>
            <button onClick={() => createFanSurface('fan')}
              className="px-3 py-1 rounded text-sm text-white hover:opacity-90" style={{ backgroundColor: COLORS.azurite }}>
              折扇扇面
            </button>
          </div>
        </div>

        <div>
          <h3 className="font-bold mb-2" style={{ color: COLORS.wood }}>画笔</h3>
          <div className="grid grid-cols-2 gap-2">
            {BRUSH_TYPES.map((b) => (
              <button key={b.type} onClick={() => setCurrentBrush(b.type as BrushType)}
                className="px-2 py-1 rounded text-sm text-white hover:opacity-90"
                style={{ backgroundColor: currentBrush === b.type ? COLORS.cinnabar : COLORS.wood }}>
                {b.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="font-bold mb-2" style={{ color: COLORS.wood }}>矿物颜料</h3>
          <div className="flex flex-wrap gap-2">
            {MINERAL_COLORS.map((c) => (
              <button key={c.value} title={c.name} onClick={() => setCurrentColor(c.value)}
                className="w-8 h-8 rounded-full border-2 hover:scale-110 transition-transform"
                style={{ backgroundColor: c.value, borderColor: currentColor === c.value ? COLORS.goldDark : 'transparent' }} />
            ))}
          </div>
        </div>

        <div>
          <h3 className="font-bold mb-2" style={{ color: COLORS.wood }}>笔刷大小：{brushSize}</h3>
          <input type="range" min={1} max={20} value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))} className="w-full" />
        </div>

        <div>
          <h3 className="font-bold mb-2" style={{ color: COLORS.wood }}>图样底稿（按住 Ctrl 拖动）</h3>
          <div className="flex flex-wrap gap-2">
            {PRESET_PATTERNS.map((p) => (
              <button key={p.id} onClick={() => handleSelectPattern(p)}
                className="px-3 py-1 rounded text-sm text-white hover:opacity-90" style={{ backgroundColor: COLORS.malachite }}>
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="font-bold mb-2" style={{ color: COLORS.wood }}>图样透明度：{overlayOpacity}</h3>
          <input type="range" min={0} max={100} value={overlayOpacity}
            onChange={(e) => handleOpacityChange(Number(e.target.value))} className="w-full" />
        </div>

        <div className="flex gap-2">
          <button onClick={定型FanSurface} disabled={!currentFanSurface || is定型}
            className="flex-1 px-3 py-2 rounded text-sm text-white hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: COLORS.cinnabar }}>
            定型
          </button>
          <button onClick={resetAll}
            className="px-3 py-2 rounded text-sm text-white hover:opacity-90" style={{ backgroundColor: COLORS.gray }}>
            重置
          </button>
        </div>
        {is定型 && <p className="text-sm font-medium" style={{ color: COLORS.malachite }}>扇面已定型，可进入组装页面</p>}
      </div>

      <div className="relative" style={{ width: CANVAS_SIZE }}>
        <canvas
          ref={canvasRef}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          className="rounded-lg shadow-lg cursor-crosshair"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        />
        <canvas
          ref={overlayCanvasRef}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          className="absolute inset-0 pointer-events-none"
        />
      </div>
    </div>
  );
};

export default FanDesigner;
