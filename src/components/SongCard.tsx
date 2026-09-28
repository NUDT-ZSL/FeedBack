import { memo } from 'react';
import { Star, Check, X, Play, Music, FileText } from 'lucide-react';
import clsx from 'clsx';
import { type Song, type DifficultyLevel } from '@/store/useStore';

const getDifficultyInfo = (difficulty: DifficultyLevel) => {
  if (difficulty <= 2) return { level: 'easy' as const, color: '#22c55e', borderClass: 'difficulty-easy' };
  if (difficulty === 3) return { level: 'medium' as const, color: '#eab308', borderClass: 'difficulty-medium' };
  return { level: 'hard' as const, color: '#ef4444', borderClass: 'difficulty-hard' };
};

interface SongCardProps {
  song: Song;
  onDelete: () => void;
  onToggleComplete: () => void;
  onStartRehearsal: () => void;
}

const SongCard = memo(function SongCard({ song, onDelete, onToggleComplete, onStartRehearsal }: SongCardProps) {
  const { color, borderClass } = getDifficultyInfo(song.difficulty);
  const pdfFileName = song.pdfUrl ? song.pdfUrl.split('/').pop() : null;

  return (
    <div className={clsx('glass-card p-4 relative', borderClass)}>
      <div className="absolute top-3 right-3 flex items-center gap-2">
        {song.completed && (
          <Check
            size={20}
            className="check-bounce-in"
            style={{ color: '#22c55e' }}
          />
        )}
        <button
          onClick={onDelete}
          className="opacity-40 hover:opacity-80 transition-opacity"
        >
          <X size={16} className="text-gray-400" />
        </button>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <Music size={16} style={{ color }} />
        <h3 className="font-display text-lg font-bold text-white truncate">
          {song.name}
        </h3>
      </div>

      <div className="flex items-center gap-4 text-sm text-gray-400 mb-2">
        <span>调式: {song.key}</span>
        <span>BPM: {song.bpm}</span>
      </div>

      <div className="flex items-center gap-0.5 mb-3">
        {Array.from({ length: 5 }, (_, i) => (
          <Star
            key={i}
            size={14}
            fill={i < song.difficulty ? color : '#4a4a5a'}
            stroke={i < song.difficulty ? color : '#4a4a5a'}
          />
        ))}
      </div>

      {pdfFileName && (
        <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-3">
          <FileText size={12} />
          <span className="truncate">{pdfFileName}</span>
        </div>
      )}

      <button
        onClick={onStartRehearsal}
        className="btn-ripple w-full flex items-center justify-center gap-2 py-2 text-sm font-medium text-white rounded-lg"
        style={{ background: 'linear-gradient(135deg, #00d4aa, #00a888)' }}
      >
        <Play size={14} />
        开始排练
      </button>
    </div>
  );
});

export default SongCard;
