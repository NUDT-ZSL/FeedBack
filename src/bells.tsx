import { useState } from 'react';
import type { BellNote } from './types';
import { NOTES } from './state/constants';

interface BellsPanelProps {
  isRecording: boolean;
  isPlaying: boolean;
  eventCount: number;
  durationMs: number;
  elapsedMs: number;
  onBellClick: (note: BellNote) => void;
  onToggleRecord: () => void;
  onPlay: () => void;
  onStopPlay: () => void;
}

const NOTE_FREQ: Record<BellNote, number> = {
  Do: 261.63,
  Re: 293.66,
  Mi: 329.63,
  Fa: 349.23,
  Sol: 392.0,
  La: 440.0,
  Si: 493.88,
};

/** 编钟面板：7 枚编钟 + 录制 / 回放控制，序列归属当前场次 */
export function BellsPanel({
  isRecording,
  isPlaying,
  eventCount,
  durationMs,
  elapsedMs,
  onBellClick,
  onToggleRecord,
  onPlay,
  onStopPlay,
}: BellsPanelProps) {
  const [ripples, setRipples] = useState<{ note: BellNote; key: number }[]>([]);
  const [ringing, setRinging] = useState<BellNote | null>(null);

  const strike = (note: BellNote) => {
    onBellClick(note);
    setRipples((r) => [...r, { note, key: Date.now() + Math.random() }]);
    setRinging(note);
    window.setTimeout(() => setRinging((cur) => (cur === note ? null : cur)), 350);
    window.setTimeout(
      () => setRipples((r) => r.filter((x) => x.note !== note)),
      850,
    );
  };

  return (
    <div className="bells-container">
      <div className="bells-row">
        {NOTES.map((note, i) => {
          const size = 64 - i * 4;
          return (
            <div
              key={note}
              className="bell-wrapper"
              onClick={() => strike(note)}
              data-note={note}
            >
              <div
                className={`bell ${ringing === note ? 'ringing' : ''} ${isRecording ? 'recording' : ''}`}
              >
                <svg
                  className="bell-svg"
                  width={size}
                  height={size + 14}
                  viewBox="0 0 60 74"
                >
                  <rect x="26" y="0" width="8" height="10" fill="#8b5e3c" />
                  <path
                    d="M10 20 Q30 6 50 20 L54 58 Q30 66 6 58 Z"
                    fill="url(#bellGrad)"
                    stroke="#d4af37"
                    strokeWidth="2"
                  />
                  <ellipse cx="30" cy="58" rx="24" ry="5" fill="#a67c4f" />
                  <defs>
                    <linearGradient id="bellGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#e8c96a" />
                      <stop offset="100%" stopColor="#a67c4f" />
                    </linearGradient>
                  </defs>
                </svg>
                {ripples
                  .filter((r) => r.note === note)
                  .map((r) => (
                    <span key={r.key} className="bell-ripple" />
                  ))}
              </div>
              <span className="note-label">
                {note} · {NOTE_FREQ[note].toFixed(0)}Hz
              </span>
            </div>
          );
        })}
      </div>
      <div className="control-buttons">
        <button
          className={`control-btn ${isRecording ? 'recording' : ''}`}
          onClick={onToggleRecord}
        >
          {isRecording ? '■ 停止录制' : '● 录制锣鼓'}
        </button>
        <button
          className="control-btn"
          onClick={onPlay}
          disabled={isRecording || isPlaying || eventCount === 0}
        >
          ▶ 回放本场（{eventCount} 个音符 / {(durationMs / 1000).toFixed(1)}s）
        </button>
        <button className="control-btn" onClick={onStopPlay} disabled={!isPlaying}>
          ■ 停止回放
        </button>
      </div>
      {isRecording && (
        <div className="recording-time">
          录制中… {(elapsedMs / 1000).toFixed(1)}s / 30s（事件将记入当前场次）
        </div>
      )}
    </div>
  );
}
