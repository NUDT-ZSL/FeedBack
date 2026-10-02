import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../store/gameStore';
import { determinePitchResult } from '../utils/gameLogic';
import type { PitchOutcome } from '../utils/gameLogic';
import {
  playWindSound,
  playArrowSound,
  playPotHitSound,
  playEarHitSound,
  playMissSound,
  playApplause,
} from '../utils/audio';

interface ArrowItem {
  id: string;
  angle: number;
}

interface FlyingArrow {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  angle: number;
  outcome: PitchOutcome;
}

const Arrow: React.FC<{ arrow: ArrowItem }> = ({ arrow }) => {
  const pitchesRemaining = useGameStore((state) => state.pitchesRemaining);
  const gameOver = useGameStore((state) => state.gameOver);
  const isAnimating = useGameStore((state) => state.potEffect !== 'idle');

  const [{ isDragging }, drag] = useDrag(() => ({
    type: 'ARROW',
    item: { id: arrow.id, angle: arrow.angle },
    canDrag: pitchesRemaining > 0 && !gameOver && !isAnimating,
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }), [pitchesRemaining, gameOver, isAnimating]);

  return (
    <motion.div
      ref={drag}
      className="arrow"
      style={{
        transform: `rotate(${arrow.angle}deg)`,
        opacity: isDragging ? 0 : 1,
      }}
      whileHover={pitchesRemaining > 0 && !gameOver && !isAnimating ? { scale: 1.05 } : {}}
      animate={{
        opacity: pitchesRemaining > 0 ? 1 : 0.3,
      }}
    >
      <div className="arrow-tip" />
      <div className="arrow-feather" />
    </motion.div>
  );
};

const PitchArea: React.FC = () => {
  const potRef = useRef<HTMLDivElement>(null);
  const hallRef = useRef<HTMLDivElement>(null);
  const {
    recordPitch,
    potEffect,
    setPotEffect,
    setNpcReaction,
    showSigh,
    setShowSigh,
    pitchesRemaining,
  } = useGameStore();

  const [flyingArrows, setFlyingArrows] = useState<FlyingArrow[]>([]);
  const [availableArrows] = useState<ArrowItem[]>(() =>
    Array.from({ length: 3 }, (_, i) => ({
      id: `arrow-${i}`,
      angle: (i - 1) * 8,
    }))
  );

  const handlePitchComplete = useCallback(
    (arrow: ArrowItem, dropX: number, dropY: number) => {
      if (!potRef.current || !hallRef.current) return;

      const potRect = potRef.current.getBoundingClientRect();
      const hallRect = hallRef.current.getBoundingClientRect();

      const potLocalX = dropX - potRect.left + window.scrollX;
      const potLocalY = dropY - potRect.top + window.scrollY;

      const outcome = determinePitchResult(potLocalX, potLocalY);

      const arrowStartX = hallRect.width - 120;
      const arrowStartY = hallRect.height - 80;
      const arrowEndX = dropX - hallRect.left - 60;
      const arrowEndY = dropY - hallRect.top - 3;

      playWindSound();
      setTimeout(() => playArrowSound(), 100);

      const flyingArrow: FlyingArrow = {
        id: `flying-${Date.now()}`,
        startX: arrowStartX,
        startY: arrowStartY,
        endX: arrowEndX,
        endY: arrowEndY,
        angle: arrow.angle,
        outcome,
      };

      setFlyingArrows((prev) => [...prev, flyingArrow]);
    },
    []
  );

  const handleArrowAnimationComplete = useCallback(
    (arrowId: string) => {
      const arrow = flyingArrows.find((a) => a.id === arrowId);
      if (!arrow) return;

      const { outcome } = arrow;

      setTimeout(() => {
        if (outcome.result === 'hit') {
          playPotHitSound();
          setTimeout(() => playApplause(), 200);
          setPotEffect('hit');
          setNpcReaction('cheer');
        } else if (outcome.result === 'ear') {
          playEarHitSound();
          setTimeout(() => playApplause(), 200);
          setPotEffect('ear');
          setNpcReaction('cheer');
        } else {
          playMissSound();
          setNpcReaction('disappoint');
          setShowSigh(true);
          setTimeout(() => setShowSigh(false), 1500);
        }

        recordPitch({
          result: outcome.result,
          score: outcome.score,
          label: outcome.label,
        });

        setTimeout(() => {
          setPotEffect('idle');
          setNpcReaction('idle');
        }, 600);

        setFlyingArrows((prev) => prev.filter((a) => a.id !== arrowId));
      }, 100);
    },
    [flyingArrows, recordPitch, setPotEffect, setNpcReaction, setShowSigh]
  );

  const [{ isOver }, drop] = useDrop(() => ({
    accept: 'ARROW',
    drop: (item: ArrowItem, monitor) => {
      const offset = monitor.getClientOffset();
      if (offset) {
        handlePitchComplete(item, offset.x, offset.y);
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
    }),
  }), [handlePitchComplete]);

  useEffect(() => {
    let frameId: number;
    let lastTime = 0;

    const checkFPS = (time: number) => {
      if (lastTime !== 0) {
        const delta = time - lastTime;
        if (delta < 22) {
        }
      }
      lastTime = time;
      frameId = requestAnimationFrame(checkFPS);
    };

    if (flyingArrows.length > 0) {
      frameId = requestAnimationFrame(checkFPS);
    }

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [flyingArrows.length]);

  return (
    <div className="banquet-hall" ref={hallRef}>
      <div className="hall-floor" />

      <div className="lamp lamp-left">
        <div className="lamp-pole" />
        <div className="lamp-branches">
          <div className="lamp-cup">
            <div className="lamp-flame" />
          </div>
        </div>
      </div>

      <div className="lamp lamp-right">
        <div className="lamp-pole" />
        <div className="lamp-branches">
          <div className="lamp-cup">
            <div className="lamp-flame" />
          </div>
        </div>
      </div>

      <div className="red-mat">
        <div className="wine-vessel" />
        <div className="wine-vessel" />
        <div className="wine-vessel" />
      </div>

      <div
        ref={(node) => {
          if (node) {
            (potRef as React.MutableRefObject<HTMLDivElement>).current = node;
            drop(node);
          }
        }}
        className="pitch-pot"
      >
        <div className={`pot-glow ${potEffect === 'hit' ? 'active' : ''}`} />
        <div className={`pot-body ${potEffect === 'hit' ? 'pot-shake' : ''}`} />
        <div className="pot-mouth" />
        <div
          className={`pot-ear pot-ear-left ${potEffect === 'ear' ? 'ear-swing' : ''}`}
        />
        <div
          className={`pot-ear pot-ear-right ${potEffect === 'ear' ? 'ear-swing' : ''}`}
        />
      </div>

      <div
        className="pitch-zone"
        style={{
          borderColor: isOver
            ? 'rgba(255, 215, 0, 0.8)'
            : 'rgba(255, 215, 0, 0.3)',
          background: isOver ? 'rgba(255, 215, 0, 0.1)' : 'transparent',
        }}
      >
        {pitchesRemaining > 0 ? '瞄准此处投掷' : '游戏结束'}
      </div>

      <div className="arrow-table">
        {availableArrows.map((arrow) => (
          <Arrow key={arrow.id} arrow={arrow} />
        ))}
      </div>

      <AnimatePresence>
        {flyingArrows.map((arrow) => (
          <motion.div
            key={arrow.id}
            className="arrow-flying arrow"
            initial={{
              x: arrow.startX,
              y: arrow.startY,
              rotate: arrow.angle,
              opacity: 1,
            }}
            animate={{
              x: arrow.endX,
              y: arrow.endY,
              rotate: arrow.angle + 45,
            }}
            transition={{
              duration: 0.6,
              ease: [0.25, 0.46, 0.45, 0.94],
              times: [0, 0.5, 1],
            }}
            onAnimationComplete={() => handleArrowAnimationComplete(arrow.id)}
            style={{ zIndex: 100 }}
          >
            <div className="arrow-tip" />
            <div className="arrow-feather" />
          </motion.div>
        ))}
      </AnimatePresence>

      <AnimatePresence>
        {showSigh && (
          <motion.div
            className="sigh-bubble"
            initial={{ opacity: 0, y: 0, scale: 0.5 }}
            animate={{ opacity: 1, y: -60, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.5 }}
            style={{
              left: '50%',
              bottom: '120px',
              transform: 'translateX(-50%)',
            }}
          >
            哎呀~
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default PitchArea;
