import { useRef, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, useDrawingLayers, useSelectedColor } from '@/store/useStore';
import { generateQuadraticBezierPath, pointToSvgCoord, generateId, lerp } from '@/utils/curveInterpolation';
import type { Point, DrawingPath } from '@/types';
import { COLORS } from '@/types';

interface Props {
  muralRect: DOMRect | null;
}

export function DrawCanvas({ muralRect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [animatingFills, setAnimatingFills] = useState<Map<string, number>>(new Map());
  
  const drawingLayers = useDrawingLayers();
  const selectedColor = useSelectedColor();
  const addDrawingLayer = useStore((state) => state.addDrawingLayer);
  const updateDrawingLayer = useStore((state) => state.updateDrawingLayer);

  const isInDamagedArea = useCallback((x: number, y: number) => {
    if (!muralRect) return false;
    const relX = (x - muralRect.left) / muralRect.width;
    const relY = (y - muralRect.top) / muralRect.height;
    return relX > 0.3 && relX < 0.7 && relY > 0.2 && relY < 0.8;
  }, [muralRect]);

  const handleMouseDown = useCallback((e: React.MouseEvent<SVGElement>) => {
    if (e.button !== 0) return;
    if (!svgRef.current) return;
    
    const rect = svgRef.current.getBoundingClientRect();
    const point = pointToSvgCoord(e.clientX, e.clientY, rect);
    
    if (!isInDamagedArea(e.clientX, e.clientY)) return;
    
    if (selectedColor === COLORS.OCHER) {
      setIsDrawing(true);
      setCurrentPoints([point]);
      setCurrentPath(`M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`);
    }
  }, [selectedColor, isInDamagedArea]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGElement>) => {
    if (!isDrawing || !svgRef.current) return;
    
    const rect = svgRef.current.getBoundingClientRect();
    const point = pointToSvgCoord(e.clientX, e.clientY, rect);
    
    setCurrentPoints((prev) => {
      const newPoints = [...prev, point];
      if (newPoints.length >= 2) {
        const path = generateQuadraticBezierPath(newPoints);
        setCurrentPath(path);
      }
      return newPoints;
    });
  }, [isDrawing]);

  const handleMouseUp = useCallback(() => {
    if (isDrawing && currentPoints.length >= 2) {
      const path = generateQuadraticBezierPath(currentPoints);
      const newLayer: DrawingPath = {
        id: generateId(),
        type: 'stroke',
        path,
        color: COLORS.OCHER,
        timestamp: Date.now(),
      };
      addDrawingLayer(newLayer);
    }
    
    setIsDrawing(false);
    setCurrentPoints([]);
    setCurrentPath('');
  }, [isDrawing, currentPoints, addDrawingLayer]);

  const handleClick = useCallback((e: React.MouseEvent<SVGElement>) => {
    if (isDrawing) return;
    if (!svgRef.current) return;
    if (selectedColor === COLORS.OCHER) return;
    if (!isInDamagedArea(e.clientX, e.clientY)) return;
    
    const rect = svgRef.current.getBoundingClientRect();
    const point = pointToSvgCoord(e.clientX, e.clientY, rect);
    
    const newLayer: DrawingPath = {
      id: generateId(),
      type: 'fill',
      path: '',
      color: selectedColor,
      timestamp: Date.now(),
      cx: point.x,
      cy: point.y,
      r: 10,
      progress: 0,
    };
    
    addDrawingLayer(newLayer);
    setAnimatingFills((prev) => new Map(prev).set(newLayer.id, 0));
    
    let startTime: number | null = null;
    const duration = 300;
    
    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      
      updateDrawingLayer(newLayer.id, {
        progress: easedProgress,
        r: lerp(0, 10, easedProgress),
      });
      
      setAnimatingFills((prev) => {
        const next = new Map(prev);
        next.set(newLayer.id, easedProgress);
        return next;
      });
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setAnimatingFills((prev) => {
          const next = new Map(prev);
          next.delete(newLayer.id);
          return next;
        });
      }
    };
    
    requestAnimationFrame(animate);
  }, [isDrawing, selectedColor, isInDamagedArea, addDrawingLayer, updateDrawingLayer]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        useStore.getState().undoDrawing();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 pointer-events-none z-20"
      style={{ pointerEvents: muralRect ? 'auto' : 'none' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={handleClick}
    >
      {drawingLayers.map((layer) => {
        if (layer.type === 'stroke') {
          return (
            <path
              key={layer.id}
              d={layer.path}
              fill="none"
              stroke={layer.color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        } else if (layer.type === 'fill') {
          const r = layer.r || 0;
          const progress = layer.progress ?? 1;
          return (
            <motion.circle
              key={layer.id}
              cx={layer.cx}
              cy={layer.cy}
              r={r}
              fill={layer.color}
              initial={{ opacity: 0, scale: 0 }}
              animate={{ 
                opacity: progress, 
                scale: progress,
              }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            />
          );
        }
        return null;
      })}
      
      {currentPath && (
        <path
          d={currentPath}
          fill="none"
          stroke={COLORS.OCHER}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.8"
        />
      )}
    </svg>
  );
}
