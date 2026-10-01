import { useState } from 'react';
import { Undo2, Redo2, Waves, Volume2, VolumeX, RotateCcw, Gauge, FlipHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HistoryEntry {
  id: string;
  timestamp: number;
  type: string;
  description: string;
  icon: string;
}

interface HistoryPanelProps {
  history: HistoryEntry[];
  historyIndex: number;
  onUndo: () => void;
  onRedo: () => void;
  onJumpToHistory: (index: number) => void;
}

const iconMap: Record<string, React.ElementType> = {
  fadeIn: Volume2,
  fadeOut: VolumeX,
  echo: Waves,
  speed: Gauge,
  reverse: FlipHorizontal,
  upload: Waves,
};

const getIcon = (iconName: string) => {
  return iconMap[iconName] || Waves;
};

export default function HistoryPanel({
  history,
  historyIndex,
  onUndo,
  onRedo,
  onJumpToHistory,
}: HistoryPanelProps) {
  const [isAnimating, setIsAnimating] = useState(false);
  const [pressedButton, setPressedButton] = useState<'undo' | 'redo' | null>(null);

  const handleJumpToHistory = (index: number) => {
    if (index === historyIndex || isAnimating) return;
    setIsAnimating(true);
    setTimeout(() => {
      onJumpToHistory(index);
      setIsAnimating(false);
    }, 300);
  };

  const handleUndo = () => {
    if (historyIndex <= 0 || isAnimating) return;
    setIsAnimating(true);
    setTimeout(() => {
      onUndo();
      setIsAnimating(false);
    }, 300);
  };

  const handleRedo = () => {
    if (historyIndex >= history.length - 1 || isAnimating) return;
    setIsAnimating(true);
    setTimeout(() => {
      onRedo();
      setIsAnimating(false);
    }, 300);
  };

  const handleMouseDown = (button: 'undo' | 'redo') => {
    setPressedButton(button);
  };

  const handleMouseUp = () => {
    setPressedButton(null);
  };

  const canUndo = historyIndex > 0 && !isAnimating;
  const canRedo = historyIndex < history.length - 1 && !isAnimating;

  return (
    <div
      className="flex h-full flex-col rounded-lg p-4"
      style={{ backgroundColor: '#16213e', color: '#e0e0e0' }}
    >
      <h3 className="mb-4 text-base font-bold">操作历史</h3>

      <div className="relative flex-1 overflow-y-auto">
        <div className="absolute left-4 top-0 h-full w-0.5 bg-gray-600" />

        <div className="space-y-3">
          {history.map((entry, index) => {
            const IconComponent = getIcon(entry.icon);
            const isActive = index <= historyIndex;
            const isCurrent = index === historyIndex;

            return (
              <div
                key={entry.id}
                className={cn(
                  'relative flex cursor-pointer items-start gap-3 pl-10 pr-2 py-2 rounded-md transition-all duration-200',
                  isActive ? 'opacity-100' : 'opacity-40',
                  isCurrent && 'ring-1 ring-cyan-500/50',
                  'hover:bg-white/5'
                )}
                onClick={() => handleJumpToHistory(index)}
              >
                <div
                  className={cn(
                    'absolute left-2 top-2.5 flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors duration-200',
                    isActive ? 'border-cyan-400 bg-cyan-400/20' : 'border-gray-500 bg-gray-700'
                  )}
                >
                  <IconComponent
                    className={cn(
                      'h-3 w-3 transition-colors duration-200',
                      isActive ? 'text-cyan-400' : 'text-gray-400'
                    )}
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      'text-sm truncate transition-all duration-300',
                      isAnimating && isCurrent && 'animate-pulse'
                    )}
                    style={{
                      transform: isAnimating && isCurrent ? 'scaleY(0)' : 'scaleY(1)',
                      transformOrigin: 'top',
                      transition: 'transform 0.3s ease-in-out',
                    }}
                  >
                    {entry.description}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {new Date(entry.timestamp).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            );
          })}

          {history.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <RotateCcw className="h-12 w-12 mb-3 opacity-50" />
              <p className="text-sm">暂无操作记录</p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-4 pt-4 border-t border-gray-700">
        <button
          onClick={handleUndo}
          onMouseDown={() => handleMouseDown('undo')}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          disabled={!canUndo}
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-lg transition-all duration-150',
            canUndo
              ? 'bg-gray-700 hover:bg-gray-600 active:translate-y-0.5'
              : 'bg-gray-800 cursor-not-allowed opacity-50'
          )}
          style={{
            boxShadow: pressedButton === 'undo'
              ? 'inset 0 2px 4px rgba(0, 0, 0, 0.4)'
              : canUndo
              ? '0 2px 4px rgba(0, 0, 0, 0.3)'
              : 'none',
          }}
        >
          <Undo2 className="h-5 w-5" />
        </button>

        <div className="text-sm text-gray-400">
          {history.length > 0 ? `${historyIndex + 1} / ${history.length}` : '0 / 0'}
        </div>

        <button
          onClick={handleRedo}
          onMouseDown={() => handleMouseDown('redo')}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          disabled={!canRedo}
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-lg transition-all duration-150',
            canRedo
              ? 'bg-gray-700 hover:bg-gray-600 active:translate-y-0.5'
              : 'bg-gray-800 cursor-not-allowed opacity-50'
          )}
          style={{
            boxShadow: pressedButton === 'redo'
              ? 'inset 0 2px 4px rgba(0, 0, 0, 0.4)'
              : canRedo
              ? '0 2px 4px rgba(0, 0, 0, 0.3)'
              : 'none',
          }}
        >
          <Redo2 className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
