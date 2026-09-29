import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { Note, Segment, PlaybackState } from './types';
import { audioEngine } from './audioEngine';
import PianoKeyboard from './keyboard';
import NotationEditor from './notationEditor';

const generateId = () => Math.random().toString(36).substring(2, 11);

const defaultSegments: Segment[] = [
  {
    id: generateId(),
    name: '默认片段',
    notes: [],
    createdAt: Date.now(),
  },
];

const App: React.FC = () => {
  const [segments, setSegments] = useState<Segment[]>(defaultSegments);
  const [activeSegmentId, setActiveSegmentId] = useState<string>(defaultSegments[0].id);
  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle');
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showNewSegmentInput, setShowNewSegmentInput] = useState(false);
  const [newSegmentName, setNewSegmentName] = useState('');
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [highlightKeyboardNote, setHighlightKeyboardNote] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  const animationFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const pauseTimeRef = useRef<number>(0);
  const scheduledNotesRef = useRef<Set<string>>(new Set());
  const newSegmentInputRef = useRef<HTMLInputElement>(null);

  const activeSegment = segments.find(s => s.id === activeSegmentId) || segments[0];
  const notes = activeSegment?.notes || [];

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 600);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (showNewSegmentInput && newSegmentInputRef.current) {
      newSegmentInputRef.current.focus();
    }
  }, [showNewSegmentInput]);

  const noteDuration = 0.5;
  const totalDuration = Math.max(2, notes.length * noteDuration + 1);

  const handleNoteAdd = useCallback((pitch: string, frequency: number) => {
    const newNote: Note = {
      id: generateId(),
      pitch,
      frequency,
      startTime: notes.length * noteDuration,
      duration: 0.5,
    };

    setSegments(prev => prev.map(seg =>
      seg.id === activeSegmentId
        ? { ...seg, notes: [...seg.notes, newNote] }
        : seg
    ));
  }, [activeSegmentId, notes.length]);

  const handlePlay = useCallback(() => {
    if (notes.length === 0) {
      toast('请先添加一些音符');
      return;
    }

    audioEngine.resume();

    if (playbackState === 'paused') {
      const offset = pauseTimeRef.current;
      startTimeRef.current = audioEngine.getCurrentTime() - offset;
    } else {
      setCurrentTime(0);
      startTimeRef.current = audioEngine.getCurrentTime();
      scheduledNotesRef.current.clear();
    }

    setPlaybackState('playing');
  }, [playbackState, notes.length]);

  const handlePause = useCallback(() => {
    setPlaybackState('paused');
    pauseTimeRef.current = currentTime;
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, [currentTime]);

  const handleStop = useCallback(() => {
    setPlaybackState('idle');
    setCurrentTime(0);
    setActiveNoteId(null);
    audioEngine.stopAll();
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    scheduledNotesRef.current.clear();
  }, []);

  useEffect(() => {
    if (playbackState !== 'playing') return;

    const tick = () => {
      const now = audioEngine.getCurrentTime();
      const elapsed = (now - startTimeRef.current) * playbackSpeed;
      setCurrentTime(elapsed);

      notes.forEach(note => {
        const noteId = `${note.id}-play`;
        if (!scheduledNotesRef.current.has(noteId) && 
            elapsed >= note.startTime && 
            elapsed < note.startTime + 0.05) {
          scheduledNotesRef.current.add(noteId);
          setActiveNoteId(note.id);
          setHighlightKeyboardNote(note.pitch);
          
          const playTime = audioEngine.getCurrentTime();
          audioEngine.playNoteAtTime(note.pitch, playTime, note.duration);

          setTimeout(() => {
            setActiveNoteId(prev => prev === note.id ? null : prev);
          }, 300);
        }
      });

      if (elapsed >= totalDuration) {
        setPlaybackState('idle');
        setCurrentTime(0);
        setActiveNoteId(null);
        audioEngine.stopAll();
        scheduledNotesRef.current.clear();
        return;
      }

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [playbackState, notes, playbackSpeed, totalDuration]);

  const handleSegmentClick = useCallback((segmentId: string) => {
    if (playbackState !== 'idle') {
      handleStop();
    }
    setActiveSegmentId(segmentId);
  }, [playbackState, handleStop]);

  const handleAddSegment = useCallback(() => {
    setShowNewSegmentInput(true);
    setNewSegmentName('');
  }, []);

  const handleCreateSegment = useCallback(() => {
    const name = newSegmentName.trim() || `片段 ${segments.length + 1}`;
    const newSegment: Segment = {
      id: generateId(),
      name,
      notes: [],
      createdAt: Date.now(),
    };
    setSegments(prev => [...prev, newSegment]);
    setActiveSegmentId(newSegment.id);
    setShowNewSegmentInput(false);
    setNewSegmentName('');
    toast.success(`已创建片段: ${name}`);
  }, [newSegmentName, segments.length]);

  const handleCancelNewSegment = useCallback(() => {
    setShowNewSegmentInput(false);
    setNewSegmentName('');
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCreateSegment();
    } else if (e.key === 'Escape') {
      handleCancelNewSegment();
    }
  }, [handleCreateSegment, handleCancelNewSegment]);

  const activeIndex = segments.findIndex(s => s.id === activeSegmentId);

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#1E1E2E',
        color: '#FFFFFF',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        padding: isMobile ? '10px' : '20px',
        gap: '16px',
        boxSizing: 'border-box',
      }}
    >
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            backgroundColor: '#2D2D44',
            color: '#fff',
            borderRadius: '8px',
          },
        }}
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: isMobile ? '20px' : '24px',
            fontWeight: 600,
            color: '#E0E0FF',
          }}
        >
          🎵 音乐灵感捕捉器
        </h1>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            backgroundColor: '#2D2D44',
            padding: '10px 16px',
            borderRadius: '8px',
          }}
        >
          <button
            onClick={playbackState === 'playing' ? handlePause : handlePlay}
            style={{
              padding: '8px 16px',
              backgroundColor: playbackState === 'playing' ? '#FF9800' : '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            {playbackState === 'playing' ? '⏸ 暂停' : '▶ 播放'}
          </button>

          <button
            onClick={handleStop}
            disabled={playbackState === 'idle'}
            style={{
              padding: '8px 16px',
              backgroundColor: playbackState === 'idle' ? '#555' : '#F44336',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: playbackState === 'idle' ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: 500,
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
                if (playbackState !== 'idle') {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
                }
              }}
            onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
          >
            ⏹ 停止
          </button>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '13px',
              color: '#AAA',
            }}
          >
            <span>速度:</span>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={playbackSpeed}
              onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
              style={{
                width: isMobile ? '60px' : '80px',
                accentColor: '#7C4DFF',
              }}
            />
            <span style={{ minWidth: '32px', textAlign: 'right' }}>
              {playbackSpeed.toFixed(1)}x
            </span>
          </div>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          minHeight: 0,
        }}
      >
        <div
          style={{
            fontSize: '14px',
            color: '#AAA',
            marginBottom: '-4px',
          }}
        >
          📝 乐谱编辑区 - {activeSegment?.name} ({notes.length} 个音符)
        </div>
        <NotationEditor
          notes={notes}
          currentTime={currentTime}
          isPlaying={playbackState === 'playing'}
          duration={totalDuration}
          activeNoteId={activeNoteId}
        />
      </div>

      <div
        style={{
          position: 'relative',
          marginTop: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: '8px',
            padding: '12px 0',
            overflowX: 'auto',
            position: 'relative',
            borderBottom: '2px solid #3D3D5C',
            marginBottom: '16px',
          }}
        >
          {segments.map((segment, index) => {
            const isActive = segment.id === activeSegmentId;
            return (
              <button
                key={segment.id}
                onClick={() => handleSegmentClick(segment.id)}
                style={{
                  position: 'relative',
                  padding: '8px 16px',
                  backgroundColor: isActive ? '#3D3D5C' : 'transparent',
                  color: isActive ? '#fff' : '#AAA',
                  border: 'none',
                  borderRadius: '8px 8px 0 0',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: isActive ? 600 : 400,
                  transition: 'all 0.2s ease',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.backgroundColor = '#33334D';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }
                }}
              >
                {segment.name}
                {isActive && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '-2px',
                      left: 0,
                      right: 0,
                      height: '3px',
                      backgroundColor: '#7C4DFF',
                      borderRadius: '2px',
                      animation: 'slideIn 0.3s ease-out',
                    }}
                  />
                )}
              </button>
            );
          })}

          <button
            onClick={handleAddSegment}
            style={{
              padding: '8px 14px',
              backgroundColor: 'transparent',
              color: '#7C4DFF',
              border: '1px dashed #7C4DFF',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              transition: 'all 0.2s ease',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#7C4DFF';
              e.currentTarget.style.color = '#fff';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = '#7C4DFF';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            + 新片段
          </button>
        </div>

        <div
          style={{
            overflow: 'hidden',
            maxHeight: showNewSegmentInput ? '60px' : '0',
            transition: 'max-height 0.25s ease-out, opacity 0.25s ease-out',
            opacity: showNewSegmentInput ? 1 : 0,
            marginBottom: showNewSegmentInput ? '12px' : '0',
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
              backgroundColor: '#2D2D44',
              padding: '10px 16px',
              borderRadius: '8px',
            }}
          >
            <input
              ref={newSegmentInputRef}
              type="text"
              value={newSegmentName}
              onChange={(e) => setNewSegmentName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入片段名称，如 '副歌旋律'"
              style={{
                flex: 1,
                padding: '8px 12px',
                backgroundColor: '#1E1E2E',
                border: '1px solid #3D3D5C',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '14px',
                outline: 'none',
              }}
            />
            <button
              onClick={handleCreateSegment}
              style={{
                padding: '8px 16px',
                backgroundColor: '#7C4DFF',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 500,
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 8px rgba(124, 77, 255, 0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              创建
            </button>
            <button
              onClick={handleCancelNewSegment}
              style={{
                padding: '8px 16px',
                backgroundColor: '#555',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              取消
            </button>
          </div>
        </div>

        <PianoKeyboard
          onNoteAdd={handleNoteAdd}
          highlightNote={highlightKeyboardNote}
        />
      </div>


    </div>
  );
};

export default App;
