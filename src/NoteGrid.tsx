import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ScaleType } from './SoundEngine';

export interface Note {
  row: number;
  col: number;
  active: boolean;
}

export type OnNoteAddCallback = 
  | ((note: Note) => void)
  | ((pitchIndex: number, beatPosition?: number) => void);

export interface NoteGridProps {
  onNoteAdd: OnNoteAddCallback;
  onClear?: () => void;
  onPlayPause?: (isPlaying: boolean) => void;
  onBPMChange?: (bpm: number) => void;
  onScaleChange?: (scale: ScaleType) => void;
  onRecordToggle?: (isRecording: boolean) => void;
  isPlaying?: boolean;
  currentBPM?: number;
  currentScale?: ScaleType;
  isRecording?: boolean;
  notes?: Note[];
  currentBeat?: number;
  maxPitch?: number;
  maxBeats?: number;
  scale?: ScaleType;
}

const SCALE_OPTIONS: { value: ScaleType; label: string }[] = [
  { value: 'major', label: 'C大调' },
  { value: 'minor', label: 'A小调' },
  { value: 'pentatonic', label: '五声音阶' },
];

const NOTE_NAMES = ['C5', 'B4', 'A4', 'G4', 'F4', 'E4', 'D4', 'C4'];
const ROWS = 8;
const COLS = 16;

export const NoteGrid: React.FC<NoteGridProps> = ({
  onNoteAdd,
  onClear,
  onPlayPause,
  onBPMChange,
  onScaleChange,
  onRecordToggle,
  isPlaying = false,
  currentBPM = 120,
  currentScale = 'major',
  isRecording = false,
  notes = [],
  currentBeat = -1,
  maxPitch = ROWS,
  maxBeats = COLS,
  scale: scaleProp,
}) => {
  const initialScale = scaleProp || currentScale;
  const actualRows = Math.min(maxPitch, ROWS);
  const actualCols = Math.min(maxBeats, COLS);
  
  const [bpm, setBpm] = useState(currentBPM);
  const [scale, setScale] = useState<ScaleType>(initialScale);
  const [playing, setPlaying] = useState(isPlaying);
  const [recording, setRecording] = useState(isRecording);
  const [gridNotes, setGridNotes] = useState<Note[]>(notes);
  const [beatFlash, setBeatFlash] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<'add' | 'remove' | null>(null);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const beatIntervalRef = useRef<number | null>(null);
  const beatTimeoutRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setBpm(currentBPM);
  }, [currentBPM]);

  useEffect(() => {
    setScale(initialScale);
  }, [initialScale]);

  useEffect(() => {
    setPlaying(isPlaying);
  }, [isPlaying]);

  useEffect(() => {
    setRecording(isRecording);
  }, [isRecording]);

  useEffect(() => {
    setGridNotes(notes);
  }, [notes]);

  const callOnNoteAdd = useCallback((note: Note) => {
    const callback = onNoteAdd as OnNoteAddCallback;
    try {
      if (callback.length === 1) {
        (callback as (note: Note) => void)(note);
      } else {
        const pitchIndex = actualRows - 1 - note.row;
        (callback as (pitchIndex: number, beatPosition?: number) => void)(pitchIndex, note.col);
      }
    } catch (e) {
      const pitchIndex = actualRows - 1 - note.row;
      (callback as (pitchIndex: number, beatPosition?: number) => void)(pitchIndex, note.col);
    }
  }, [onNoteAdd, actualRows]);

  const getFrequency = useCallback((row: number, scaleType: ScaleType): number => {
    const baseFrequencies: Record<ScaleType, number[]> = {
      major: [523.25, 493.88, 440.00, 392.00, 349.23, 329.63, 293.66, 261.63],
      minor: [523.25, 493.88, 440.00, 392.00, 349.23, 329.63, 293.66, 220.00],
      pentatonic: [523.25, 493.88, 440.00, 392.00, 349.23, 329.63, 293.66, 261.63],
    };
    return baseFrequencies[scaleType][row] || 440;
  }, []);

  const playNote = useCallback((row: number) => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      
      const ctx = audioContextRef.current;
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      oscillator.frequency.value = getFrequency(row, scale);
      oscillator.type = 'sine';
      
      const now = ctx.currentTime;
      gainNode.gain.setValueAtTime(0.3, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      
      oscillator.start(now);
      oscillator.stop(now + 0.3);
    } catch (e) {
      console.warn('Audio playback failed:', e);
    }
  }, [scale, getFrequency]);

  const isNoteActive = useCallback((row: number, col: number): boolean => {
    return gridNotes.some(n => n.row === row && n.col === col && n.active);
  }, [gridNotes]);

  const toggleNote = useCallback((row: number, col: number, mode?: 'add' | 'remove') => {
    const currentlyActive = isNoteActive(row, col);
    const shouldBeActive = mode ? mode === 'add' : !currentlyActive;
    
    if (currentlyActive === shouldBeActive) return;

    const newNote: Note = { row, col, active: shouldBeActive };
    setGridNotes(prev => {
      const filtered = prev.filter(n => !(n.row === row && n.col === col));
      return shouldBeActive ? [...filtered, newNote] : filtered;
    });
    
    if (shouldBeActive) {
      playNote(row);
      callOnNoteAdd(newNote);
    }
  }, [isNoteActive, playNote, callOnNoteAdd]);

  const handleCellMouseDown = useCallback((row: number, col: number) => {
    setIsDragging(true);
    const currentlyActive = isNoteActive(row, col);
    setDragMode(currentlyActive ? 'remove' : 'add');
    toggleNote(row, col, currentlyActive ? 'remove' : 'add');
  }, [isNoteActive, toggleNote]);

  const handleCellMouseEnter = useCallback((row: number, col: number) => {
    if (isDragging && dragMode) {
      toggleNote(row, col, dragMode);
    }
  }, [isDragging, dragMode, toggleNote]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragMode(null);
  }, []);

  useEffect(() => {
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseUp]);

  const handlePlayPause = useCallback(() => {
    const newPlaying = !playing;
    setPlaying(newPlaying);
    if (onPlayPause) {
      onPlayPause(newPlaying);
    }
  }, [playing, onPlayPause]);

  const handleBPMChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newBPM = parseInt(e.target.value, 10);
    setBpm(newBPM);
    if (onBPMChange) {
      onBPMChange(newBPM);
    }
  }, [onBPMChange]);

  const handleScaleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newScale = e.target.value as ScaleType;
    setScale(newScale);
    if (onScaleChange) {
      onScaleChange(newScale);
    }
  }, [onScaleChange]);

  const handleClear = useCallback(() => {
    setGridNotes([]);
    if (onClear) {
      onClear();
    }
  }, [onClear]);

  const handleRecordToggle = useCallback(() => {
    const newRecording = !recording;
    setRecording(newRecording);
    if (onRecordToggle) {
      onRecordToggle(newRecording);
    }
  }, [recording, onRecordToggle]);

  useEffect(() => {
    if (playing) {
      const interval = (60 / bpm) * 1000 / 4;
      
      const triggerBeat = () => {
        setBeatFlash(true);
        beatTimeoutRef.current = window.setTimeout(() => setBeatFlash(false), 100);
      };

      triggerBeat();
      beatIntervalRef.current = window.setInterval(triggerBeat, interval);
    } else {
      if (beatIntervalRef.current) {
        clearInterval(beatIntervalRef.current);
        beatIntervalRef.current = null;
      }
      if (beatTimeoutRef.current) {
        clearTimeout(beatTimeoutRef.current);
        beatTimeoutRef.current = null;
      }
      setBeatFlash(false);
    }

    return () => {
      if (beatIntervalRef.current) {
        clearInterval(beatIntervalRef.current);
      }
      if (beatTimeoutRef.current) {
        clearTimeout(beatTimeoutRef.current);
      }
    };
  }, [playing, bpm]);

  return (
    <div 
      ref={containerRef}
      className="note-grid-container"
      style={styles.container}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        
        @keyframes beatFlash {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }
        
        .control-btn:hover,
        .slider-container:hover,
        .select-container:hover {
          transform: scale(1.05);
          filter: brightness(1.2);
        }
        
        .grid-cell:hover {
          transform: scale(1.05);
          filter: brightness(1.3);
        }
        
        .beat-flash {
          animation: beatFlash 0.1s ease-in-out;
        }
        
        .recording-pulse {
          animation: pulse 1s infinite;
        }
        
        @media (max-width: 767px) {
          .note-grid-container {
            flex-direction: column-reverse !important;
          }
          
          .control-panel {
            flex-direction: row !important;
            width: 100% !important;
            padding: 16px !important;
            overflow-x: auto !important;
          }
          
          .control-panel > * {
            flex-shrink: 0 !important;
          }
          
          .grid-container {
            width: 100% !important;
          }
        }
      `}</style>
      
      <div className="control-panel" style={styles.controlPanel}>
        <button
          className="control-btn"
          onClick={handlePlayPause}
          style={{
            ...styles.controlButton,
            ...styles.playButton,
            ...(playing ? styles.activeButton : {}),
          }}
        >
          {playing ? '⏸' : '▶'}
          <span style={styles.buttonLabel}>{playing ? '暂停' : '播放'}</span>
        </button>

        <div className="slider-container" style={styles.sliderContainer}>
          <div style={styles.sliderLabel}>
            <span>BPM</span>
            <span 
              className={beatFlash ? 'beat-flash' : ''}
              style={{
                ...styles.bpmValue,
                ...(beatFlash ? { color: '#a855f7' } : {}),
              }}
            >
              {bpm}
            </span>
          </div>
          <input
            type="range"
            min="60"
            max="180"
            value={bpm}
            onChange={handleBPMChange}
            style={styles.slider}
          />
          <div style={styles.sliderMarks}>
            <span>60</span>
            <span>120</span>
            <span>180</span>
          </div>
        </div>

        <div className="select-container" style={styles.selectContainer}>
          <label style={styles.selectLabel}>音阶</label>
          <select
            value={scale}
            onChange={handleScaleChange}
            style={styles.select}
          >
            {SCALE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <button
          className="control-btn"
          onClick={handleClear}
          style={{
            ...styles.controlButton,
            ...styles.clearButton,
          }}
        >
          🗑
          <span style={styles.buttonLabel}>清除</span>
        </button>

        <button
          className={`control-btn ${recording ? 'recording-pulse' : ''}`}
          onClick={handleRecordToggle}
          style={{
            ...styles.controlButton,
            ...styles.recordButton,
            ...(recording ? styles.recordingActive : {}),
          }}
        >
          ●
          <span style={styles.buttonLabel}>
            {recording ? '录制中' : '录制'}
          </span>
        </button>
      </div>

      <div className="grid-container" style={styles.gridContainer}>
        <div style={styles.noteLabels}>
          {NOTE_NAMES.slice(0, actualRows).map((name, idx) => (
            <div key={idx} style={styles.noteLabel}>
              {name}
            </div>
          ))}
        </div>
        
        <div 
          className="grid-wrapper"
          style={styles.gridWrapper}
        >
          <div 
            className="grid"
            style={{
              ...styles.grid,
              gridTemplateColumns: `repeat(${actualCols}, 1fr)`,
              gridTemplateRows: `repeat(${actualRows}, 1fr)`,
            }}
          >
            {Array.from({ length: actualRows }).map((_, row) =>
              Array.from({ length: actualCols }).map((_, col) => {
                const isActive = isNoteActive(row, col);
                const isCurrentBeat = col === currentBeat;
                const isStrongBeat = col % 4 === 0;
                
                return (
                  <div
                    key={`${row}-${col}`}
                    className={`grid-cell ${isActive ? 'active' : ''}`}
                    style={{
                      ...styles.gridCell,
                      ...(isActive ? styles.activeCell : {}),
                      ...(isCurrentBeat ? styles.currentBeatCell : {}),
                      ...(isStrongBeat ? styles.strongBeatCell : {}),
                    }}
                    onMouseDown={() => handleCellMouseDown(row, col)}
                    onMouseEnter={() => handleCellMouseEnter(row, col)}
                  />
                );
              })
            )}
          </div>
          
          <div style={{
            ...styles.beatNumbers,
            gridTemplateColumns: `repeat(${actualCols}, 1fr)`,
          }}>
            {Array.from({ length: actualCols }).map((_, i) => (
              <div
                key={i}
                style={{
                  ...styles.beatNumber,
                  ...(i % 4 === 0 ? styles.strongBeatNumber : {}),
                }}
              >
                {i + 1}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: '24px',
    padding: '24px',
    background: 'linear-gradient(135deg, #1a0a2e 0%, #16082a 50%, #0d0518 100%)',
    borderRadius: '16px',
    minHeight: '500px',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    userSelect: 'none',
  },

  controlPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    padding: '24px',
    background: 'rgba(255, 255, 255, 0.08)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: '8px',
    boxShadow: '0 4px 30px rgba(0, 0, 0, 0.5)',
    minWidth: '180px',
    transition: 'all 0.3s ease',
  },

  controlButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '14px 20px',
    fontSize: '18px',
    fontWeight: '600',
    color: '#fff',
    background: 'rgba(255, 255, 255, 0.08)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: '8px',
    boxShadow: '0 4px 30px rgba(0, 0, 0, 0.5)',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },

  playButton: {
    background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(168, 85, 247, 0.3))',
  },

  activeButton: {
    background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.6), rgba(168, 85, 247, 0.6))',
    boxShadow: '0 0 20px rgba(168, 85, 247, 0.5)',
  },

  clearButton: {
    background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(220, 38, 38, 0.2))',
  },

  recordButton: {
    background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.3), rgba(220, 38, 38, 0.3))',
  },

  recordingActive: {
    background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.7), rgba(220, 38, 38, 0.7))',
    boxShadow: '0 0 20px rgba(239, 68, 68, 0.6)',
  },

  buttonLabel: {
    fontSize: '14px',
    fontWeight: '500',
  },

  sliderContainer: {
    padding: '16px',
    background: 'rgba(255, 255, 255, 0.08)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: '8px',
    boxShadow: '0 4px 30px rgba(0, 0, 0, 0.5)',
    transition: 'all 0.2s ease',
  },

  sliderLabel: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: '14px',
    fontWeight: '500',
  },

  bpmValue: {
    fontSize: '20px',
    fontWeight: '700',
    color: '#a855f7',
    transition: 'all 0.1s ease',
  },

  slider: {
    width: '100%',
    height: '6px',
    WebkitAppearance: 'none',
    appearance: 'none',
    background: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '3px',
    outline: 'none',
    cursor: 'pointer',
  } as React.CSSProperties,

  sliderMarks: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: '8px',
    fontSize: '11px',
    color: 'rgba(255, 255, 255, 0.4)',
  },

  selectContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '16px',
    background: 'rgba(255, 255, 255, 0.08)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: '8px',
    boxShadow: '0 4px 30px rgba(0, 0, 0, 0.5)',
    transition: 'all 0.2s ease',
  },

  selectLabel: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: '14px',
    fontWeight: '500',
  },

  select: {
    padding: '10px 12px',
    fontSize: '14px',
    color: '#fff',
    background: 'rgba(0, 0, 0, 0.3)',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '6px',
    outline: 'none',
    cursor: 'pointer',
  },

  gridContainer: {
    display: 'flex',
    flex: 1,
    gap: '12px',
    minWidth: 0,
  },

  noteLabels: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    paddingTop: '0',
  },

  noteLabel: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '40px',
    fontSize: '12px',
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.6)',
    background: 'rgba(255, 255, 255, 0.05)',
    borderRadius: '4px',
    minWidth: '48px',
  },

  gridWrapper: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    minWidth: 0,
  },

  grid: {
    display: 'grid',
    gap: '4px',
    background: 'rgba(0, 0, 0, 0.3)',
    padding: '12px',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    flex: 1,
    minHeight: '360px',
  },

  gridCell: {
    background: 'rgba(255, 255, 255, 0.06)',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    minHeight: '30px',
  },

  activeCell: {
    background: 'linear-gradient(135deg, #a855f7, #8b5cf6)',
    boxShadow: '0 0 15px rgba(168, 85, 247, 0.6)',
    border: '1px solid rgba(168, 85, 247, 0.8)',
  },

  currentBeatCell: {
    boxShadow: 'inset 0 0 0 2px rgba(168, 85, 247, 0.8)',
  },

  strongBeatCell: {
    background: 'rgba(255, 255, 255, 0.1)',
  },

  beatNumbers: {
    display: 'grid',
    gridTemplateColumns: `repeat(${COLS}, 1fr)`,
    gap: '4px',
    padding: '0 12px',
  },

  beatNumber: {
    textAlign: 'center',
    fontSize: '10px',
    color: 'rgba(255, 255, 255, 0.3)',
    fontWeight: '500',
  },

  strongBeatNumber: {
    color: 'rgba(168, 85, 247, 0.6)',
    fontWeight: '700',
  },
};

export default NoteGrid;
