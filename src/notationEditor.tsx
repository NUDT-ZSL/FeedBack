import React, { useRef, useEffect } from 'react';
import { Note } from './types';

interface NotationEditorProps {
  notes: Note[];
  currentTime: number;
  isPlaying: boolean;
  duration: number;
  onNoteClick?: (note: Note) => void;
  activeNoteId?: string | null;
}

const PITCH_ORDER = [
  'C5', 'B4', 'A#4', 'A4', 'G#4', 'G4', 'F#4', 'F4',
  'E4', 'D#4', 'D4', 'C#4', 'C4',
];

const ALL_PITCHES = [
  'B5', 'A#5', 'A5', 'G#5', 'G5', 'F#5', 'F5',
  'E5', 'D#5', 'D5', 'C#5', 'C5', 'B4', 'A#4',
  'A4', 'G#4', 'G4', 'F#4', 'F4', 'E4', 'D#4',
  'D4', 'C#4', 'C4',
];

const NOTE_SPACING = 80;
const LINE_SPACING = 40;
const PITCH_SPACING = 12;
const PADDING_TOP = 30;
const PADDING_LEFT = 20;

const NotationEditor: React.FC<NotationEditorProps> = ({
  notes,
  currentTime,
  isPlaying,
  duration,
  onNoteClick,
  activeNoteId,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<number>(0);

  const totalLines = 5;
  const staffHeight = (totalLines - 1) * LINE_SPACING;
  const totalPitchRange = (ALL_PITCHES.length - 1) * PITCH_SPACING;
  const editorHeight = totalPitchRange + PADDING_TOP * 2;
  
  const noteDuration = 0.5;
  const totalDuration = Math.max(duration, notes.length * noteDuration + 2);
  const editorWidth = totalDuration * NOTE_SPACING + PADDING_LEFT * 2;

  const getPitchY = (pitch: string): number => {
    const index = ALL_PITCHES.indexOf(pitch);
    if (index === -1) return PADDING_TOP + totalPitchRange / 2;
    return PADDING_TOP + index * PITCH_SPACING;
  };

  useEffect(() => {
    if (isPlaying && containerRef.current) {
      const progressX = PADDING_LEFT + currentTime * NOTE_SPACING;
      const containerWidth = containerRef.current.clientWidth;
      const scrollTarget = Math.max(0, progressX - containerWidth / 2);
      
      if (Math.abs(scrollTarget - scrollRef.current) > 5) {
        containerRef.current.scrollLeft = scrollTarget;
        scrollRef.current = scrollTarget;
      }
    }
  }, [currentTime, isPlaying]);

  const progressX = PADDING_LEFT + currentTime * NOTE_SPACING;

  return (
    <div
      ref={containerRef}
      style={{
        backgroundColor: '#2D2D44',
        borderRadius: '8px',
        overflowX: 'auto',
        overflowY: 'hidden',
        position: 'relative',
        height: editorHeight,
      }}
    >
      <div
        style={{
          position: 'relative',
          width: editorWidth,
          height: editorHeight,
          minWidth: '100%',
        }}
      >
        {Array.from({ length: totalLines }).map((_, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: PADDING_LEFT,
              right: PADDING_LEFT,
              top: (editorHeight - staffHeight) / 2 + i * LINE_SPACING,
              height: 1,
              borderTop: '1px dashed rgba(200, 200, 200, 0.3)',
            }}
          />
        ))}

        {notes.map((note) => {
          const x = PADDING_LEFT + note.startTime * NOTE_SPACING;
          const y = getPitchY(note.pitch);
          const isActive = activeNoteId === note.id;
          const isBlackKey = note.pitch.includes('#');

          return (
            <div
              key={note.id}
              onClick={() => onNoteClick?.(note)}
              style={{
                position: 'absolute',
                left: x,
                top: y - 10,
                width: 30,
                height: 20,
                backgroundColor: isActive 
                  ? '#FFD700' 
                  : isBlackKey 
                    ? '#1A1A2E' 
                    : '#E0E0E0',
                borderRadius: '4px',
                cursor: 'pointer',
                transform: isActive ? 'scale(1.2)' : 'scale(1)',
                transition: 'all 0.15s ease',
                boxShadow: isActive 
                  ? '0 0 10px rgba(255, 215, 0, 0.6)' 
                  : '0 1px 3px rgba(0,0,0,0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '9px',
                color: isActive ? '#333' : isBlackKey ? '#FFF' : '#333',
                fontWeight: 'bold',
                zIndex: isActive ? 5 : 1,
              }}
              title={`${note.pitch} - ${note.startTime.toFixed(2)}s`}
            >
              ♪
            </div>
          );
        })}

        <div
          style={{
            position: 'absolute',
            left: progressX,
            top: 10,
            width: 2,
            height: editorHeight - 20,
            backgroundColor: '#FF4444',
            opacity: isPlaying || currentTime > 0 ? 1 : 0,
            transition: 'opacity 0.3s ease',
            pointerEvents: 'none',
            zIndex: 10,
            boxShadow: '0 0 6px rgba(255, 68, 68, 0.6)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: -6,
              left: -4,
              width: 10,
              height: 10,
              backgroundColor: '#FF4444',
              borderRadius: '50%',
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default NotationEditor;
