import { memo } from 'react';
import type { StageProgress } from '@/utils/types';
import { STAGE_ORDER } from '@/utils/constants';

interface ProgressBarProps {
  stages: StageProgress[];
  showPercent?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

function ProgressBarComponent({
  stages,
  showPercent = true,
  size = 'md',
}: ProgressBarProps) {
  const total = STAGE_ORDER.length;
  const completedCount = stages.filter((s) => s.status === 'completed').length;
  const percent = Math.round((completedCount / total) * 100);

  const heightMap = {
    sm: 'h-2',
    md: 'h-3',
    lg: 'h-4',
  };

  return (
    <div className="w-full">
      <div
        className={`w-full flex gap-1 ${heightMap[size]}`}
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {STAGE_ORDER.map((key, idx) => {
          const stage = stages.find((s) => s.stage === key);
          const isCompleted = stage?.status === 'completed';
          const isCurrent = stage?.status === 'current';
          const roundedLeft = idx === 0 ? 'rounded-l-full' : '';
          const roundedRight = idx === total - 1 ? 'rounded-r-full' : '';

          let bgClass = 'bg-progress-gray';
          if (isCompleted) {
            bgClass = 'bg-gradient-to-r from-success to-[#7CB068]';
          } else if (isCurrent) {
            bgClass =
              'bg-gradient-to-r from-warning to-[#F5A962] animate-pulse';
          }

          return (
            <div
              key={key}
              className={`flex-1 rounded-full overflow-hidden ${roundedLeft} ${roundedRight} ${bgClass} transition-all duration-500`}
              title={stage?.name}
            >
              <div className="w-full h-full" />
            </div>
          );
        })}
      </div>
      {showPercent && (
        <div className="flex justify-between items-center mt-1.5 text-xs text-brand-dark/60">
          <span>进度</span>
          <span className="font-mono-num text-brand-brown font-semibold">
            {percent}%
          </span>
        </div>
      )}
    </div>
  );
}

ProgressBarComponent.displayName = 'ProgressBar';
export const ProgressBar = memo(ProgressBarComponent);
