import React, { useState, useCallback, useEffect } from 'react';
import { audioEngine } from './audioEngine';

const OCTAVE_4_WHITE_KEYS = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'];
const OCTAVE_4_BLACK_KEYS = ['C#4', 'D#4', 'F#4', 'G#4', 'A#4'];
const OCTAVE_5_WHITE_KEYS = ['C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5'];
const OCTAVE_5_BLACK_KEYS = ['C#5', 'D#5', 'F#5', 'G#5', 'A#5'];

const ALL_WHITE_KEYS = [...OCTAVE_4_WHITE_KEYS, ...OCTAVE_5_WHITE_KEYS];
const ALL_BLACK_KEYS = [...OCTAVE_4_BLACK_KEYS, ...OCTAVE_5_BLACK_KEYS];

const BLACK_KEY_POSITIONS: Record<string, number> = {
  'C#4': 0, 'D#4': 1, 'F#4': 3, 'G#4': 4, 'A#4': 5,
  'C#5': 7, 'D#5': 8, 'F#5': 10, 'G#5': 11, 'A#5': 12,
};

interface PianoKeyboardProps {
  onNoteAdd: (note: string, frequency: number) => void;
  highlightNote?: string | null;
}

const PianoKeyboard: React.FC<PianoKeyboardProps> = ({ onNoteAdd, highlightNote }) => {
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 600);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const whiteKeyWidth = isMobile ? Math.max(30, 50 * 0.6) : 50;
  const blackKeyWidth = isMobile ? 30 * 0.6 : 30;
  const whiteKeyHeight = isMobile ? 100 : 150;
  const blackKeyHeight = isMobile ? 60 : 90;

  const triggerKey = useCallback((note: string) => {
    audioEngine.resume();
    audioEngine.playNote(note, 0.3);
    
    setActiveKeys(prev => new Set(prev).add(note));
    setTimeout(() => {
      setActiveKeys(prev => {
        const next = new Set(prev);
        next.delete(note);
        return next;
      });
    }, 150);

    const frequency = audioEngine.getFrequency(note);
    onNoteAdd(note, frequency);
  }, [onNoteAdd]);

  useEffect(() => {
    if (highlightNote) {
      setActiveKeys(prev => new Set(prev).add(highlightNote));
      const timer = setTimeout(() => {
        setActiveKeys(prev => {
          const next = new Set(prev);
          next.delete(highlightNote);
          return next;
        });
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [highlightNote]);

  const totalWhiteKeys = ALL_WHITE_KEYS.length;
  const keyboardWidth = totalWhiteKeys * whiteKeyWidth;

  return (
    <div
      style={{
        backgroundColor: '#3D3D5C',
        padding: '20px',
        borderRadius: '8px',
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: keyboardWidth,
          height: whiteKeyHeight,
          userSelect: 'none',
        }}
      >
        {ALL_WHITE_KEYS.map((note, index) => {
          const isActive = activeKeys.has(note);
          return (
            <div
              key={note}
              onClick={() => triggerKey(note)}
              style={{
                position: 'absolute',
                left: index * whiteKeyWidth,
                width: whiteKeyWidth - 2,
                height: whiteKeyHeight,
                backgroundColor: isActive ? '#FFD700' : '#FFFFFF',
                border: '1px solid #888',
                borderRadius: '0 0 6px 6px',
                cursor: 'pointer',
                transition: 'background-color 0.15s ease, transform 0.2s ease',
                boxShadow: isActive 
                  ? 'inset 0 -4px 8px rgba(0,0,0,0.2)' 
                  : '0 2px 4px rgba(0,0,0,0.3)',
              }}
              onMouseEnter={(e) => {
                if (e.buttons === 1) {
                  triggerKey(note);
                }
              }}
              title={note}
            >
              <span
                style={{
                  position: 'absolute',
                  bottom: '8px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  fontSize: isMobile ? '9px' : '11px',
                  color: '#666',
                  pointerEvents: 'none',
                }}
              >
                {note}
              </span>
            </div>
          );
        })}

        {ALL_BLACK_KEYS.map((note) => {
          const whiteKeyIndex = BLACK_KEY_POSITIONS[note];
          const isActive = activeKeys.has(note);
          if (whiteKeyIndex === undefined) return null;
          
          return (
            <div
              key={note}
              onClick={() => triggerKey(note)}
              style={{
                position: 'absolute',
                left: (whiteKeyIndex + 1) * whiteKeyWidth - blackKeyWidth / 2,
                width: blackKeyWidth,
                height: blackKeyHeight,
                backgroundColor: isActive ? '#FFD700' : '#1A1A2E',
                borderRadius: '0 0 4px 4px',
                cursor: 'pointer',
                zIndex: 10,
                transition: 'background-color 0.15s ease',
                boxShadow: isActive
                  ? 'inset 0 -2px 4px rgba(0,0,0,0.4)'
                  : '0 2px 4px rgba(0,0,0,0.5)',
              }}
              onMouseEnter={(e) => {
                if (e.buttons === 1) {
                  triggerKey(note);
                }
              }}
              title={note}
            />
          );
        })}
      </div>
    </div>
  );
};

export default PianoKeyboard;
