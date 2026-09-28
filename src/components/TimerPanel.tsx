import { useEffect, useCallback } from 'react';
import { useStore } from '@/store/useStore';
import { Play, Pause, SkipForward, Square, Clock, Music } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function TimerPanel() {
  const songs = useStore((s) => s.songs);
  const timer = useStore((s) => s.timer);
  const rehearsalPlans = useStore((s) => s.rehearsalPlans);
  const startTimer = useStore((s) => s.startTimer);
  const pauseTimer = useStore((s) => s.pauseTimer);
  const resumeTimer = useStore((s) => s.resumeTimer);
  const tickTimer = useStore((s) => s.tickTimer);
  const nextSong = useStore((s) => s.nextSong);
  const stopTimer = useStore((s) => s.stopTimer);

  const currentSong = songs.find((s) => s.id === timer.currentSongId) ?? null;
  const totalDuration = timer.elapsed + timer.remaining;
  const progressPercent = totalDuration > 0 ? (timer.elapsed / totalDuration) * 100 : 0;

  const handleStart = useCallback(() => {
    const firstIncomplete = songs.find((s) => !s.completed);
    if (firstIncomplete) {
      startTimer(firstIncomplete.id);
    }
  }, [songs, startTimer]);

  useEffect(() => {
    if (!timer.isRunning) return;
    const interval = setInterval(() => {
      tickTimer();
    }, 1000);
    return () => clearInterval(interval);
  }, [timer.isRunning, tickTimer]);

  useEffect(() => {
    if (timer.remaining === 0 && timer.currentSongId !== null && !timer.isRunning) {
      const timeout = setTimeout(() => {
        nextSong();
      }, 1500);
      return () => clearTimeout(timeout);
    }
  }, [timer.remaining, timer.currentSongId, timer.isRunning, nextSong]);

  const getSongDuration = useCallback(
    (songId: string) => {
      const plan = rehearsalPlans.find((p) => p.songId === songId);
      return plan ? plan.duration : 3;
    },
    [rehearsalPlans]
  );

  return (
    <div className="glass-card-no-hover p-6 flex flex-col gap-5">
      <div className="flex items-center gap-2 font-display font-bold text-lg">
        <Clock className="w-5 h-5 text-neon" />
        排练计时器
      </div>

      <div className="min-h-[72px]">
        <AnimatePresence mode="wait">
          {!currentSong ? (
            <motion.div
              key="placeholder"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center justify-center gap-2 text-white/40 py-4"
            >
              <Music className="w-5 h-5" />
              <span>未开始排练</span>
            </motion.div>
          ) : (
            <motion.div
              key={currentSong.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="flex flex-col gap-1"
            >
              <span className="text-neon font-bold text-lg truncate">
                {currentSong.name}
              </span>
              <div className="flex gap-3 text-sm text-white/60">
                <span>BPM {currentSong.bpm}</span>
                <span>Key {currentSong.key}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex flex-col gap-2">
        <div className="bg-dark-50 rounded-full h-3 overflow-hidden">
          <div
            className={cn(
              'bg-neon rounded-full h-full transition-all duration-1000',
              timer.isRunning && 'neon-pulse'
            )}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-2xl font-display font-bold tabular-nums">
            {formatTime(timer.remaining)}
          </span>
          <span className="text-xs text-white/40">
            已用时 {formatTime(timer.elapsed)}
          </span>
        </div>
      </div>

      <div className="flex gap-2 justify-center">
        {!timer.isRunning && !timer.currentSongId && (
          <button
            onClick={handleStart}
            className="btn-ripple bg-neon text-dark px-4 py-2 flex items-center gap-1.5 font-medium"
          >
            <Play className="w-4 h-4" />
            开始
          </button>
        )}
        {timer.isRunning && (
          <>
            <button
              onClick={pauseTimer}
              className="btn-ripple bg-neon text-dark px-4 py-2 flex items-center gap-1.5 font-medium"
            >
              <Pause className="w-4 h-4" />
              暂停
            </button>
            <button
              onClick={nextSong}
              className="btn-ripple bg-dark-100 text-white/80 px-4 py-2 flex items-center gap-1.5"
            >
              <SkipForward className="w-4 h-4" />
              下一首
            </button>
          </>
        )}
        {!timer.isRunning && timer.currentSongId && (
          <>
            <button
              onClick={resumeTimer}
              className="btn-ripple bg-neon text-dark px-4 py-2 flex items-center gap-1.5 font-medium"
            >
              <Play className="w-4 h-4" />
              继续
            </button>
            <button
              onClick={nextSong}
              className="btn-ripple bg-dark-100 text-white/80 px-4 py-2 flex items-center gap-1.5"
            >
              <SkipForward className="w-4 h-4" />
              下一首
            </button>
            <button
              onClick={stopTimer}
              className="btn-ripple bg-dark-100 text-white/80 px-4 py-2 flex items-center gap-1.5"
            >
              <Square className="w-4 h-4" />
              停止
            </button>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2 mt-2">
        <span className="text-sm font-medium text-white/60">曲目队列</span>
        <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
          {songs.map((song) => {
            const isCurrent = song.id === timer.currentSongId;
            const duration = getSongDuration(song.id);
            return (
              <div
                key={song.id}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg text-sm',
                  isCurrent && 'border-l-2 border-neon bg-neon/5'
                )}
              >
                {song.completed ? (
                  <span className="text-green-400 flex-shrink-0">✓</span>
                ) : (
                  <span className="w-4 flex-shrink-0" />
                )}
                <span
                  className={cn(
                    'truncate flex-1',
                    isCurrent ? 'text-neon font-medium' : 'text-white/70'
                  )}
                >
                  {song.name}
                </span>
                <span className="text-white/40 text-xs flex-shrink-0">
                  {duration}min
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
