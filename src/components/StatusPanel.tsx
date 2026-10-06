// 状态面板（订阅 store 状态）：倒计时、得分、疲劳圆环、情绪条
import { memo } from 'react';

interface StatusPanelProps {
  timeLeft: number;
  score: number;
  fatigue: number;
  mood: number;
  bestScore: number;
  onPause: () => void;
  onResume: () => void;
  isPlaying: boolean;
  isPaused: boolean;
}

function fatigueColor(value: number): string {
  // 绿 → 黄 → 红
  if (value < 50) return '#4a9d4a';
  if (value < 80) return '#d4a76a';
  return '#c0392b';
}

const RADIUS = 34;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const StatusPanel = memo(function StatusPanel({
  timeLeft,
  score,
  fatigue,
  mood,
  bestScore,
  onPause,
  onResume,
  isPlaying,
  isPaused,
}: StatusPanelProps) {
  const dashOffset = CIRCUMFERENCE * (1 - fatigue / 100);
  const urgent = timeLeft <= 10;

  return (
    <div className="flex w-full flex-col items-center gap-3 rounded-xl border-2 p-3" style={{ borderColor: 'var(--wood)', backgroundColor: '#fdf6e6' }}>
      <h2 className="text-base font-bold" style={{ color: 'var(--wood)' }}>演出状态</h2>

      <div className={`text-5xl font-extrabold tabular-nums ${urgent ? 'animate-pulse text-red-600' : 'text-[#4a3520]'}`}>
        {Math.ceil(timeLeft)}
        <span className="text-base font-normal">秒</span>
      </div>

      <div className="text-center">
        <div className="text-xs text-[#7a6444]">累计打赏</div>
        <div className="text-2xl font-bold text-[#8b6914] tabular-nums">{score}<span className="text-sm font-normal">文</span></div>
        <div className="text-[10px] text-[#7a6444]">最佳 {bestScore} 文</div>
      </div>

      {/* 疲劳度圆环 */}
      <div className="relative h-24 w-24">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r={RADIUS} fill="none" stroke="#e6dcc4" strokeWidth="8" />
          <circle
            cx="40"
            cy="40"
            r={RADIUS}
            fill="none"
            stroke={fatigueColor(fatigue)}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 0.2s linear, stroke 0.3s' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold tabular-nums" style={{ color: fatigueColor(fatigue) }}>{Math.round(fatigue)}%</span>
          <span className="text-[10px] text-[#7a6444]">疲劳</span>
        </div>
      </div>

      {/* 情绪值进度条 */}
      <div className="w-full">
        <div className="mb-1 flex justify-between text-xs text-[#7a6444]">
          <span>看客情绪</span>
          <span className="tabular-nums">{Math.round(mood)}</span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-[#e6dcc4]">
          <div
            className="h-full rounded-full"
            style={{
              width: `${mood}%`,
              background: mood >= 60 ? 'linear-gradient(to right, #d4a76a, #c0392b)' : 'linear-gradient(to right, #7a8a7a, #a8b8a8)',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={isPaused ? onResume : onPause}
        disabled={!isPlaying && !isPaused}
        className="btn-action mt-1 w-full rounded-lg bg-[#3a6b8d] px-3 py-2 text-sm font-semibold text-white shadow disabled:opacity-40"
      >
        {isPaused ? '继续演出 ▶' : '暂 停 ❚❚'}
      </button>
    </div>
  );
});

export default StatusPanel;
