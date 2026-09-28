import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { formatCountdownParts } from '../../utils/format';

interface Props {
  deadline: string;
  showIcon?: boolean;
  size?: 'sm' | 'md';
}

export default function CountdownTimer({ deadline, showIcon = true, size = 'sm' }: Props) {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const parts = formatCountdownParts(deadline);
    const interval = parts.expired || parseInt(parts.days) > 0 ? 60000 : 1000;
    const t = setInterval(() => forceUpdate((x) => x + 1), interval);
    return () => clearInterval(t);
  }, [deadline]);

  const parts = formatCountdownParts(deadline);
  const days = parseInt(parts.days);

  if (size === 'sm') {
    return (
      <div
        className={`flex items-center gap-1.5 text-xs ${
          parts.expired ? 'text-red-400' : 'text-gold-400'
        }`}
      >
        {showIcon && <Clock className="w-3.5 h-3.5 shrink-0" />}
        {parts.expired ? (
          <span className="font-medium">已截止</span>
        ) : days > 0 ? (
          <span className="countdown-num">
            {days}天 {parts.hours}时{parts.minutes}分
          </span>
        ) : (
          <span className="countdown-num">
            {parts.hours}:{parts.minutes}:{parts.seconds}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={`${parts.expired ? 'text-red-400' : ''}`}>
      {parts.expired ? (
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5" />
          <span className="font-display text-lg font-semibold">招募已截止</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 md:gap-3">
          <Clock className="w-5 h-5 text-gold-400 shrink-0" />
          <div className="flex items-center gap-1.5 md:gap-2">
            <TimeBlock value={parts.days} label="天" />
            <Sep />
            <TimeBlock value={parts.hours} label="时" />
            <Sep />
            <TimeBlock value={parts.minutes} label="分" />
            {days === 0 && (
              <>
                <Sep />
                <TimeBlock value={parts.seconds} label="秒" />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TimeBlock({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="countdown-num text-2xl md:text-3xl font-bold text-gold-400 bg-wine-900/40 px-2.5 md:px-3 py-1.5 rounded-lg min-w-[2ch] text-center">
        {value}
      </span>
      <span className="text-[10px] text-theater-textMuted mt-1">{label}</span>
    </div>
  );
}

function Sep() {
  return <span className="text-gold-400/50 font-bold text-xl md:text-2xl mb-4">:</span>;
}
