import { useCallback } from 'react';
import type { AIPerformance, Score } from '@/types';

export function useAI() {
  const generatePerformance = useCallback((): AIPerformance => {
    const baseLevel = 60 + Math.random() * 35;
    const variance = (Math.random() - 0.5) * 20;
    
    return {
      waterAmount: 55 + Math.random() * 15,
      whiskSpeed: 8 + Math.random() * 12,
      whiskDuration: 2000 + Math.random() * 3000,
      delay: 5000 + Math.random() * 2000,
    };
  }, []);

  const calculateScore = useCallback((perf: AIPerformance): Score => {
    const idealWater = 60;
    const waterScore = Math.max(0, 100 - Math.abs(perf.waterAmount - idealWater) / idealWater * 50);
    const speedScore = Math.min(100, perf.whiskSpeed / 15 * 100);
    const durationScore = Math.min(100, perf.whiskDuration / 3000 * 100);
    
    const foamThickness = (speedScore * 0.4 + durationScore * 0.4 + waterScore * 0.2);
    const foamColor = (speedScore * 0.5 + durationScore * 0.3 + waterScore * 0.2);
    const foamDuration = (foamThickness * 0.6 + foamColor * 0.4) / 100 * 10;
    const foamAdhesion = (foamThickness * 0.7 + speedScore * 0.3);
    
    const color = Math.round(foamColor);
    const duration = Math.round(Math.min(100, foamDuration / 10 * 100));
    const adhesion = Math.round(foamAdhesion);
    const total = Math.round((color + duration + adhesion) / 3);
    
    return { color, duration, adhesion, total };
  }, []);

  return { generatePerformance, calculateScore };
}
