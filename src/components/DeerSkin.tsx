import React, { useRef, useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useGrindingStore } from '@/store/useGrindingStore';
import {
  initAudio,
  startPolishingSound,
  updatePolishingSound,
  stopPolishingSound,
} from '@/utils/audio';

interface DeerSkinProps {
  mirrorRef: React.RefObject<HTMLDivElement | null>;
  initialX: number;
  initialY: number;
}

const DeerSkin: React.FC<DeerSkinProps> = ({ mirrorRef, initialX, initialY }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isOnMirror, setIsOnMirror] = useState(false);
  const [position, setPosition] = useState({ x: initialX, y: initialY });
  const lastPosition = useRef({ x: 0, y: 0 });
  const lastTime = useRef(0);
  const dragStartPos = useRef({ x: 0, y: 0 });

  const { startPolishing, updatePolishing, stopPolishing, fixScratch } = useGrindingStore();

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

  const checkMirrorCollision = useCallback((clientX: number, clientY: number) => {
    if (!mirrorRef.current) return false;
    const rect = mirrorRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = rect.width / 2;
    const distance = Math.sqrt(
      Math.pow(clientX - centerX, 2) + Math.pow(clientY - centerY, 2)
    );
    return distance <= radius + 15;
  }, [mirrorRef]);

  const handleDragStart = useCallback(async (e: React.MouseEvent | React.TouchEvent) => {
    await initAudio();
    setIsDragging(true);

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    dragStartPos.current = { x: clientX - position.x, y: clientY - position.y };
    lastPosition.current = { x: clientX, y: clientY };
    lastTime.current = performance.now();

    startPolishing();
  }, [position, startPolishing]);

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
      startPolishingSound();
    } else if (!onMirror && isOnMirror) {
      setIsOnMirror(false);
      stopPolishingSound();
    }

    if (onMirror) {
      const force = calculateForce(clientX, clientY);
      updatePolishing(force);
      updatePolishingSound(force);

      const fixChance = 0.05 * force;
      if (Math.random() < fixChance) {
        fixScratch();
      }
    }
  }, [isDragging, isOnMirror, checkMirrorCollision, calculateForce, updatePolishing, fixScratch]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    setIsOnMirror(false);
    setPosition({ x: initialX, y: initialY });
    stopPolishingSound();
    stopPolishing();
  }, [initialX, initialY, stopPolishing]);

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

  return (
    <motion.div
      className="absolute cursor-grab active:cursor-grabbing z-20"
      style={{
        left: position.x,
        top: position.y,
      }}
      animate={{
        scale: isDragging ? 1.1 : 1,
        rotate: isDragging ? [0, 5, -5, 0] : 0,
      }}
      transition={{
        scale: { duration: 0.2 },
        rotate: { duration: 0.4, repeat: isDragging ? Infinity : 0 },
      }}
      onMouseDown={handleDragStart}
      onTouchStart={handleDragStart}
    >
      <motion.div
        className="relative rounded-full"
        style={{
          width: 60,
          height: 60,
          background: `
            radial-gradient(ellipse at 30% 30%, rgba(255,248,220,0.8) 0%, transparent 50%),
            linear-gradient(135deg, rgba(232,216,184,0.9) 0%, rgba(210,180,140,0.9) 100%)
          `,
          boxShadow: isDragging
            ? '0 8px 25px rgba(0,0,0,0.3), inset 0 2px 10px rgba(255,255,255,0.5)'
            : '0 4px 15px rgba(0,0,0,0.2), inset 0 2px 10px rgba(255,255,255,0.3)',
          border: '2px solid rgba(139, 69, 19, 0.3)',
          transition: 'box-shadow 0.2s ease',
        }}
        whileHover={{
          scale: 1.05,
          boxShadow: '0 6px 20px rgba(184, 115, 51, 0.3), inset 0 2px 10px rgba(255,255,255,0.5)',
        }}
        transition={{ duration: 0.2 }}
      >
        <div
          className="absolute inset-1 rounded-full opacity-40"
          style={{
            background: `
              repeating-radial-gradient(
                circle at 50% 50%,
                transparent,
                transparent 3px,
                rgba(139, 69, 19, 0.1) 3px,
                rgba(139, 69, 19, 0.1) 6px
              )
            `,
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-amber-800 text-xs font-medium drop-shadow">鹿皮</span>
        </div>

        {isOnMirror && (
          <motion.div
            className="absolute inset-0 rounded-full pointer-events-none"
            animate={{
              background: [
                'radial-gradient(circle, rgba(255,215,0,0) 0%, transparent 60%)',
                'radial-gradient(circle, rgba(255,215,0,0.3) 0%, transparent 60%)',
                'radial-gradient(circle, rgba(255,215,0,0) 0%, transparent 60%)',
              ],
            }}
            transition={{
              duration: 1,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        )}
      </motion.div>
    </motion.div>
  );
};

export default DeerSkin;
