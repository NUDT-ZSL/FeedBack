import React, { useRef, useState, useCallback, useEffect } from 'react';
import { ElementConfig, BandTheme, CANVAS_WIDTH, CANVAS_HEIGHT } from './types';

interface CanvasProps {
  theme: BandTheme;
  elements: ElementConfig[];
  selectedId: string | null;
  customCss: string;
  onSelectElement: (id: string | null) => void;
  onUpdateElement: (id: string, updates: Partial<ElementConfig>) => void;
  canvasRef: React.MutableRefObject<HTMLDivElement | null>;
}

const Canvas: React.FC<CanvasProps> = ({
  theme,
  elements,
  selectedId,
  customCss,
  onSelectElement,
  onUpdateElement,
  canvasRef,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [dragging, setDragging] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const [resizing, setResizing] = useState<{ id: string; startX: number; startY: number; startW: number; startH: number } | null>(null);

  useEffect(() => {
    const updateScale = () => {
      const container = containerRef.current;
      if (!container) return;
      const padding = 32;
      const availW = container.clientWidth - padding;
      const availH = container.clientHeight - padding;
      const s = Math.min(availW / CANVAS_WIDTH, availH / CANVAS_HEIGHT, 1);
      setScale(s);
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  const getBgStyle = useCallback(() => {
    const bg = theme.background;
    if (bg.type === 'gradient' && bg.gradient) {
      return {
        backgroundImage: `linear-gradient(${bg.gradient.angle}deg, ${bg.gradient.from}, ${bg.gradient.to})`,
      };
    }
    return { backgroundColor: theme.secondaryColor };
  }, [theme]);

  const handleMouseDown = useCallback((e: React.MouseEvent, el: ElementConfig) => {
    e.stopPropagation();
    onSelectElement(el.id);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const ox = (e.clientX - rect.left) / scale;
    const oy = (e.clientY - rect.top) / scale;
    setDragging({ id: el.id, offsetX: ox, offsetY: oy });
  }, [onSelectElement, scale]);

  const handleResizeStart = useCallback((e: React.MouseEvent, el: ElementConfig) => {
    e.stopPropagation();
    e.preventDefault();
    setResizing({
      id: el.id,
      startX: e.clientX,
      startY: e.clientY,
      startW: el.width,
      startH: el.height,
    });
  }, []);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (dragging) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const canvasRect = canvas.getBoundingClientRect();
        const x = (e.clientX - canvasRect.left) / scale - dragging.offsetX;
        const y = (e.clientY - canvasRect.top) / scale - dragging.offsetY;
        onUpdateElement(dragging.id, {
          x: Math.max(0, Math.min(CANVAS_WIDTH - 50, x)),
          y: Math.max(0, Math.min(CANVAS_HEIGHT - 30, y)),
        });
      }
      if (resizing) {
        const dx = (e.clientX - resizing.startX) / scale;
        const dy = (e.clientY - resizing.startY) / scale;
        onUpdateElement(resizing.id, {
          width: Math.max(80, resizing.startW + dx),
          height: Math.max(30, resizing.startH + dy),
        });
      }
    };
    const handleUp = () => {
      setDragging(null);
      setResizing(null);
    };
    if (dragging || resizing) {
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragging, resizing, scale, canvasRef, onUpdateElement]);

  const bgStyle = getBgStyle();

  return (
    <>
      <style>{customCss}</style>
      <div ref={containerRef} className="w-full h-full flex items-center justify-center overflow-hidden">
        <div
          ref={canvasRef}
          data-canvas-export
          className="relative overflow-hidden shadow-2xl"
          style={{
            width: CANVAS_WIDTH,
            height: CANVAS_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: 'center center',
            ...bgStyle,
          }}
          onClick={() => onSelectElement(null)}
        >
          <div
            className="absolute inset-0 opacity-10 pointer-events-none"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='${encodeURIComponent(theme.primaryColor)}' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }}
          />
          <div
            className="absolute top-8 left-8 px-4 py-2 rounded-md text-sm font-bold tracking-widest"
            style={{
              backgroundColor: `${theme.primaryColor}22`,
              color: theme.primaryColor,
              border: `2px solid ${theme.primaryColor}`,
              fontFamily: "'Orbitron', sans-serif",
            }}
          >
            {theme.emoji} {theme.genre}
          </div>
          <div
            className="absolute bottom-8 right-8 text-xs tracking-wider opacity-60"
            style={{ color: theme.accentColor, fontFamily: "'JetBrains Mono', monospace" }}
          >
            LIVE CONCERT 2026
          </div>

          {elements.map((el) => {
            const isSelected = selectedId === el.id;
            return (
              <div
                key={el.id}
                onMouseDown={(e) => handleMouseDown(e, el)}
                className={`absolute cursor-move select-none ${dragging?.id === el.id ? '' : 'transition-all duration-300'}`}
                style={{
                  left: 0,
                  top: 0,
                  transform: `translate(${el.x}px, ${el.y}px)`,
                  width: el.width,
                  minHeight: el.height,
                  zIndex: el.zIndex,
                  willChange: 'transform',
                  padding: '4px 8px',
                  color: el.color,
                  fontSize: el.fontSize,
                  fontFamily: el.fontFamily,
                  fontWeight: el.fontWeight,
                  textAlign: el.textAlign,
                  lineHeight: 1.2,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  boxShadow: isSelected
                    ? `0 0 0 2px #00d4ff, 0 0 20px rgba(0, 212, 255, 0.6)`
                    : 'none',
                  borderRadius: isSelected ? 4 : 0,
                  transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                }}
              >
                {el.content}
                {isSelected && (
                  <div
                    onMouseDown={(e) => handleResizeStart(e, el)}
                    className="absolute -right-2 -bottom-2 w-4 h-4 bg-cyan-400 rounded-sm cursor-se-resize shadow-lg"
                    style={{ border: '1px solid #00d4ff' }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};

export default Canvas;
