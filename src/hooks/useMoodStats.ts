import { useState, useCallback } from 'react';
import type { MoodType, MoodStats } from '../types';
import { getTodayStats, submitMood as apiSubmitMood } from '../api/client';

export function useMoodStats() {
  const [todayStats, setTodayStats] = useState<MoodStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTodayStats = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const stats = await getTodayStats();
      setTodayStats(stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取统计数据失败');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const submitMood = useCallback(async (mood: MoodType) => {
    setIsLoading(true);
    setError(null);
    try {
      await apiSubmitMood(mood);
      await fetchTodayStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交情绪失败');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [fetchTodayStats]);

  return {
    todayStats,
    isLoading,
    error,
    fetchTodayStats,
    submitMood,
  };
}
