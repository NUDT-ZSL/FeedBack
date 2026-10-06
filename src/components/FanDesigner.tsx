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
    addStroke({ id: `s-${Date.now()}`, points: [p],      brushType: currentBrush, color: currentColor, size: brushSize, opacity: 1 });
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDraggingRef.current && selectedPattern && dragStartRef.current) {
      const rotation = dragStartRef.current.rotation + (e.clientX - dragStartRef.current.x) * 0.5;
      updateOverlay(selectedPattern.id, { rotation });
      setSelectedPattern({ ...selectedPattern, rotation });
      return;
    }
    if (!isDrawing) return;
    const p = getPoint(e);
    if (!inFan(p)) return;
    updateLastStroke(p);
  };

  const onMouseUp = () => {
    isDraggingRef.current = false;
    dragStartRef.current = null;
    setIsDrawing(false);
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!selectedPattern) return;
    const scale = Math.min(3, Math.max(0.3, selectedPattern.scale - e.deltaY * 0.001));
    updateOverlay(selectedPattern.id, { scale });
    setSelectedPattern({ ...selectedPattern, scale });
  };

  const handleAddPattern = (pattern: (typeof PRESET_PATTERNS)[number]) => {
    if (!currentFanSurface || is定型) return;
    const overlay: OverlayPattern = {
      ...pattern,
      id: `${pattern.id}-${Date.now()}`,
      x: 100, y: 100, scale: 1, rotation: 0, opacity: overlayOpacity,
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

  const handleDropSurface = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const shape = e.dataTransfer.getData('fan-shape');
    if (shape === 'round' || shape === 'fan') {
      createFanSurface(shape);
    }
  };

  return (
    <div className="p-4 flex gap-4" style={{ minHeight: 560 }}>
      <div className="w-32 shrink-0 space-y-3">
        <p className="text-sm font-bold text-[#6b4e3a]">材料架</p>
        {[
          { shape: 'round' as const, label: '圆形团扇' },
          { shape: 'fan' as const, label: '折扇扇面' },
        ].map((item) => (
          <div key={item.shape} draggable
            onDragStart={(e) => e.dataTransfer.setData('fan-shape', item.shape)}
            className="cursor-grab active:cursor-grabbing rounded-lg border-2 border-[#6b4e3a]/40 bg-[#f5e6d3] p-3 text-center text-xs text-[#6b4e3a] hover:shadow-md transition-shadow">
            <div className={`mx-auto mb-2 bg-[#f5e6d3] border border-[#6b4e3a]/50 ${item.shape === 'round' ? 'w-12 h-12 rounded-full' : 'w-14 h-10 rounded-t-full'}`} />
            {item.label}
          </div>
        ))}
        <p className="text-[10px] text-gray-400">拖拽素绢扇面至画案</p>
      </div>

      <div className="flex-1 flex items-start justify-center"
        onDrop={handleDropSurface} onDragOver={(e) => e.preventDefault()}>
        <div className="relative" style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}>
          <canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE}
            className="absolute inset-0 rounded-lg shadow-lg cursor-crosshair"
            onMouseDown={onMouseDown} onMouseMove={onMouseMove}
            onMouseUp={onMouseUp} onMouseLeave={onMouseUp} onWheel={onWheel} />
          <canvas ref={overlayCanvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE}
            className="absolute inset-0 pointer-events-none" />
          {currentFanSurface && (
            <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-white text-xs"
              style={{ backgroundColor: is定型 ? '#4a7c59' : '#9a8a7a' }}>
              {is定型 ? '待组装' : '草稿'}
            </span>
          )}
        </div>
      </div>

      <div className="w-52 shrink-0 space-y-4">
        <div>
          <p className="text-sm font-bold text-[#6b4e3a] mb-2">画笔</p>
          <div className="grid grid-cols-2 gap-2">
            {BRUSH_TYPES.map((item) => (
              <button key={item.type} onClick={() => setCurrentBrush(item.type)}
                className="px-2 py-1.5 rounded text-xs border transition-colors"
                style={{
                  backgroundColor: currentBrush === item.type ? '#6b4e3a' : '#ffffff',
                  color: currentBrush === item.type ? '#f5e6d3' : '#6b4e3a',
                  borderColor: '#6b4e3a',
                }}>
                <i className={`fa-solid ${item.icon} mr-1`} />{item.name}
              </button>
            ))}
          </div>
          <label className="block text-xs text-gray-500 mt-2">笔锋粗细 {brushSize}</label>
          <input type="range" min={1} max={12} value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))} className="w-full" />
        </div>

        <div>
          <p className="text-sm font-bold text-[#6b4e3a] mb-2">矿物颜料</p>
          <div className="flex flex-wrap gap-2">
            {MINERAL_COLORS.map((c) => (
              <button key={c.value} title={c.name} onClick={() => setCurrentColor(c.value)}
                className="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110"
                style={{
                  backgroundColor: c.value,
                  borderColor: currentColor === c.value ? '#d4a017' : 'transparent',
                }} />
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-bold text-[#6b4e3a] mb-2">预制图样</p>
          <div className="flex flex-wrap gap-2">
            {PRESET_PATTERNS.map((pattern) => (
              <button key={pattern.id} onClick={() => handleAddPattern(pattern)}
                className="px-2 py-1 rounded text-xs bg-white border border-[#6b4e3a]/40 text-[#6b4e3a] hover:bg-amber-100">
                {pattern.name}
              </button>
            ))}
          </div>
          <label className="block text-xs text-gray-500 mt-2">底稿透明度 {overlayOpacity}%</label>
          <input type="range" min={0} max={100} value={overlayOpacity}
            onChange={(e) => handleOpacityChange(Number(e.target.value))} className="w-full" />
          <p className="text-[10px] text-gray-400 mt-1">滚轮缩放底稿，Ctrl+拖拽旋转</p>
        </div>

        <div className="space-y-2 pt-2 border-t border-[#6b4e3a]/20">
          <button onClick={定型FanSurface} disabled={!currentFanSurface || is定型}
            className="w-full px-3 py-2 rounded text-sm text-white disabled:opacity-40"
            style={{ backgroundColor: '#3a6b8a' }}>
            <i className="fa-solid fa-wand-magic-sparkles mr-1" />定型
          </button>
          <button onClick={resetAll}
            className="w-full px-3 py-2 rounded text-sm border border-[#6b4e3a]/40 text-[#6b4e3a] hover:bg-amber-100">
            <i className="fa-solid fa-rotate-left mr-1" />重置画案
          </button>
        </div>
      </div>
    </div>
  );
};
