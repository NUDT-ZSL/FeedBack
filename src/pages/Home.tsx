// 游戏主页面：组合舞台、动作面板、道具面板、状态面板与结算/开场弹窗
import { useGameStore } from '@/store';
import { useGameLoop } from '@/hooks/useGameLoop';
import Stage from '@/components/Stage';
import ActionPanel from '@/components/ActionPanel';
import PropPanel from '@/components/PropPanel';
import StatusPanel from '@/components/StatusPanel';
import GameOver from '@/components/GameOver';
import StartScreen from '@/components/StartScreen';

export default function Home() {
  useGameLoop();

  const phase = useGameStore((s) => s.phase);
  const timeLeft = useGameStore((s) => s.timeLeft);
  const score = useGameStore((s) => s.monkey.score);
  const fatigue = useGameStore((s) => s.monkey.fatigue);
  const mood = useGameStore((s) => s.audience.mood);
  const bestScore = useGameStore((s) => s.bestScore);
  const pauseGame = useGameStore((s) => s.pauseGame);
  const resumeGame = useGameStore((s) => s.resumeGame);

  return (
    <div className="flex min-h-full flex-col p-3 md:p-5">
      {/* 主区域：宽屏三栏，窄屏纵向堆叠 */}
      <div className="flex flex-1 flex-col gap-3 lg:flex-row">
        {/* 左栏：动作 + 道具 */}
        <aside className="order-2 flex flex-row gap-3 lg:order-1 lg:w-[220px] lg:flex-col">
          <div className="flex-1">
            <ActionPanel />
          </div>
          <div className="flex-1">
            <PropPanel />
          </div>
        </aside>

        {/* 中栏：舞台 */}
        <main className="order-1 h-[52vh] min-h-[320px] flex-1 lg:order-2 lg:h-auto">
          <Stage />
        </main>

        {/* 右栏：状态 */}
        <aside className="order-3 lg:w-[200px]">
          <StatusPanel
            timeLeft={timeLeft}
            score={score}
            fatigue={fatigue}
            mood={mood}
            bestScore={bestScore}
            onPause={pauseGame}
            onResume={resumeGame}
            isPlaying={phase === 'playing'}
            isPaused={phase === 'paused'}
          />
        </aside>
      </div>

      {/* 暂停遮罩 */}
      {phase === 'paused' && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="rounded-xl border-4 px-8 py-6 text-center shadow-xl" style={{ borderColor: 'var(--wood)', backgroundColor: '#fdf6e6' }}>
            <p className="text-lg font-bold" style={{ color: 'var(--wood)' }}>演出暂停中</p>
            <button
              type="button"
              onClick={resumeGame}
              className="btn-action mt-4 rounded-lg bg-[#3a6b8d] px-6 py-2 font-semibold text-white shadow"
            >
              继续演出 ▶
            </button>
          </div>
        </div>
      )}

      <StartScreen />
      <GameOver />
    </div>
  );
}
