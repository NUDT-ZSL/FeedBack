import { useState } from 'react';
import type { BellNote } from './types.ts';

const BELLS: Array<{ note: BellNote; label: string; size: number }> = [
  { note: 'Do', label: 'Do 宫', size: 64 },
  { note: 'Re', label: 'Re 商', size: 60 },
  { note: 'Mi', label: 'Mi 角', size: 56 },
  { note: 'Fa', label: 'Fa 徵', size: 52 },
  { note: 'Sol', label: 'Sol 羽', size: 48 },
  { note: 'La', label: 'La 变宫', size: 44 },
  { note: 'Si', label: 'Si 变徵', size: 40 },
];

interface BellsProps {
  recording: boolean;
  onStrike: (note: BellNote) => void;
}

export function Bells({ recording, onStrike }: BellsProps) {
  const [ringing, setRinging] = useState<BellNote | null>(null);
  const [ripples, setRipples] = useState<Array<{ id: number; note: BellNote }>>([]);

  const strike = (note: BellNote) => {
    onStrike(note);
    setRinging(note);
    const rippleId = Date.now() + Math.random();
    setRipples((prev) => [...prev, { id: rippleId, note }]);
    setTimeout(() => setRinging((cur) => (cur === note ? null : cur)), 300);
    setTimeout(() => setRipples((prev) => prev.filter((r) => r.id !== rippleId)), 800);
  };

  return (
    <div className="bells-row">
      {BELLS.map(({ note, label, size }) => (
        <div key={note} className="bell-wrapper" onClick={() => strike(note)}>
          <div className={`bell${ringing === note ? ' ringing' : ''}${recording ? ' recording' : ''}`}>
            <svg width={size} height={size + 14} viewBox="0 0 60 74" className="bell-svg">
              <rect x={27} y={0} width={6} height={8} fill="#8b5e3c" />
              <path
                d="M10 66 Q6 40 14 20 Q20 8 30 8 Q40 8 46 20 Q54 40 50 66 Z"
                fill="url(#bellGrad)"
                stroke="#d4af37"
                strokeWidth={2}
              />
              <ellipse cx={30} cy={66} rx={20} ry={5} fill="#a67c4f" />
              <circle cx={30} cy={40} r={4} fill="#d4af37" opacity={0.6} />
              <defs>
                <linearGradient id="bellGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#d4af37" />
                  <stop offset="50%" stopColor="#a67c4f" />
                  <stop offset="100%" stopColor="#8b5e3c" />
                </linearGradient>
              </defs>
            </svg>
            {ripples
              .filter((r) => r.note === note)
              .map((r) => (
                <div key={r.id} className="bell-ripple" />
              ))}
          </div>
          <span className="note-label">{label}</span>
        </div>
      ))}
    </div>
  );
}
