import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { audioEngine, midiToNoteName, type InstrumentType } from './AudioEngine';

export interface Note {
  id: string;
  trackId: string;
  pitch: number;
  start: number;
  duration: number;
}

export interface Track {
  id: string;
  name: string;
  instrument: InstrumentType;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
}

export interface User {
  id: string;
  name: string;
  color: string;
  cursorPosition?: { trackId: string; time: number };
}

interface TimelineProps {
  tracks: Track[];
  notes: Note[];
  bpm: number;
  users: User[];
  currentUserId: string;
  isPlaying: boolean;
  playheadTime: number;
  selectedNoteIds: string[];
  onNotesChange: (notes: Note[]) => void;
  onNoteAdd: (note: Note) => void;
  onNoteUpdate: (note: Note) => void;
  onNoteDelete: (noteId: string) => void;
  onNotesBatchUpdate: (notes: Note[]) => void;
  onSelectionChange: (noteIds: string[]) => void;
  onTrackUpdate: (track: Track) => void;
  onBpmUpdate: (bpm: number) => void;
  onCursorMove: (position: { trackId: string; time: number }) => void;
}

const GRID_WIDTH = 20;
const NOTE_HEIGHT = 20;
const TRACK_HEADER_WIDTH = 200;
const TIMELINE_HEIGHT = 400;
const MIN_PITCH = 48;
const MAX_PITCH = 84;
const TOTAL_PITCHES = MAX_PITCH - MIN_PITCH + 1;
const TOTAL_BEATS = 64;

export const Timeline: React.FC<TimelineProps> = ({
  tracks,
  notes,
  bpm,
  users,
  currentUserId,
  isPlaying,
  playheadTime,
  selectedNoteIds,
  onNotesChange,
  onNoteAdd,
  onNoteUpdate,
  onNoteDelete,
  onNotesBatchUpdate,
  onSelectionChange,
  onTrackUpdate,
  onBpmUpdate,
  onCursorMove,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<'select' | 'move' | 'create' | 'resize'>('select');
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragCurrent, setDragCurrent] = useState({ x: 0, y: 0 });
  const [selectedTrackId, setSelectedTrackId] = useState<string>(tracks[0]?.id || '');
  const [dragNoteStartNotes, setDragNoteStartNotes] = useState<Note[]>([]);
  const [resizeNote, setResizeNote] = useState<Note | null>(null);

  const totalWidth = TOTAL_BEATS * 4 * GRID_WIDTH;
  const totalHeight = TOTAL_PITCHES * NOTE_HEIGHT;

  const tracksWithNotes = useMemo(() => {
    return tracks.map(track => ({
      ...track,
      notes: notes.filter(n => n.trackId === track.id)
    }));
  }, [tracks, notes]);

  const getPositionFromEvent = useCallback((e: React.MouseEvent | MouseEvent) => {
    if (!timelineRef.current) return null;
    const rect = timelineRef.current.getBoundingClientRect();
    const scrollLeft = scrollContainerRef.current?.scrollLeft || 0;
    const x = e.clientX - rect.left + scrollLeft;
    const y = e.clientY - rect.top;
    return { x, y };
  }, []);

  const snapToGrid = useCallback((value: number) => {
    return Math.round(value / GRID_WIDTH) * GRID_WIDTH;
  }, []);

  const getPitchFromY = useCallback((y: number) => {
    return MAX_PITCH - Math.floor(y / NOTE_HEIGHT);
  }, []);

  const getTimeFromX = useCallback((x: number) => {
    return Math.floor(snapToGrid(x) / GRID_WIDTH);
  }, []);

  const getTrackFromY = useCallback((y: number) => {
    const trackIndex = Math.floor(y / totalHeight);
    return tracks[trackIndex] || null;
  }, [tracks, totalHeight]);

  const getNoteAtPosition = useCallback((x: number, y: number, trackId: string) => {
    const pitch = getPitchFromY(y % totalHeight);
    const time = getTimeFromX(x);
    return notes.find(n =>
      n.trackId === trackId &&
      n.pitch === pitch &&
      time >= n.start &&
      time < n.start + n.duration
    );
  }, [notes, getPitchFromY, getTimeFromX, totalHeight]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!timelineRef.current) return;
    const pos = getPositionFromEvent(e);
    if (!pos) return;

    const track = getTrackFromY(pos.y);
    if (!track) return;

    const trackY = pos.y % totalHeight;
    const note = getNoteAtPosition(pos.x, pos.y, track.id);

    if (e.button === 0) {
      if (note) {
        if (!selectedNoteIds.includes(note.id)) {
          if (e.shiftKey) {
            onSelectionChange([...selectedNoteIds, note.id]);
          } else {
            onSelectionChange([note.id]);
          }
        }

        const noteRight = (note.start + note.duration) * GRID_WIDTH;
        if (Math.abs(pos.x - noteRight) < 6) {
          setDragMode('resize');
          setResizeNote(note);
        } else {
          setDragMode('move');
          setDragNoteStartNotes(notes.filter(n => selectedNoteIds.includes(n.id)));
        }
        setIsDragging(true);
        setDragStart({ x: pos.x, y: pos.y });
        setDragCurrent({ x: pos.x, y: pos.y });
      } else {
        setSelectedTrackId(track.id);
        setDragMode('create');
        setIsDragging(true);
        setDragStart({ x: snapToGrid(pos.x), y: pos.y });
        setDragCurrent({ x: snapToGrid(pos.x), y: pos.y });
      }
    }

    audioEngine.resume();
  }, [getPositionFromEvent, getTrackFromY, getNoteAtPosition, selectedNoteIds, onSelectionChange, notes, snapToGrid, totalHeight]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    const pos = getPositionFromEvent(e);
    if (!pos) return;

    setDragCurrent({ x: pos.x, y: pos.y });

    if (dragMode === 'move' && dragNoteStartNotes.length > 0) {
      const dx = Math.round((pos.x - dragStart.x) / GRID_WIDTH) * GRID_WIDTH;
      const dy = Math.round((pos.y - dragStart.y) / NOTE_HEIGHT) * NOTE_HEIGHT;
      const pitchDelta = Math.round(-dy / NOTE_HEIGHT);
      const timeDelta = Math.round(dx / GRID_WIDTH);

      const updatedNotes = dragNoteStartNotes.map(note => ({
        ...note,
        pitch: Math.max(MIN_PITCH, Math.min(MAX_PITCH, note.pitch + pitchDelta)),
        start: Math.max(0, note.start + timeDelta)
      }));

      onNotesBatchUpdate(updatedNotes);
    } else if (dragMode === 'resize' && resizeNote) {
      const newDuration = Math.max(1, Math.round((pos.x - resizeNote.start * GRID_WIDTH) / GRID_WIDTH));
      onNoteUpdate({ ...resizeNote, duration: newDuration });
    }
  }, [isDragging, dragMode, dragStart, dragNoteStartNotes, resizeNote, getPositionFromEvent, onNotesBatchUpdate, onNoteUpdate]);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    const pos = getPositionFromEvent(e);
    if (!pos) {
      setIsDragging(false);
      return;
    }

    if (dragMode === 'create') {
      const track = getTrackFromY(pos.y);
      if (track) {
        const trackY = pos.y % totalHeight;
        const pitch = getPitchFromY(trackY);
        const startX = Math.min(dragStart.x, pos.x);
        const endX = Math.max(dragStart.x, pos.x);
        const start = getTimeFromX(startX);
        const duration = Math.max(1, Math.round((endX - startX) / GRID_WIDTH));

        if (pitch >= MIN_PITCH && pitch <= MAX_PITCH && start >= 0) {
          const newNote: Note = {
            id: uuidv4(),
            trackId: track.id,
            pitch,
            start,
            duration
          };
          onNoteAdd(newNote);
          onSelectionChange([newNote.id]);
          audioEngine.playNote(track.id, track.instrument, pitch, duration * (60 / bpm / 4));
        }
      }
    }

    if (dragMode === 'select') {
      const left = Math.min(dragStart.x, dragCurrent.x);
      const right = Math.max(dragStart.x, dragCurrent.x);
      const top = Math.min(dragStart.y, dragCurrent.y);
      const bottom = Math.max(dragStart.y, dragCurrent.y);

      const selected: string[] = [];
      notes.forEach(note => {
        const noteLeft = note.start * GRID_WIDTH;
        const noteRight = (note.start + note.duration) * GRID_WIDTH;
        const trackIndex = tracks.findIndex(t => t.id === note.trackId);
        const noteTop = trackIndex * totalHeight + (MAX_PITCH - note.pitch) * NOTE_HEIGHT;
        const noteBottom = noteTop + NOTE_HEIGHT;

        if (noteRight > left && noteLeft < right && noteBottom > top && noteTop < bottom) {
          selected.push(note.id);
        }
      });

      if (selected.length > 0) {
        onSelectionChange(selected);
      }
    }

    setIsDragging(false);
    setDragMode('select');
    setDragNoteStartNotes([]);
    setResizeNote(null);
  }, [isDragging, dragMode, dragStart, dragCurrent, getPositionFromEvent, getTrackFromY, getPitchFromY, getTimeFromX, tracks, notes, onNoteAdd, onSelectionChange, bpm, totalHeight]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedNoteIds.length > 0) {
        selectedNoteIds.forEach(id => onNoteDelete(id));
        onSelectionChange([]);
      }
    }
  }, [selectedNoteIds, onNoteDelete, onSelectionChange]);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleMouseMove, handleMouseUp, handleKeyDown]);

  const handleNoteClick = (note: Note, track: Track, e: React.MouseEvent) => {
    e.stopPropagation();
    audioEngine.resume();
    audioEngine.playNote(track.id, track.instrument, note.pitch, note.duration * (60 / bpm / 4));
  };

  const renderPianoRoll = (track: Track) => {
    const trackNotes = notes.filter(n => n.trackId === track.id);
    const pianoKeys = [];

    for (let i = MAX_PITCH; i >= MIN_PITCH; i--) {
      const noteName = midiToNoteName(i);
      const isBlackKey = noteName.includes('#');
      pianoKeys.push(
        <div
          key={i}
          className={`piano-key ${isBlackKey ? 'black' : 'white'}`}
          style={{ height: NOTE_HEIGHT }}
        >
          {!isBlackKey && <span className="key-label">{noteName}</span>}
        </div>
      );
    }

    return pianoKeys;
  };

  const renderGrid = (track: Track) => {
    const lines = [];
    for (let i = 0; i <= TOTAL_BEATS * 4; i++) {
      const isBeat = i % 4 === 0;
      lines.push(
        <div
          key={`v-${i}`}
          className={`grid-line vertical ${isBeat ? 'beat' : ''}`}
          style={{ left: i * GRID_WIDTH }}
        />
      );
    }
    for (let i = 0; i <= TOTAL_PITCHES; i++) {
      lines.push(
        <div
          key={`h-${i}`}
          className="grid-line horizontal"
          style={{ top: i * NOTE_HEIGHT }}
        />
      );
    }
    return lines;
  };

  const renderNotes = (track: Track) => {
    const trackNotes = notes.filter(n => n.trackId === track.id);

    return trackNotes.map(note => {
      const isSelected = selectedNoteIds.includes(note.id);
      const y = (MAX_PITCH - note.pitch) * NOTE_HEIGHT;

      return (
        <div
          key={note.id}
          className={`note-block ${isSelected ? 'selected' : ''} ${track.instrument}`}
          style={{
            left: note.start * GRID_WIDTH,
            top: y,
            width: note.duration * GRID_WIDTH,
            height: NOTE_HEIGHT - 2,
            backgroundColor: track.instrument === 'piano' ? '#e94560' :
                             track.instrument === 'guitar' ? '#16c79a' : '#f39c12',
            borderColor: isSelected ? '#ffd700' : 'rgba(255,255,255,0.3)'
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => handleNoteClick(note, track, e)}
        >
          <div className="note-resize-handle" />
        </div>
      );
    });
  };

  const renderPlayhead = () => {
    if (!isPlaying) return null;
    const x = playheadTime * GRID_WIDTH;

    return (
      <div
        className="playhead"
        style={{
          left: x,
          height: tracks.length * totalHeight
        }}
      />
    );
  };

  const renderSelectionBox = () => {
    if (!isDragging || dragMode !== 'select') return null;

    const left = Math.min(dragStart.x, dragCurrent.x);
    const top = Math.min(dragStart.y, dragCurrent.y);
    const width = Math.abs(dragCurrent.x - dragStart.x);
    const height = Math.abs(dragCurrent.y - dragStart.y);

    return (
      <div
        className="selection-box"
        style={{ left, top, width, height }}
      />
    );
  };

  const renderUserCursors = () => {
    return users
      .filter(u => u.id !== currentUserId && u.cursorPosition)
      .map(user => {
        if (!user.cursorPosition) return null;
        const trackIndex = tracks.findIndex(t => t.id === user.cursorPosition!.trackId);
        if (trackIndex === -1) return null;
        const x = user.cursorPosition.time * GRID_WIDTH;
        const y = trackIndex * totalHeight;

        return (
          <div
            key={user.id}
            className="user-cursor"
            style={{
              left: x,
              top: y,
              height: totalHeight,
              borderColor: user.color
            }}
          >
            <div className="cursor-label" style={{ backgroundColor: user.color }}>
              {user.name}
            </div>
          </div>
        );
      });
  };

  return (
    <div className="timeline-container">
      <div className="track-header" style={{ width: TRACK_HEADER_WIDTH }}>
        <div className="track-info-top">
          <span>音轨</span>
        </div>
        {tracks.map(track => (
          <div key={track.id} className="track-header-item" style={{ height: totalHeight }}>
            <div className="track-header-content">
              <div className="track-name">{track.name}</div>
              <div className="track-controls">
                <div className="volume-control">
                  <label>音量</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={track.volume}
                    onChange={(e) => {
                      const newVolume = parseFloat(e.target.value);
                      onTrackUpdate({ ...track, volume: newVolume });
                      audioEngine.setTrackVolume(track.id, newVolume);
                    }}
                  />
                </div>
                <div className="pan-control">
                  <label>声像</label>
                  <input
                    type="range"
                    min="-1"
                    max="1"
                    step="0.01"
                    value={track.pan}
                    onChange={(e) => {
                      const newPan = parseFloat(e.target.value);
                      onTrackUpdate({ ...track, pan: newPan });
                      audioEngine.setTrackPan(track.id, newPan);
                    }}
                  />
                </div>
                <div className="track-buttons">
                  <button
                    className={`btn-mute ${track.muted ? 'active' : ''}`}
                    onClick={() => onTrackUpdate({ ...track, muted: !track.muted })}
                  >
                    M
                  </button>
                  <button
                    className={`btn-solo ${track.solo ? 'active' : ''}`}
                    onClick={() => onTrackUpdate({ ...track, solo: !track.solo })}
                  >
                    S
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="timeline-scroll" ref={scrollContainerRef}>
        <div className="time-ruler" style={{ width: totalWidth }}>
          {Array.from({ length: TOTAL_BEATS + 1 }).map((_, i) => (
            <div key={i} className="time-marker" style={{ left: i * 4 * GRID_WIDTH }}>
              {i + 1}
            </div>
          ))}
        </div>

        <div
          className="timeline-content"
          ref={timelineRef}
          onMouseDown={handleMouseDown}
          style={{ width: totalWidth, height: tracks.length * totalHeight }}
        >
          {tracks.map((track, trackIndex) => (
            <div
              key={track.id}
              className={`track-lane ${track.muted ? 'muted' : ''}`}
              style={{ top: trackIndex * totalHeight, height: totalHeight }}
            >
              {renderGrid(track)}
              {renderNotes(track)}
            </div>
          ))}

          {renderPlayhead()}
          {renderSelectionBox()}
          {renderUserCursors()}
        </div>
      </div>

      <style>{`
        .timeline-container {
          display: flex;
          flex: 1;
          overflow: hidden;
          background: #0f3460;
        }

        .track-header {
          background: #0f3460;
          border-right: 2px solid #1a1a2e;
          flex-shrink: 0;
          overflow: hidden;
        }

        .track-info-top {
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #0a2240;
          color: #8892b0;
          font-size: 12px;
          font-weight: 600;
          border-bottom: 1px solid #1a1a2e;
        }

        .track-header-item {
          display: flex;
          align-items: center;
          padding: 0 12px;
          border-bottom: 1px solid #1a1a2e;
          box-sizing: border-box;
        }

        .track-header-content {
          width: 100%;
        }

        .track-name {
          font-size: 14px;
          font-weight: 600;
          color: #e6f1ff;
          margin-bottom: 8px;
        }

        .track-controls {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .volume-control, .pan-control {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          color: #8892b0;
        }

        .volume-control label, .pan-control label {
          width: 30px;
          flex-shrink: 0;
        }

        .volume-control input, .pan-control input {
          flex: 1;
          height: 4px;
          -webkit-appearance: none;
          appearance: none;
          background: #1a1a2e;
          border-radius: 2px;
          outline: none;
          cursor: pointer;
        }

        .volume-control input::-webkit-slider-thumb,
        .pan-control input::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #e94560;
          cursor: pointer;
          transition: transform 0.2s ease;
        }

        .volume-control input::-webkit-slider-thumb:hover,
        .pan-control input::-webkit-slider-thumb:hover {
          transform: scale(1.2);
        }

        .track-buttons {
          display: flex;
          gap: 6px;
          margin-top: 4px;
        }

        .btn-mute, .btn-solo {
          width: 24px;
          height: 24px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 11px;
          font-weight: 700;
          transition: all 0.2s ease;
          background: #1a1a2e;
          color: #8892b0;
        }

        .btn-mute:hover, .btn-solo:hover {
          background: #162447;
        }

        .btn-mute.active {
          background: #e94560;
          color: white;
        }

        .btn-solo.active {
          background: #f39c12;
          color: white;
        }

        .timeline-scroll {
          flex: 1;
          overflow-x: auto;
          overflow-y: auto;
        }

        .timeline-scroll::-webkit-scrollbar {
          height: 12px;
          width: 12px;
        }

        .timeline-scroll::-webkit-scrollbar-track {
          background: #0f3460;
        }

        .timeline-scroll::-webkit-scrollbar-thumb {
          background: #1a1a2e;
          border-radius: 6px;
        }

        .timeline-scroll::-webkit-scrollbar-thumb:hover {
          background: #162447;
        }

        .time-ruler {
          height: 30px;
          background: #0a2240;
          position: relative;
          border-bottom: 1px solid #1a1a2e;
          flex-shrink: 0;
        }

        .time-marker {
          position: absolute;
          top: 0;
          height: 100%;
          display: flex;
          align-items: center;
          padding-left: 4px;
          font-size: 11px;
          color: #8892b0;
          font-weight: 600;
        }

        .timeline-content {
          position: relative;
          cursor: crosshair;
        }

        .track-lane {
          position: absolute;
          left: 0;
          right: 0;
          border-bottom: 2px solid #1a1a2e;
        }

        .track-lane.muted {
          opacity: 0.5;
        }

        .grid-line {
          position: absolute;
          background: rgba(255, 255, 255, 0.05);
        }

        .grid-line.vertical {
          width: 1px;
          height: 100%;
          top: 0;
        }

        .grid-line.vertical.beat {
          background: rgba(255, 255, 255, 0.1);
          width: 1px;
        }

        .grid-line.horizontal {
          height: 1px;
          width: 100%;
          left: 0;
        }

        .note-block {
          position: absolute;
          border-radius: 3px;
          border: 1px solid rgba(255, 255, 255, 0.3);
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
          opacity: 0;
          animation: fadeInNote 0.2s ease forwards;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        }

        @keyframes fadeInNote {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }

        .note-block:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.4);
        }

        .note-block.selected {
          box-shadow: 0 0 0 2px #ffd700, 0 4px 8px rgba(0, 0, 0, 0.4);
          z-index: 10;
        }

        .note-resize-handle {
          position: absolute;
          right: 0;
          top: 0;
          width: 6px;
          height: 100%;
          cursor: ew-resize;
          background: rgba(255, 255, 255, 0.2);
          border-radius: 0 3px 3px 0;
        }

        .playhead {
          position: absolute;
          top: 0;
          width: 2px;
          background: #ff4444;
          z-index: 100;
          pointer-events: none;
          box-shadow: 0 0 10px rgba(255, 68, 68, 0.5);
        }

        .selection-box {
          position: absolute;
          border: 1px dashed #ffd700;
          background: rgba(255, 215, 0, 0.15);
          pointer-events: none;
          z-index: 50;
        }

        .user-cursor {
          position: absolute;
          top: 0;
          width: 2px;
          border-left: 2px solid;
          pointer-events: none;
          z-index: 20;
        }

        .cursor-label {
          position: absolute;
          top: -20px;
          left: -1px;
          padding: 2px 6px;
          font-size: 10px;
          color: white;
          border-radius: 3px;
          white-space: nowrap;
          font-weight: 600;
        }
      `}</style>
    </div>
  );
};
