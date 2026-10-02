import React, { useRef, useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useGrindingStore } from '@/store/useGrindingStore';
import { GritType, GRIT_COLORS } from '@/types';
import {
  initAudio,
  startGrindingSound,
  updateGrindingSound,
  stopGrindingSound,
  playScratchSound,
  playDamageWarning,
} from '@/utils/audio';

interface GrindingStoneProps {
  grit: GritType;
  label: string;
  initialX: number;
  initialY: number;
  mirrorRef: React.RefObject<HTMLDivElement | null>;
}

const GrindingStone: React.FC<GrindingStoneProps> = ({ grit, label, initialX, initialY, mirrorRef }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isOnMirror, setIsOnMirror] = useState(false);
  const [position, setPosition] = useState({ x: initialX, y: initialY });
  const [showLabel, setShowLabel] = useState(false);
  const lastPosition = useRef({ x: 0, y: 0 });
  const lastTime = useRef(0);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const wasDamaged = useRef(false);

  const {
    startGrinding,
    updateGrinding,
    stopGrinding,
    addScratch,
    currentGrit,
    isDamaged,
  } = useGrindingStore();

  useEffect(() => {
    if (isDamaged && !wasDamaged.current) {
      playDamageWarning();
      wasDamaged.current = true;
    } else if (!isDamaged) {
      wasDamaged.current = false;
    }
  }, [isDamaged]);

  const calculateForce = useCallback((clientX: number, clientY: number) => {
    const now = performance.now();
    const dt = now - lastTime.current;
    if (dt === 0) return 0.5;

    const dx = clientX - lastPosition.current.x;
    const dy = clientY - lastPosition.current.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const speed = distance / dt;

    lastPosition.current = { x: clientX, y: clientY };
    lastTime.current = now;

    return Math.min(2, speed / 2);
  }, []);

  const calculateDirection = useCallback((clientX: number, clientY: number) => {
    if (!mirrorRef.current) return 0;
    const rect = mirrorRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const angle = Math.atan2(clientY - centerY, clientX - centerX) * (180 / Math.PI);
    return (angle + 360) % 360;
  }, [mirrorRef]);

  const checkMirrorCollision = useCallback((clientX: number, clientY: number) => {
    if (!mirrorRef.current) return false;
    const rect = mirrorRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = rect.width / 2;
    const distance = Math.sqrt(
      Math.pow(clientX - centerX, 2) + Math.pow(clientY - centerY, 2)
    );
    return distance <= radius + 10;
  }, [mirrorRef]);

  const createScratch = useCallback((clientX: number, clientY: number) => {
    if (!mirrorRef.current) return;
    const rect = mirrorRef.current.getBoundingClientRect();
    
    const angle = Math.random() * Math.PI * 2;
    const length = 0.05 + Math.random() * 0.1;
    
    const x1 = (clientX - rect.left) / rect.width;
    const y1 = (clientY - rect.top) / rect.height;
    const x2 = x1 + Math.cos(angle) * length;
    const y2 = y1 + Math.sin(angle) * length;

    addScratch({
      x1: Math.max(0, Math.min(1, x1)),
      y1: Math.max(0, Math.min(1, y1)),
      x2: Math.max(0, Math.min(1, x2)),
      y2: Math.max(0, Math.min(1, y2)),
      opacity: 0.6 + Math.random() * 0.3,
    });

    playScratchSound();
  }, [mirrorRef, addScratch]);

  const handleDragStart = useCallback(async (e: React.MouseEvent | React.TouchEvent) => {
    await initAudio();
    setIsDragging(true);

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    dragStartPos.current = { x: clientX - position.x, y: clientY - position.y };
    lastPosition.current = { x: clientX, y: clientY };
    lastTime.current = performance.now();

    startGrinding(grit);
  }, [position, grit, startGrinding]);

  const handleDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!isDragging) return;

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const newX = clientX - dragStartPos.current.x;
    const newY = clientY - dragStartPos.current.y;
    setPosition({ x: newX, y: newY });

    const onMirror = checkMirrorCollision(clientX, clientY);
    if (onMirror && !isOnMirror) {
      setIsOnMirror(true);
      startGrindingSound(0.5);
    } else if (!onMirror && isOnMirror) {
      setIsOnMirror(false);
      stopGrindingSound();
    }

    if (onMirror) {
      const force = calculateForce(clientX, clientY);
      const direction = calculateDirection(clientX, clientY);
      updateGrinding(force, direction);
      updateGrindingSound(force);

      if (currentGrit === 120 && force > 1.5) {
        const scratchChance = (force - 1.5) * 0.3;
        if (Math.random() < scratchChance) {
          createScratch(clientX, clientY);
        }
      }
    }
  }, [isDragging, isOnMirror, checkMirrorCollision, calculateForce, calculateDirection, updateGrinding, currentGrit, createScratch]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    setIsOnMirror(false);
    setPosition({ x: initialX, y: initialY });
    stopGrindingSound();
    stopGrinding();
  }, [initialX, initialY, stopGrinding]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleDragMove);
      window.addEventListener('mouseup', handleDragEnd);
      window.addEventListener('touchmove', handleDragMove, { passive: false });
      window.addEventListener('touchend', handleDragEnd);
    }

    return () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
      window.removeEventListener('touchmove', handleDragMove);
      window.removeEventListener('touchend', handleDragEnd);
    };
  }, [isDragging, handleDragMove, handleDragEnd]);

  const stoneColor = GRIT_COLORS[grit];

  return (
    <motion.div
      className="absolute cursor-grab active:cursor-grabbing z-20"
      style={{
        left: position.x,
        top: position.y,
        x: isDragging ? 0 : undefined,
        y: isDragging ? 0 : undefined,
      }}
      animate={{
        scale: isDragging ? 1.1 : 1,
        rotate: isDragging ? [0, -3, 3, 0] : 0,
      }}
      transition={{
        scale: { duration: 0.2 },
        rotate: { duration: 0.3, repeat: isDragging ? Infinity : 0 },
      }}
      onMouseDown={handleDragStart}
      onTouchStart={handleDragStart}
      onMouseEnter={() => setShowLabel(true)}
      onMouseLeave={() => setShowLabel(false)}
    >
      <motion.div
        className="relative rounded-lg flex items-center justify-center"
        style={{
          width: 50,
          height: 30,
          background: `linear-gradient(145deg, ${stoneColor} 0%, ${adjustColor(stoneColor, -20)} 100%)`,
          boxShadow: isDragging
            ? '0 8px 25px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.2)'
            : '0 4px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.2)',
          transition: 'box-shadow 0.2s ease',
        }}
        whileHover={{
          scale: 1.05,
          boxShadow: '0 6px 20px rgba(184, 115, 51, 0.4), inset 0 1px 0 rgba(255,255,255,0.3)',
        }}
        transition={{ duration: 0.2 }}
      >
        <div
          className="absolute inset-0 rounded-lg opacity-30"
          style={{
            background: `repeating-linear-gradient(
              90deg,
              transparent,
              transparent 2px,
              rgba(0,0,0,0.1) 2px,
              rgba(0,0,0,0.1) 4px
            )`,
          }}
        />
        <span className="text-white text-xs font-bold drop-shadow-lg z-10">
          {grit}#
        </span>

        {showLabel && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute -top-8 left-1/2 transform -translate-x-1/2 whitespace-nowrap"
          >
            <div className="bg-amber-900 text-amber-100 px-3 py-1 rounded text-sm font-medium shadow-lg">
              {label}
            </div>
            <div
              className="w-2 h-2 bg-amber-900 transform rotate-45 mx-auto -mt-1"
            />
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
};

function adjustColor(color: string, amount: number): string {
  const num = parseInt(color.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + amount));
  const b = Math.min(255, Math.max(0, (num & 0x0000ff) + amount));
  return `#${(0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1)}`;
}

export default GrindingStone;
