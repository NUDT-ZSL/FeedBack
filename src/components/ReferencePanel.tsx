import { useRef, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, useReference } from '@/store/useStore';
import { COLORS, MURAL_DIMENSIONS } from '@/types';
import { clamp } from '@/utils/curveInterpolation';

interface Props {
  muralRect: DOMRect | null;
}

export function ReferencePanel({ muralRect }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isCollapsed, setIsCollapsed] = useState(false);
  
  const reference = useReference();
  const setReferencePosition = useStore((state) => state.setReferencePosition);
  const setReferenceOpacity = useStore((state) => state.setReferenceOpacity);
  const setReferenceSnapped = useStore((state) => state.setReferenceSnapped);
  const setReferenceDragging = useStore((state) => state.setReferenceDragging);
  const setReferencePlaced = useStore((state) => state.setReferencePlaced);

  const checkSnap = useCallback((x: number, y: number) => {
    if (!muralRect) return null;
    
    const panelWidth = 240;
    const panelHeight = 180;
    
    const targetX = muralRect.left;
    const targetY = muralRect.top;
    const targetRight = muralRect.right - panelWidth;
    const targetBottom = muralRect.bottom - panelHeight;
    
    const snapThreshold = 40;
    
    let snappedX = x;
    let snappedY = y;
    let hasSnapped = false;
    
    if (Math.abs(x - targetX) < snapThreshold) {
      snappedX = targetX;
      hasSnapped = true;
    } else if (Math.abs(x - targetRight) < snapThreshold) {
      snappedX = targetRight;
      hasSnapped = true;
    }
    
    if (Math.abs(y - targetY) < snapThreshold) {
      snappedY = targetY;
      hasSnapped = true;
    } else if (Math.abs(y - targetBottom) < snapThreshold) {
      snappedY = targetBottom;
      hasSnapped = true;
    }
    
    if (x > muralRect.left && x < muralRect.right - panelWidth &&
        y > muralRect.top && y < muralRect.bottom - panelHeight) {
      const centerX = muralRect.left + (muralRect.width - panelWidth) / 2;
      const centerY = muralRect.top + (muralRect.height - panelHeight) / 2;
      
      if (Math.abs(x - centerX) < snapThreshold && Math.abs(y - centerY) < snapThreshold) {
        snappedX = centerX;
        snappedY = centerY;
        hasSnapped = true;
      }
    }
    
    return hasSnapped ? { x: snappedX, y: snappedY } : null;
  }, [muralRect]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setReferenceDragging(true);
    
    const rect = panelRef.current?.getBoundingClientRect();
    if (rect) {
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }
  }, [setReferenceDragging]);

  const handleDragMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    
    const newX = e.clientX - dragOffset.x;
    const newY = e.clientY - dragOffset.y;
    
    const snapped = checkSnap(newX, newY);
    if (snapped) {
      setReferencePosition(snapped);
      setReferenceSnapped(true);
    } else {
      setReferencePosition({ x: newX, y: newY });
      setReferenceSnapped(false);
    }
  }, [isDragging, dragOffset, checkSnap, setReferencePosition, setReferenceSnapped]);

  const handleDragEnd = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      setReferenceDragging(false);
      setReferencePlaced(true);
    }
  }, [isDragging, setReferenceDragging, setReferencePlaced]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleDragMove);
      window.addEventListener('mouseup', handleDragEnd);
    }
    
    return () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
    };
  }, [isDragging, handleDragMove, handleDragEnd]);

  const handleOpacityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setReferenceOpacity(parseFloat(e.target.value) / 100);
  };

  const panelStyle = reference.isPlaced && muralRect ? {
    position: 'absolute' as const,
    left: reference.position.x,
    top: reference.position.y,
    width: '240px',
    height: '180px',
  } : undefined;

  return (
    <>
      <AnimatePresence>
        {!reference.isPlaced && (
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 50 }}
            transition={{ duration: 0.3 }}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-30"
          >
            <div
              className="relative cursor-move select-none"
              style={{
                width: '240px',
                padding: '12px',
                background: 'rgba(26, 26, 26, 0.9)',
                border: `2px dashed ${COLORS.INK}40`,
                borderRadius: '8px',
                backdropFilter: 'blur(8px)',
              }}
              onMouseDown={handleDragStart}
            >
              <div className="text-xs text-gray-400 mb-2 text-center">粉本 (拖拽到壁画上方)</div>
              <div 
                className="relative"
                style={{
                  width: '100%',
                  height: '140px',
                  background: `${COLORS.SILK_BG}20`,
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}
              >
                <svg
                  viewBox="0 0 240 140"
                  className="w-full h-full"
                  style={{ opacity: 0.8 }}
                >
                  <g fill="none" stroke={COLORS.INK} strokeWidth="1" strokeLinecap="round">
                    <path d="M40 60 Q60 30 80 50 Q100 70 120 50 Q140 30 160 50 Q180 70 200 60" />
                    <ellipse cx="120" cy="80" rx="25" ry="35" />
                    <path d="M80 110 Q100 130 120 120 Q140 110 160 125" />
                    {[
                      { cx: 30, cy: 25, r: 8 },
                      { cx: 210, cy: 30, r: 6 },
                      { cx: 40, cy: 115, r: 5 },
                      { cx: 200, cy: 110, r: 7 },
                    ].map((f, i) => (
                      <g key={i}>
                        <circle cx={f.cx} cy={f.cy} r={f.r * 0.4} fill={COLORS.INK} stroke="none" />
                        {[0, 1, 2, 3, 4].map((j) => {
                          const angle = (j / 5) * Math.PI * 2 - Math.PI / 2;
                          const px = f.cx + Math.cos(angle) * f.r;
                          const py = f.cy + Math.sin(angle) * f.r;
                          return <circle key={j} cx={px} cy={py} r={f.r * 0.3} />;
                        })}
                      </g>
                    ))}
                  </g>
                </svg>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {reference.isPlaced && muralRect && (
          <motion.div
            ref={panelRef}
            style={panelStyle}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ 
              opacity: 1, 
              scale: 1,
              transition: {
                type: 'spring',
                stiffness: 300,
                damping: 30,
                duration: 0.5,
              },
            }}
            className={`absolute z-30 transition-shadow duration-200 ${isDragging ? 'shadow-2xl' : ''}`}
          >
            <div
              className="relative cursor-move select-none"
              style={{
                width: '100%',
                height: '100%',
                padding: '8px',
                background: `rgba(26, 26, 26, 0.85)`,
                border: reference.isSnapped 
                  ? `2px solid ${COLORS.LAMP_GLOW}80`
                  : `1px solid ${COLORS.INK}30`,
                borderRadius: '6px',
                backdropFilter: 'blur(6px)',
                boxShadow: reference.isSnapped 
                  ? `0 0 20px ${COLORS.LAMP_GLOW}30`
                  : '0 4px 20px rgba(0,0,0,0.5)',
              }}
              onMouseDown={handleDragStart}
            >
              <button
                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-gray-800 text-gray-400 hover:text-white text-xs flex items-center justify-center transition-colors z-10"
                onClick={(e) => {
                  e.stopPropagation();
                  setReferencePlaced(false);
                }}
              >
                ×
              </button>
              
              <div 
                className="relative w-full h-full overflow-hidden"
                style={{ opacity: reference.opacity }}
              >
                <svg
                  viewBox="0 0 240 140"
                  className="w-full h-full"
                >
                  <g fill="none" stroke={COLORS.INK} strokeWidth="1.5" strokeLinecap="round">
                    <path d="M40 60 Q60 30 80 50 Q100 70 120 50 Q140 30 160 50 Q180 70 200 60" />
                    <ellipse cx="120" cy="80" rx="25" ry="35" />
                    <path d="M80 110 Q100 130 120 120 Q140 110 160 125" />
                    {[
                      { cx: 30, cy: 25, r: 8 },
                      { cx: 210, cy: 30, r: 6 },
                      { cx: 40, cy: 115, r: 5 },
                      { cx: 200, cy: 110, r: 7 },
                    ].map((f, i) => (
                      <g key={i}>
                        <circle cx={f.cx} cy={f.cy} r={f.r * 0.4} fill={COLORS.INK} stroke="none" />
                        {[0, 1, 2, 3, 4].map((j) => {
                          const angle = (j / 5) * Math.PI * 2 - Math.PI / 2;
                          const px = f.cx + Math.cos(angle) * f.r;
                          const py = f.cy + Math.sin(angle) * f.r;
                          return <circle key={j} cx={px} cy={py} r={f.r * 0.3} />;
                        })}
                      </g>
                    ))}
                  </g>
                </svg>
              </div>
              
              <div className="mt-2">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={reference.opacity * 100}
                  onChange={handleOpacityChange}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full h-1 bg-gray-700 rounded-full appearance-none cursor-pointer"
                  style={{
                    accentColor: COLORS.LAMP_GLOW,
                  }}
                />
                <div className="text-[10px] text-gray-500 text-center mt-1">
                  透明度 {Math.round(reference.opacity * 100)}%
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="md:hidden absolute right-4 top-4 z-30">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="px-3 py-2 bg-gray-800/80 rounded-lg text-gray-300 text-sm backdrop-blur-sm"
        >
          {isCollapsed ? '展开粉本' : '收起粉本'}
        </button>
        
        <AnimatePresence>
          {!isCollapsed && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2"
            >
              <div
                className="cursor-move select-none p-3"
                style={{
                  background: 'rgba(26, 26, 26, 0.95)',
                  border: `2px dashed ${COLORS.INK}40`,
                  borderRadius: '8px',
                }}
                onMouseDown={handleDragStart}
              >
                <div className="text-xs text-gray-400 mb-2 text-center">粉本</div>
                <div 
                  style={{
                    width: '200px',
                    height: '120px',
                    background: `${COLORS.SILK_BG}20`,
                    borderRadius: '4px',
                  }}
                >
                  <svg
                    viewBox="0 0 200 120"
                    className="w-full h-full"
                    style={{ opacity: 0.8 }}
                  >
                    <g fill="none" stroke={COLORS.INK} strokeWidth="1" strokeLinecap="round">
                      <path d="M30 50 Q50 25 70 42 Q90 58 100 42 Q110 25 130 42 Q150 58 170 50" />
                      <ellipse cx="100" cy="70" rx="20" ry="30" />
                    </g>
                  </svg>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
