import { useEffect, useRef, useState, useCallback } from 'react';
import type { Episode, Chapter } from '../server/types.js';

interface PlayerProps {
  episode: Episode;
  onTimeUpdate: (time: number) => void;
  onChapterClick: (time: number) => void;
}

export default function Player({ episode, onTimeUpdate, onChapterClick }: PlayerProps) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [dragging, setDragging] = useState(false);
  const [duration, setDuration] = useState(episode.duration);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const draggingRef = useRef(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      if (isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    const handleEnded = () => {
      setPlaying(false);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    const tick = () => {
      if (audio && !draggingRef.current) {
        const ct = audio.currentTime;
        setCurrentTime(ct);
        const dur = isFinite(audio.duration) ? audio.duration : duration;
        if (dur > 0) {
          setProgress((ct / dur) * 100);
        }
        onTimeUpdate(ct);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [duration, onTimeUpdate]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play().catch((err) => console.warn('Play error:', err));
    }
    setPlaying(!playing);
  }, [playing]);

  const seekFromEvent = useCallback(
    (clientX: number) => {
      const bar = barRef.current;
      if (!bar) return 0;
      const rect = bar.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    },
    []
  );

  const seekTo = useCallback(
    (pct: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const dur = isFinite(audio.duration) ? audio.duration : duration;
      const t = pct * dur;
      audio.currentTime = t;
      setProgress(pct * 100);
      setCurrentTime(t);
      onTimeUpdate(t);
    },
    [duration, onTimeUpdate]
  );

  useEffect(() => {
    draggingRef.current = dragging;
  }, [dragging]);

  const handleBarMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      setDragging(true);
      const pct = seekFromEvent(e.clientX);
      seekTo(pct);

      const onMouseMove = (ev: MouseEvent) => {
        const p = seekFromEvent(ev.clientX);
        const dur = isFinite(audioRef.current?.duration ?? 0) ? audioRef.current!.duration : duration;
        setProgress(p * 100);
        setCurrentTime(p * dur);
      };

      const onMouseUp = (ev: MouseEvent) => {
        const p = seekFromEvent(ev.clientX);
        seekTo(p);
        setDragging(false);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [seekFromEvent, seekTo, duration]
  );

  const handleBarTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      setDragging(true);
      const pct = seekFromEvent(e.touches[0].clientX);
      seekTo(pct);
    },
    [seekFromEvent, seekTo]
  );

  useEffect(() => {
    const onTouchMove = (ev: TouchEvent) => {
      if (!draggingRef.current || !barRef.current) return;
      ev.preventDefault();
      const p = seekFromEvent(ev.touches[0].clientX);
      const dur = isFinite(audioRef.current?.duration ?? 0) ? audioRef.current!.duration : duration;
      setProgress(p * 100);
      setCurrentTime(p * dur);
    };

    const onTouchEnd = (ev: TouchEvent) => {
      if (!draggingRef.current || !barRef.current) return;
      const lastTouch = ev.changedTouches[0];
      const p = seekFromEvent(lastTouch.clientX);
      seekTo(p);
      setDragging(false);
    };

    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    return () => {
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [seekFromEvent, seekTo, duration]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const handlePlayEvent = useCallback(async () => {
    try {
      await fetch(`/api/episode/${episode.id}/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: playing ? 'pause' : 'play', timestamp: Date.now() }),
      });
    } catch { /* fire-and-forget */ }
  }, [episode.id, playing]);

  return (
    <div className="player">
      <audio ref={audioRef} src={episode.audioUrl} preload="metadata" />

      <div className="player-controls">
        <button
          className="play-btn"
          onClick={() => {
            togglePlay();
            handlePlayEvent();
          }}
        >
          {playing ? '⏸' : '▶'}
        </button>

        <div className="player-main">
          <div
            className="progress-bar"
            ref={barRef}
            onMouseDown={handleBarMouseDown}
            onTouchStart={handleBarTouchStart}
          >
            <div className="progress-fill" style={{ width: `${progress}%` }} />
            <div className="progress-thumb" style={{ left: `${progress}%` }} />
            {episode.chapters.map((ch: Chapter) => {
              const pct = (ch.startTime / duration) * 100;
              return (
                <button
                  key={ch.id}
                  className="chapter-marker"
                  style={{ left: `${pct}%`, backgroundColor: ch.color }}
                  onClick={(e) => {
                    e.stopPropagation();
                    const tp = ch.startTime / duration;
                    seekTo(tp);
                    onChapterClick(ch.startTime);
                  }}
                  onTouchStart={(e) => {
                    e.stopPropagation();
                  }}
                  title={ch.title}
                >
                  <span className="chapter-marker-label">{ch.title}</span>
                </button>
              );
            })}
          </div>

          <div className="time-display">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="volume-control">
          <span className="volume-icon">{volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'}</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="volume-slider"
          />
        </div>
      </div>
    </div>
  );
}
