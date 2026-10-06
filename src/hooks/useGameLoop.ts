// 游戏主循环：requestAnimationFrame 驱动 store.tick，切后台自动暂停
import { useEffect, useRef } from 'react';
import { useGameStore } from '@/store';

export function useGameLoop() {
  const phase = useGameStore((s) => s.phase);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    let rafId = 0;
    let lastTs: number | null = null;

    const loop = (ts: number) => {
      rafId = requestAnimationFrame(loop);
      const state = useGameStore.getState();
      if (lastTs === null) {
        lastTs = ts;
        return;
      }
      const delta = (ts - lastTs) / 1000;
      lastTs = ts;
      // 暂停时只记录时间，不推进游戏时钟（resume 后状态天然衔接）
      if (phaseRef.current === 'playing' && delta > 0) {
        state.tick(delta);
      }
    };

    rafId = requestAnimationFrame(loop);

    // 切后台时 RAF 会挂起；主动暂停避免玩家在不知情下丢时间
    const handleVisibility = () => {
      const current = useGameStore.getState();
      if (document.hidden && current.phase === 'playing') {
        current.pauseGame();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);
}
