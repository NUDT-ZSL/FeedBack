import { memo, useState } from 'react';
import { Check } from 'lucide-react';
import type { StageProgress } from '@/utils/types';

interface StageBubbleProps {
  stage: StageProgress;
  index: number;
  isLast: boolean;
  onClick?: () => void;
  expanded?: boolean;
  actionPanel?: React.ReactNode;
}

function StageBubbleComponent({
  stage,
  index,
  isLast,
  onClick,
  expanded = false,
  actionPanel,
}: StageBubbleProps) {
  const [panelOpen, setPanelOpen] = useState(expanded);
  const open = actionPanel ? panelOpen : false;

  const bubbleBase =
    'relative w-14 h-14 md:w-16 md:h-16 rounded-full flex items-center justify-center flex-shrink-0 cursor-pointer select-none transition-all duration-300';

  let bubbleClasses = '';
  let numberColor = '';

  if (stage.status === 'completed') {
    bubbleClasses = 'bg-gradient-to-br from-success to-[#7CB068] text-white shadow-lg shadow-success/30';
    numberColor = 'text-white';
  } else if (stage.status === 'current') {
    bubbleClasses = 'bg-gradient-to-br from-warning to-[#F5A962] text-white animate-pulseGlow shadow-lg shadow-warning/30';
    numberColor = 'text-white';
  } else {
    bubbleClasses = 'bg-white border-2 border-progress-gray text-progress-gray';
    numberColor = 'text-progress-gray';
  }

  const togglePanel = () => {
    if (actionPanel) setPanelOpen((p) => !p);
    onClick?.();
  };

  return (
    <div className="flex-1 flex flex-col items-center min-w-0">
      <div className="w-full flex items-start justify-center relative">
        {!isLast && (
          <div className="absolute top-1/2 left-1/2 w-full h-0.5 -translate-y-1/2 -z-0 pointer-events-none">
            <div
              className={`h-full transition-all duration-500 ${
                stage.status === 'completed'
                  ? 'w-full bg-gradient-to-r from-success to-[#7CB068]'
                  : 'w-full bg-progress-gray'
              }`}
            />
          </div>
        )}
        <button
          type="button"
          onClick={togglePanel}
          className={`${bubbleBase} ${bubbleClasses} z-10 hover:scale-105 active:scale-95 transition-transform duration-150`}
          aria-label={stage.name}
        >
          {stage.status === 'completed' ? (
            <Check
              className="w-6 h-6 md:w-7 md:h-7 animate-checkSlide"
              strokeWidth={3}
            />
          ) : (
            <span
              className={`font-display text-lg md:text-xl font-bold ${numberColor}`}
            >
              {index + 1}
            </span>
          )}
        </button>
      </div>
      <div className="mt-2 text-center px-1">
        <div
          className={`text-xs md:text-sm font-medium ${
            stage.status === 'pending'
              ? 'text-brand-dark/40'
              : 'text-brand-dark'
          }`}
        >
          {stage.name}
        </div>
        {stage.durationMinutes && stage.status === 'completed' && (
          <div className="text-[10px] md:text-xs text-brand-dark/50 mt-0.5">
            {stage.durationMinutes}分钟
          </div>
        )}
      </div>
      {actionPanel && (
        <div
          className={`w-full mt-2 overflow-hidden transition-all duration-300 ease-out ${
            open ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
          }`}
        >
          {actionPanel}
        </div>
      )}
    </div>
  );
}

StageBubbleComponent.displayName = 'StageBubble';
export const StageBubble = memo(StageBubbleComponent);
