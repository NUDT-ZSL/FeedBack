import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store';

interface GrindTrail {
  id: number;
  x: number;
  y: number;
  angle: number;
  createdAt: number;
}

const Mortar = () => {
  const grindLevel = useStore(state => state.grindLevel);
  const setGrind = useStore(state => state.setGrind);
  const currentRecipe = useStore(state => state.currentRecipe);
  const hasIncense = useStore(state => state.hasIncense);
  const createIncense = useStore(state => state.createIncense);
  const placeIncenseOnCenser = useStore(state => state.placeIncenseOnCenser);
  const incenseColor = useStore(state => state.incenseColor);
  const incenseOnCenser = useStore(state => state.incenseOnCenser);

  const mortarRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pestlePos, setPestlePos] = useState({ x: 80, y: 80 });
  const [pestleAngle, setPestleAngle] = useState(0);
  const [trails, setTrails] = useState<GrindTrail[]>([]);
  const [isDraggingIncense, setIsDraggingIncense] = useState(false);
  const trailIdRef = useRef(0);
  const lastMoveTime = useRef(0);
  const centerRef = useRef({ x: 80, y: 80 });

  const mortarSize = 160;
  const mortarRadius = mortarSize / 2;
  const canGrind = currentRecipe.length > 0 && !hasIncense;

  const updateCenter = useCallback(() => {
    if (mortarRef.current) {
      const rect = mortarRef.current.getBoundingClientRect();
      centerRef.current = { x: rect.width / 2, y: rect.height / 2 };
    }
  }, []);

  useEffect(() => {
    updateCenter();
    window.addEventListener('resize', updateCenter);
    return () => window.removeEventListener('resize', updateCenter);
  }, [updateCenter]);

  const addTrail = useCallback((x: number, y: number, angle: number) => {
    const id = trailIdRef.current++;
    setTrails(prev => [...prev, { id, x, y, angle, createdAt: Date.now() }]);
    setTimeout(() => {
      setTrails(prev => prev.filter(t => t.id !== id));
    }, 2000);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!canGrind) return;
    e.preventDefault();
    setIsDragging(true);
    updateCenter();
  }, [canGrind, updateCenter]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !mortarRef.current) return;

    const now = Date.now();
    if (now - lastMoveTime.current < 8) return;
    lastMoveTime.current = now;

    const rect = mortarRef.current.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;

    const center = centerRef.current;
    const dx = x - center.x;
    const dy = y - center.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const maxDistance = mortarRadius - 25;

    if (distance > maxDistance) {
      const ratio = maxDistance / distance;
      x = center.x + dx * ratio;
      y = center.y + dy * ratio;
    }

    const angle = Math.atan2(y - center.y, x - center.x) * (180 / Math.PI);
    setPestlePos({ x, y });
    setPestleAngle(angle);
    addTrail(x, y, angle);

    if (distance > 20) {
      const incrementalGrind = 0.15;
      setGrind(Math.min(100, grindLevel + incrementalGrind));
    }
  }, [isDragging, grindLevel, setGrind, addTrail, mortarRadius]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleIncenseDragStart = (e: React.DragEvent) => {
    if (hasIncense && !incenseOnCenser) {
      setIsDraggingIncense(true);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('incense', 'true');
    }
  };

  const handleIncenseDragEnd = () => {
    setIsDraggingIncense(false);
  };

  const handleDragOverCenser = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDropOnCenser = (e: React.DragEvent) => {
    e.preventDefault();
    const data = e.dataTransfer.getData('incense');
    if (data === 'true' && hasIncense && !incenseOnCenser) {
      placeIncenseOnCenser();
    }
  };

  const canCreateIncense = grindLevel >= 100 && currentRecipe.length > 0 && !hasIncense;

  const renderGrindRing = () => {
    const circumference = 2 * Math.PI * (mortarRadius - 30);
    const offset = circumference - (grindLevel / 100) * circumference;

    return (
      <svg
        className="absolute inset-0 pointer-events-none"
        width={mortarSize}
        height={mortarSize}
        style={{ transform: 'rotate(-90deg)' }}
      >
        <defs>
          <linearGradient id="grindGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#4a2e1b" />
            <stop offset="100%" stopColor="#d4a017" />
          </linearGradient>
        </defs>
        <circle
          cx={mortarRadius}
          cy={mortarRadius}
          r={mortarRadius - 30}
          fill="none"
          stroke="rgba(0,0,0,0.3)"
          strokeWidth="6"
        />
        <circle
          cx={mortarRadius}
          cy={mortarRadius}
          r={mortarRadius - 30}
          fill="none"
          stroke="url(#grindGradient)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.1s ease' }}
        />
      </svg>
    );
  };

  return (
    <div className="flex flex-col items-center gap-6">
      <h2 className="text-xl font-bold" style={{ color: '#d4a017', textShadow: '1px 1px 2px rgba(0,0,0,0.5)' }}>
        铜质乳钵
      </h2>

      <div
        ref={mortarRef}
        className={`relative select-none ${canGrind ? 'cursor-grab' : 'cursor-default'}`}
        style={{
          width: mortarSize,
          height: mortarSize,
          perspective: '500px',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onDragOver={handleDragOverCenser}
        onDrop={handleDropOnCenser}
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: 'linear-gradient(145deg, #6b8e6b 0%, #5a7a5a 30%, #8b5e3a 70%, #6b4a2a 100%)',
            boxShadow: 'inset 0 8px 20px rgba(0,0,0,0.4), inset 0 -4px 12px rgba(212,160,23,0.2), 0 8px 24px rgba(0,0,0,0.5)',
            border: '3px solid rgba(212,160,23,0.3)',
            transform: 'rotateX(15deg)',
          }}
        >
          <div
            className="absolute rounded-full"
            style={{
              top: 20,
              left: 20,
              right: 20,
              bottom: 20,
              background: 'radial-gradient(circle, #3a3a3a 0%, #2a2a2a 100%)',
              boxShadow: 'inset 0 4px 12px rgba(0,0,0,0.8)',
            }}
          >
            {currentRecipe.length > 0 && !hasIncense && (
              <div className="absolute inset-4 rounded-full overflow-hidden">
                {currentRecipe.map((item, index) => (
                  <motion.div
                    key={item.name}
                    className="absolute inset-0 rounded-full"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.6 }}
                    transition={{ delay: index * 0.1 }}
                    style={{
                      background: `radial-gradient(circle at ${30 + index * 20}% ${30 + index * 20}%, ${item.color}88 0%, transparent 60%)`,
                      mixBlendMode: 'screen',
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {canGrind && renderGrindRing()}

        {trails.map(trail => {
          const age = Date.now() - trail.createdAt;
          const opacity = Math.max(0, 0.3 - (age / 2000) * 0.3);
          return (
            <motion.div
              key={trail.id}
              className="absolute rounded-full pointer-events-none"
              initial={{ opacity: 0.3, scale: 0.8 }}
              animate={{ opacity, scale: 1.2 }}
              transition={{ duration: 2 }}
              style={{
                left: trail.x - 15,
                top: trail.y - 8,
                width: 30,
                height: 16,
                background: 'rgba(212,160,23,0.3)',
                transform: `rotate(${trail.angle}deg)`,
                filter: 'blur(4px)',
              }}
            />
          );
        })}

        {canGrind && (
          <motion.div
            className="absolute pointer-events-none"
            style={{
              left: pestlePos.x - 4,
              top: pestlePos.y - 30,
              transformOrigin: 'center bottom',
              transform: `rotate(${pestleAngle + 90}deg)`,
              zIndex: 10,
            }}
            animate={{
              y: isDragging ? [0, -2, 0] : 0,
            }}
            transition={{
              duration: 0.2,
              repeat: isDragging ? Infinity : 0,
            }}
          >
            <div
              className="relative"
              style={{
                width: 8,
                height: 50,
                background: 'linear-gradient(180deg, #b0b0b0 0%, #808080 50%, #606060 100%)',
                borderRadius: '4px',
                boxShadow: '2px 0 4px rgba(0,0,0,0.3)',
              }}
            >
              <div
                className="absolute -bottom-2 left-1/2 -translate-x-1/2"
                style={{
                  width: 20,
                  height: 12,
                  background: 'linear-gradient(180deg, #8b5e3a 0%, #6b4e2a 100%)',
                  borderRadius: '50%',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
                }}
              />
            </div>
            <div
              className="absolute top-0 left-1/2 -translate-x-1/2"
              style={{
                width: 8,
                height: 20,
                background: 'linear-gradient(180deg, rgba(180,180,180,0.4) 0%, transparent 100%)',
                borderRadius: '4px',
                filter: 'blur(2px)',
                opacity: 0.4,
              }}
            />
          </motion.div>
        )}

        <AnimatePresence>
          {hasIncense && !incenseOnCenser && (
            <motion.div
              draggable
              onDragStart={handleIncenseDragStart}
              onDragEnd={handleIncenseDragEnd}
              className="absolute cursor-grab z-20"
              initial={{ opacity: 0, scale: 0, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 20 }}
              style={{
                left: mortarRadius - 20,
                top: mortarRadius - 30,
                boxShadow: isDraggingIncense ? '0 4px 12px rgba(0,0,0,0.4)' : 'none',
              }}
            >
              <div
                style={{
                  width: 0,
                  height: 0,
                  borderLeft: '20px solid transparent',
                  borderRight: '20px solid transparent',
                  borderBottom: `60px solid ${incenseColor}`,
                  filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.4))',
                }}
              />
              <div
                className="absolute bottom-0 left-1/2 -translate-x-1/2"
                style={{
                  width: 40,
                  height: 6,
                  background: `linear-gradient(90deg, ${incenseColor}88, ${incenseColor}, ${incenseColor}88)`,
                  borderRadius: '50%',
                  filter: 'blur(1px)',
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs whitespace-nowrap" style={{ color: '#d4a017' }}>
          研磨进度: {Math.round(grindLevel)}%
        </div>
      </div>

      <motion.button
        onClick={createIncense}
        disabled={!canCreateIncense}
        className="px-8 py-3 rounded-lg font-bold text-lg transition-all"
        whileHover={canCreateIncense ? { scale: 1.05 } : {}}
        whileTap={canCreateIncense ? { scale: 0.95 } : {}}
        style={{
          background: canCreateIncense
            ? 'linear-gradient(135deg, #d4a017 0%, #b8860b 100%)'
            : 'linear-gradient(135deg, #5a5a5a 0%, #3a3a3a 100%)',
          color: canCreateIncense ? '#3a2a1a' : '#8a8a8a',
          border: `2px solid ${canCreateIncense ? '#d4a017' : '#5a5a5a'}`,
          boxShadow: canCreateIncense ? '0 4px 12px rgba(212,160,23,0.4)' : 'none',
          cursor: canCreateIncense ? 'pointer' : 'not-allowed',
        }}
      >
        合香
      </motion.button>
    </div>
  );
};

export default Mortar;
