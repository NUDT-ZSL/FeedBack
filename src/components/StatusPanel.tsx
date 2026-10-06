// 状态面板：倒计时、打赏得分、疲劳度圆环（绿到红渐变）、
// 围观情绪条、连击/满堂彩、招牌技充能、历史最高分。

import { useGameStore } from '@/store';
import { FULL_HOUSE_COMBO } from '@/config';

function FatigueRing({ value }: { value: number }) {
  const size = 76;
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - value / 100);
  const hue = Math.round(120 - (value / 100) * 120);
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#d8c8a0"
        strokeWidth={8}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={`hsl(${hue}, 70%, 45%)`}
        strokeWidth={8}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 0.15s linear, stroke 0.3s' }}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        className="rotate-90 text-xs font-bold"
        fill="#5d4a2f"
      >
        {Math.round(value)}%
      </text>
    </svg>
  );
}

function Bar({ value, color, label }: { value: number; color: string; label: string }) {
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-[11px] font-semibold text-[#5d4a2f]">
        <span>{label}</span>
        <span>{Math.round(value)}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-black/10">
        <div
          className="h-full rounded-full transition-all duration-200"
          style={{ width: `${Math.min(100, value)}%`, background: color }}
        />
      </div>
    </div>
  );
}

export default function StatusPanel() {
  const timeLeft = useGameStore((s) => s.timeLeft);
  const score = useGameStore((s) => s.monkey.score);
  const fatigue = useGameStore((s) => s.monkey.fatigue);
  const mood = useGameStore((s) => s.audience.mood);
  const combo = useGameStore((s) => s.monkey.combo);
  const energy = useGameStore((s) => s.monkey.energy);
  const best = useGameStore((s) => s.best);

  const seconds = Math.ceil(timeLeft / 1000);
  const urgent = seconds <= 10;

  return (
    <div
      className="flex w-[180px] flex-col items-center gap-3 rounded-xl border-4 p-3"
      style={{ background: '#f0dfb8', borderColor: '#8b6f47' }}
    >
      <h2 className="text-sm font-bold text-[#5d4a2f]">状态</h2>

      <div
        className="w-full rounded-lg py-1.5 text-center text-2xl font-extrabold tabular-nums"
        style={{
          color: urgent ? '#c0392b' : '#5d4a2f',
          background: 'rgba(255,255,255,0.45)',
        }}
      >
        {seconds}s
      </div>

      <div className="w-full text-center">
        <div className="text-[11px] text-[#8b6f47]">打赏（文）</div>
        <div className="text-xl font-extrabold tabular-nums text-[#8b5a14]">{score}</div>
      </div>

      <div className="flex flex-col items-center">
        <span className="text-[11px] font-semibold text-[#5d4a2f]">疲劳度</span>
        <FatigueRing value={fatigue} />
      </div>

      <div className="w-full">
        <Bar value={mood} color="linear-gradient(90deg,#e8a33d,#c0392b)" label="观众情绪" />
      </div>
      <div className="w-full">
        <Bar
          value={energy}
          color="linear-gradient(90deg,#f4d44d,#d4a017)"
          label="招牌技充能"
        />
      </div>

      <div
        className="w-full rounded-lg py-1 text-center text-xs font-bold"
        style={{
          background: combo >= FULL_HOUSE_COMBO ? '#c0392b' : 'rgba(255,255,255,0.45)',
          color: combo >= FULL_HOUSE_COMBO ? '#f5e6c8' : '#5d4a2f',
        }}
      >
        连击 x{combo}
        {combo >= FULL_HOUSE_COMBO ? ' · 满堂彩' : ''}
      </div>

      <div className="text-[11px] text-[#8b6f47]">
        历史最高：<span className="font-bold tabular-nums">{best}</span> 文
      </div>
    </div>
  );
}
