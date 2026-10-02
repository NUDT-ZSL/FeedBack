import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '@/store/gameStore';
import type { Score } from '@/types';

interface ScoreBarProps {
  label: string;
  value: number;
  maxValue?: number;
  delay?: number;
}

const ScoreBar: React.FC<ScoreBarProps> = ({ label, value, maxValue = 100, delay = 0 }) => {
  const [displayValue, setDisplayValue] = useState(0);
  
  useEffect(() => {
    if (value === 0) {
      setDisplayValue(0);
      return;
    }
    
    const timer = setTimeout(() => {
      const duration = 1000;
      const startTime = performance.now();
      
      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(1, elapsed / duration);
        const easeProgress = 1 - Math.pow(1 - progress, 3);
        setDisplayValue(Math.round(value * easeProgress));
        
        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      };
      
      requestAnimationFrame(animate);
    }, delay);
    
    return () => clearTimeout(timer);
  }, [value, delay]);
  
  const percentage = (displayValue / maxValue) * 100;
  
  return (
    <div className="mb-3">
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs font-kai text-amber-900">{label}</span>
        <span className="text-sm font-bold text-amber-800">{displayValue}</span>
      </div>
      <div className="h-3 bg-amber-900/20 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{
            background: `linear-gradient(90deg, var(--color-score-gold) 0%, var(--color-score-red) 100%)`,
          }}
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 1, delay: delay / 1000, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
};

interface ScorePanelProps {
  side: 'left' | 'right';
  title: string;
  score: Score;
  isActive?: boolean;
}

export const ScorePanel: React.FC<ScorePanelProps> = ({ side, title, score, isActive = false }) => {
  const phase = useGameStore(state => state.phase);
  const shouldAnimate = phase === 'scoring' || phase === 'pattern_showing';
  
  return (
    <motion.div
      className={`absolute top-1/2 -translate-y-1/2 w-48 p-4 rounded-xl backdrop-blur-sm ${
        side === 'left' ? 'left-4' : 'right-4'
      } ${isActive ? 'bg-amber-100/90 ring-2 ring-amber-500' : 'bg-amber-50/70'}`}
      style={{
        boxShadow: '0 4px 20px rgba(42, 26, 14, 0.2)',
      }}
      initial={{ opacity: 0, x: side === 'left' ? -20 : 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="text-center mb-4">
        <h3 className="font-title text-lg text-amber-900 mb-1">{title}</h3>
        {shouldAnimate && score.total > 0 && (
          <motion.div
            className="text-4xl font-bold"
            style={{
              background: 'linear-gradient(135deg, var(--color-score-gold) 0%, var(--color-score-red) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            {score.total}
          </motion.div>
        )}
        {!shouldAnimate && (
          <div className="text-4xl font-bold text-amber-300">—</div>
        )}
      </div>
      
      {shouldAnimate && (
        <div className="space-y-1">
          <ScoreBar 
            label="沫饽色泽" 
            value={score.color} 
            delay={0}
          />
          <ScoreBar 
            label="持久度" 
            value={score.duration} 
            delay={200}
          />
          <ScoreBar 
            label="咬盏程度" 
            value={score.adhesion} 
            delay={400}
          />
        </div>
      )}
    </motion.div>
  );
};
