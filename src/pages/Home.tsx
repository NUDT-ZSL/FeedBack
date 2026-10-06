// 游戏主页：组合 ActionPanel / Stage / StatusPanel，
// 驱动游戏循环（100ms tick），处理暂停/恢复、切后台自动暂停与开始/结算覆盖层。

import { useEffect } from 'react';
import { useGameStore } from '@/store';
import { useTheme } from '@/hooks/useTheme';
import Stage from '@/components/Stage';
import ActionPanel from '@/components/ActionPanel';
import StatusPanel from '@/components/StatusPanel';
import { GAME_DURATION_MS, GOLD_SCORE, SILVER_SCORE } from '@/config';

const RATING_STYLE: Record<string, { label: string; color: string }> = {
  金: { label: '金牌百戏', color: '#d4a017' },
  银: { label: '银牌百戏', color: '#8d9aa5' },
  铜: { label: '铜牌百戏', color: '#a5672f' },
};

export default function Home() {
  const status = useGameStore((s) => s.status);
  const start = useGameStore((s) => s.start);
  const togglePause = useGameStore((s) => s.togglePause);
  const lastResult = useGameStore((s) => s.lastResult);
  const best = useGameStore((s) => s.best);
  const gamesPlayed = useGameStore((s) => s.gamesPlayed);
  const { theme, toggleTheme } = useTheme();

  // 游戏循环：进行中每 100ms 推进一次时钟
  useEffect(() => {
    if (status !== 'running') return;
    const timer = setInterval(() => useGameStore.getState().tick(100), 100);
    return () => clearInterval(timer);
  }, [status]);

  // 失败恢复：切到后台自动暂停，回来后从暂停处继续，不产生时间漂移
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) useGameStore.getState().pause();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const rating = lastResult ? RATING_STYLE[lastResult.rating] : null;

  return (
    <div
      className="flex min-h-screen flex-col items-center py-4 transition-colors"
      style={{ background: theme === 'dark' ? '#3a2f1d' : '#f5e6c8' }}
    >
      {/* 顶部栏 */}
      <header className="mb-4 flex w-full max-w-5xl items-center justify-between px-4">
        <h1 className="text-2xl font-extrabold" style={{ color: theme === 'dark' ? '#f5e6c8' : '#5d4a2f' }}>
          长安西市 · 驯猴百戏
        </h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={togglePause}
            disabled={status !== 'running' && status !== 'paused'}
            className="rounded-lg border-2 border-[#8b6f47] bg-[#f0dfb8] px-3 py-1 text-sm font-bold text-[#5d4a2f] transition-transform duration-200 enabled:hover:scale-105 enabled:active:scale-95 disabled:opacity-50"
          >
            {status === 'paused' ? '继续' : '暂停'}
          </button>
          <button
            type="button"
            onClick={start}
            className="rounded-lg border-2 border-[#8b6f47] bg-[#f0dfb8] px-3 py-1 text-sm font-bold text-[#5d4a2f] transition-transform duration-200 hover:scale-105 active:scale-95"
          >
            {status === 'idle' ? '开始表演' : '重新开局'}
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            title="切换昼夜"
            className="rounded-lg border-2 border-[#8b6f47] bg-[#f0dfb8] px-3 py-1 text-sm transition-transform duration-200 hover:scale-105 active:scale-95"
          >
            {theme === 'dark' ? '🌞' : '🌙'}
          </button>
        </div>
      </header>

      {/* 主区域：宽屏水平排列，窄屏面板下移 */}
      <main className="relative flex flex-col items-center gap-4 lg:flex-row lg:items-start">
        <ActionPanel />
        <div className="relative">
          <Stage />

          {/* 开始覆盖层 */}
          {status === 'idle' && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-xl bg-black/45 text-center">
              <div className="text-3xl">🐒</div>
              <p className="px-6 text-sm font-semibold text-[#f5e6c8]">
                {GAME_DURATION_MS / 1000} 秒限时表演：安排动作、控制疲劳、积攒连击，
                充满能量后放出招牌技「封侯大戏」赢取满堂打赏！
              </p>
              <button
                type="button"
                onClick={start}
                className="rounded-lg border-2 border-[#ebb04b] bg-[#c0392b] px-6 py-2 text-lg font-extrabold text-[#f5e6c8] transition-transform duration-200 hover:scale-105 active:scale-95"
              >
                开锣！
              </button>
              {gamesPlayed > 0 && (
                <p className="text-xs text-[#f5e6c8]/80">历史最高：{best} 文</p>
              )}
            </div>
          )}

          {/* 暂停覆盖层 */}
          {status === 'paused' && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-xl bg-black/45">
              <p className="text-lg font-bold text-[#f5e6c8]">已暂停</p>
              <button
                type="button"
                onClick={togglePause}
                className="rounded-lg border-2 border-[#ebb04b] bg-[#c0392b] px-6 py-2 font-extrabold text-[#f5e6c8] transition-transform duration-200 hover:scale-105 active:scale-95"
              >
                继续表演
              </button>
            </div>
          )}

          {/* 结算覆盖层 */}
          {status === 'finished' && lastResult && rating && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl bg-black/55 text-[#f5e6c8]">
              <div className="text-sm">时辰到！</div>
              <div className="text-4xl font-extrabold tabular-nums">{lastResult.score} 文</div>
              <div
                className="rounded-full border-2 px-4 py-1 text-lg font-extrabold"
                style={{ borderColor: rating.color, color: rating.color }}
              >
                {rating.label} · {lastResult.rating}
              </div>
              <div className="text-xs opacity-90">
                成功 {lastResult.successCount} 次 · 失手 {lastResult.failCount} 次 · 最高连击 x
                {lastResult.maxCombo}
              </div>
              <div className="text-xs opacity-75">
                （银 {SILVER_SCORE} 文 / 金 {GOLD_SCORE} 文）历史最高 {best} 文
              </div>
              <button
                type="button"
                onClick={start}
                className="mt-1 rounded-lg border-2 border-[#ebb04b] bg-[#c0392b] px-6 py-2 font-extrabold text-[#f5e6c8] transition-transform duration-200 hover:scale-105 active:scale-95"
              >
                再来一局
              </button>
            </div>
          )}
        </div>
        <StatusPanel />
      </main>
    </div>
  );
}
