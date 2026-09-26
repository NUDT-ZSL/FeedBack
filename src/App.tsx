import React, { useState, useEffect, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Timeline } from './components/Timeline';
import type { Note, Track, User } from './components/Timeline';
import { audioEngine, type InstrumentType } from './components/AudioEngine';

type View = 'home' | 'studio';

interface ProjectState {
  id: string;
  name: string;
  bpm: number;
  tracks: Track[];
  notes: Note[];
  users: User[];
};

function App() {
  const [view, setView] = useState<View>('home');
  const [projectId, setProjectId] = useState<string>('');
  const [joinCode, setJoinCode] = useState<string>('');
  const [userName, setUserName] = useState<string>('');
  const [project, setProject] = useState<ProjectState | null>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadTime, setPlayheadTime] = useState(0);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const startPlayheadRef = useRef<number>(0);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const uid = localStorage.getItem('userId') || uuidv4();
    localStorage.setItem('userId', uid);
    setCurrentUserId(uid);

    const savedName = localStorage.getItem('userName') || '';
    setUserName(savedName);
  }, []);

  const createProject = async () => {
    try {
      const res = await fetch('/api/projects', { method: 'POST' });
      const data = await res.json();
      setProjectId(data.projectId);
      joinProject(data.projectId);
    } catch (e) {
      console.error('创建项目失败:', e);
    }
  };

  const joinProject = async (code: string) => {
    const codeUpper = code.toUpperCase().trim();
    if (!codeUpper) return;

    if (!userName.trim()) {
      const defaultName = '用户' + Math.floor(Math.random() * 1000);
      setUserName(defaultName);
      localStorage.setItem('userName', defaultName);
    }

    try {
      const res = await fetch(`/api/projects/${codeUpper}`);
      if (!res.ok) {
        alert('项目不存在！');
        return;
      }
      const data = await res.json();

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      const websocket = new WebSocket(wsUrl);
      wsRef.current = websocket;
      setWs(websocket);

      websocket.onopen = () => {
        websocket.send(JSON.stringify({
          type: 'JOIN_PROJECT',
          payload: {
            projectId: codeUpper,
            userName: userName || '匿名用户'
          }
        }));
      };

      websocket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
      };

      websocket.onclose = () => {
        console.log('WebSocket 连接已关闭');
      };

      setProjectId(codeUpper);
      setView('studio');

      audioEngine.init().then(() => {
        data.tracks.forEach((track: Track) => {
          audioEngine.setupTrack(track.id, track.volume, track.pan);
        });
      });

    } catch (e) {
      console.error('加入项目失败:', e);
      alert('加入项目失败，请检查网络连接');
    }
  };

  const handleWebSocketMessage = useCallback((message: any) => {
    const { type, payload } = message;

    switch (type) {
      case 'PROJECT_STATE':
        setProject(payload);
        break;
      case 'NOTE_ADDED':
        setProject(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            notes: [...prev.notes, payload.note]
          };
        });
        break;
      case 'NOTE_UPDATED':
        setProject(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            notes: prev.notes.map(n =>
              n.id === payload.note.id ? { ...n, ...payload.note } : n
            )
          };
        });
        break;
      case 'NOTE_DELETED':
        setProject(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            notes: prev.notes.filter(n => n.id !== payload.noteId)
          };
        });
        break;
      case 'NOTES_BATCH_UPDATED':
        setProject(prev => {
          if (!prev) return prev;
          const updatedIds = new Set(payload.notes.map((n: Note) => n.id));
          return {
            ...prev,
            notes: prev.notes.map(n => {
              if (updatedIds.has(n.id)) {
                const updated = payload.notes.find((u: Note) => u.id === n.id);
                return { ...n, ...updated };
              }
              return n;
            })
          };
        });
        break;
      case 'TRACK_UPDATED':
        setProject(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            tracks: prev.tracks.map(t =>
              t.id === payload.track.id ? { ...t, ...payload.track } : t
            )
          };
        });
        break;
      case 'BPM_UPDATED':
        setProject(prev => {
          if (!prev) return prev;
          return { ...prev, bpm: payload.bpm };
        });
        break;
      case 'USERS_UPDATE':
        setProject(prev => {
          if (!prev) return prev;
          return { ...prev, users: payload.users };
        });
        break;
      case 'CURSOR_MOVED':
        setProject(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            users: prev.users.map(u =>
              u.id === payload.userId
                ? { ...u, cursorPosition: payload.position }
                : u
            )
          };
        });
        break;
      case 'USER_JOINED':
        break;
      case 'USER_LEFT':
        setProject(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            users: prev.users.filter(u => u.id !== payload.userId)
          };
        });
        break;
    }
  }, []);

  const sendMessage = useCallback((type: string, payload: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    }
  }, []);

  const handleNoteAdd = useCallback((note: Note) => {
    setProject(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        notes: [...prev.notes, note]
      };
    });
    sendMessage('NOTE_ADDED', { note });
  }, [sendMessage]);

  const handleNoteUpdate = useCallback((note: Note) => {
    setProject(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        notes: prev.notes.map(n => n.id === note.id ? { ...n, ...note } : n)
      };
    });
    sendMessage('NOTE_UPDATED', { note });
  }, [sendMessage]);

  const handleNoteDelete = useCallback((noteId: string) => {
    setProject(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        notes: prev.notes.filter(n => n.id !== noteId)
      };
    });
    sendMessage('NOTE_DELETED', { noteId });
  }, [sendMessage]);

  const handleNotesBatchUpdate = useCallback((notes: Note[]) => {
    setProject(prev => {
      if (!prev) return prev;
      const noteMap = new Map(notes.map(n => [n.id, n]));
      return {
        ...prev,
        notes: prev.notes.map(n => {
          if (noteMap.has(n.id)) {
            return { ...n, ...noteMap.get(n.id) };
          }
          return n;
        })
      };
    });
    sendMessage('NOTES_BATCH_UPDATED', { notes });
  }, [sendMessage]);

  const handleTrackUpdate = useCallback((track: Track) => {
    setProject(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        tracks: prev.tracks.map(t => t.id === track.id ? { ...t, ...track } : t)
      };
    });
    sendMessage('TRACK_UPDATED', { track });
  }, [sendMessage]);

  const handleBpmUpdate = useCallback((bpm: number) => {
    setProject(prev => {
      if (!prev) return prev;
      return { ...prev, bpm };
    });
    sendMessage('BPM_UPDATED', { bpm });
  }, [sendMessage]);

  const handleCursorMove = useCallback((position: { trackId: string; time: number }) => {
    sendMessage('CURSOR_MOVED', { position });
  }, [sendMessage]);

  const togglePlay = useCallback(() => {
    if (!project) return;

    audioEngine.resume();

    if (isPlaying) {
      setIsPlaying(false);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      audioEngine.stopAll();
    } else {
      setIsPlaying(true);
      startTimeRef.current = audioEngine.getCurrentTime();
      startPlayheadRef.current = playheadTime;

      const beatDuration = 60 / project.bpm;
      const sixteenthDuration = beatDuration / 4;
      const scheduleAhead = 0.1;
      let lastScheduledTime = playheadTime;

      const scheduleNotes = (currentAudioTime: number, currentPlayhead: number) => {
        const endTime = currentPlayhead + scheduleAhead / sixteenthDuration;

        project.notes.forEach(note => {
          const track = project.tracks.find(t => t.id === note.trackId);
          if (!track || track.muted) return;

          const noteStartAudio = startTimeRef.current + (note.start - startPlayheadRef.current) * sixteenthDuration;
          const noteDuration = note.duration * sixteenthDuration;

          if (note.start >= lastScheduledTime && note.start < endTime && noteStartAudio > currentAudioTime - 0.05) {
            audioEngine.scheduleNote(
              note.id,
              track.id,
              track.instrument,
              note.pitch,
              noteStartAudio,
              noteDuration * 0.9
            );
          }
        });

        lastScheduledTime = endTime;
      };

      const animate = () => {
        const currentAudioTime = audioEngine.getCurrentTime();
        const elapsed = currentAudioTime - startTimeRef.current;
        const newPlayhead = startPlayheadRef.current + elapsed / sixteenthDuration;

        setPlayheadTime(newPlayhead);
        scheduleNotes(currentAudioTime, newPlayhead);

        if (newPlayhead >= 256) {
          setIsPlaying(false);
          setPlayheadTime(0);
          audioEngine.stopAll();
          return;
        }

        animationRef.current = requestAnimationFrame(animate);
      };

      animationRef.current = requestAnimationFrame(animate);
    }
  }, [isPlaying, playheadTime, project]);

  const saveProject = async () => {
    if (!project) return;
    setIsSaving(true);
    try {
      await fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project)
      });
      setTimeout(() => setIsSaving(false), 500);
    } catch (e) {
      console.error('保存失败:', e);
      setIsSaving(false);
    }
  };

  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
      audioEngine.dispose();
    };
  }, []);

  if (view === 'home') {
    return (
      <div className="home-container">
        <div className="home-content">
          <h1 className="app-title">音乐协作编曲工作室</h1>
          <p className="app-subtitle">实时协作 · 浏览器即开即用</p>

          <div className="home-actions">
            <div className="action-section">
              <button className="btn-primary" onClick={createProject}>
                创建新项目
              </button>
            </div>

            <div className="divider">
              <span>或者</span>
            </div>

            <div className="action-section">
              <input
                type="text"
                className="code-input"
                placeholder="输入6位项目代码"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                maxLength={6}
              />
              <button
                className="btn-secondary"
                onClick={() => joinProject(joinCode)}
                disabled={joinCode.length < 6}
              >
                加入项目
              </button>
            </div>
          </div>

          <div className="user-name-section">
            <label>你的昵称</label>
            <input
              type="text"
              className="name-input"
              placeholder="输入你的昵称"
              value={userName}
              onChange={(e) => {
                setUserName(e.target.value);
                localStorage.setItem('userName', e.target.value);
              }}
            />
          </div>
        </div>

        <style>{`
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a2e;
            color: #e6f1ff;
          }

          .home-container {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, #1a1a2e 0%, #0f3460 100%);
          }

          .home-content {
            text-align: center;
            padding: 60px;
            background: rgba(15, 52, 96, 0.5);
            border-radius: 16px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(233, 69, 96, 0.2);
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          }

          .app-title {
            font-size: 42px;
            font-weight: 700;
            margin-bottom: 8px;
            background: linear-gradient(135deg, #e94560, #ff6b8a);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
          }

          .app-subtitle {
            font-size: 16px;
            color: #8892b0;
            margin-bottom: 40px;
          }

          .home-actions {
            display: flex;
            flex-direction: column;
            gap: 20px;
            margin-bottom: 30px;
          }

          .action-section {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }

          .btn-primary {
            padding: 14px 40px;
            font-size: 16px;
            font-weight: 600;
            border: none;
            border-radius: 8px;
            background: linear-gradient(135deg, #e94560, #ff6b8a);
            color: white;
            cursor: pointer;
            transition: all 0.2s ease;
          }

          .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(233, 69, 96, 0.4);
          }

          .btn-secondary {
            padding: 12px 32px;
            font-size: 14px;
            font-weight: 600;
            border: 2px solid #e94560;
            border-radius: 8px;
            background: transparent;
            color: #e94560;
            cursor: pointer;
            transition: all 0.2s ease;
          }

          .btn-secondary:hover:not(:disabled) {
            background: #e94560;
            color: white;
          }

          .btn-secondary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }

          .divider {
            position: relative;
            text-align: center;
            color: #8892b0;
            font-size: 12px;
          }

          .divider::before,
          .divider::after {
            content: '';
            position: absolute;
            top: 50%;
            width: 40%;
            height: 1px;
            background: #233554;
          }

          .divider::before { left: 0; }
          .divider::after { right: 0; }

          .code-input {
            padding: 12px 16px;
            font-size: 18px;
            font-weight: 600;
            text-align: center;
            letter-spacing: 4px;
            border: 2px solid #233554;
            border-radius: 8px;
            background: #1a1a2e;
            color: #e6f1ff;
            outline: none;
            transition: border-color 0.2s ease;
            text-transform: uppercase;
          }

          .code-input:focus {
            border-color: #e94560;
          }

          .user-name-section {
            display: flex;
            flex-direction: column;
            gap: 8px;
            align-items: flex-start;
          }

          .user-name-section label {
            font-size: 12px;
            color: #8892b0;
          }

          .name-input {
            width: 100%;
            padding: 10px 14px;
            font-size: 14px;
            border: 1px solid #233554;
            border-radius: 6px;
            background: #1a1a2e;
            color: #e6f1ff;
            outline: none;
            transition: border-color 0.2s ease;
          }

          .name-input:focus {
            border-color: #e94560;
          }
        `}</style>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        <style>{`
          .loading {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #1a1a2e;
          }
          .spinner {
            width: 40px;
            height: 40px;
            border: 3px solid #233554;
            border-top-color: #e94560;
            border-radius: 50%;
            animation: spin 1s linear infinite;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="top-bar">
        <div className="top-bar-left">
          <button className="btn-back" onClick={() => {
            if (wsRef.current) wsRef.current.close();
            setView('home');
            setProject(null);
            audioEngine.stopAll();
          }}>
            ← 返回
          </button>
          <div className="project-info">
            <span className="project-name">{project.name}</span>
            <span className="project-code">代码: {project.id}</span>
          </div>
        </div>

        <div className="top-bar-center">
          <button className="btn-play" onClick={togglePlay}>
            {isPlaying ? '⏸ 暂停' : '▶ 播放'}
          </button>

          <div className="bpm-control">
            <label>BPM</label>
            <input
              type="number"
              min="60"
              max="180"
              value={project.bpm}
              onChange={(e) => {
                const val = Math.max(60, Math.min(180, parseInt(e.target.value) || 60));
                handleBpmUpdate(val);
              }}
            />
          </div>

          <button
            className={`btn-save ${isSaving ? 'saving' : ''}`}
            onClick={saveProject}
          >
            {isSaving ? '已保存 ✓' : '保存'}
          </button>
        </div>

        <div className="top-bar-right">
          <div className="user-list">
            {project.users.map(user => (
              <div
                key={user.id}
                className="user-avatar"
                style={{ backgroundColor: user.color }}
                title={user.name}
              >
                {user.name.charAt(0).toUpperCase()}
              </div>
            ))}
          </div>
        </div>
      </header>

      <div className="main-content">
        <Timeline
          tracks={project.tracks}
          notes={project.notes}
          bpm={project.bpm}
          users={project.users}
          currentUserId={currentUserId}
          isPlaying={isPlaying}
          playheadTime={playheadTime}
          selectedNoteIds={selectedNoteIds}
          onNotesChange={() => {}}
          onNoteAdd={handleNoteAdd}
          onNoteUpdate={handleNoteUpdate}
          onNoteDelete={handleNoteDelete}
          onNotesBatchUpdate={handleNotesBatchUpdate}
          onSelectionChange={setSelectedNoteIds}
          onTrackUpdate={handleTrackUpdate}
          onBpmUpdate={handleBpmUpdate}
          onCursorMove={handleCursorMove}
        />
      </div>

      <style>{`
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #1a1a2e;
          color: #e6f1ff;
          overflow: hidden;
        }

        .app-container {
          display: flex;
          flex-direction: column;
          height: 100vh;
          width: 100vw;
          background: #1a1a2e;
        }

        .top-bar {
          height: 60px;
          background: #0f3460;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 20px;
          border-bottom: 1px solid #1a1a2e;
          flex-shrink: 0;
        }

        .top-bar-left,
        .top-bar-center,
        .top-bar-right {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .btn-back {
          padding: 8px 16px;
          border: none;
          border-radius: 6px;
          background: #1a1a2e;
          color: #8892b0;
          cursor: pointer;
          font-size: 13px;
          transition: all 0.2s ease;
        }

        .btn-back:hover {
          background: #162447;
          color: #e6f1ff;
        }

        .project-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .project-name {
          font-size: 16px;
          font-weight: 600;
          color: #e6f1ff;
        }

        .project-code {
          font-size: 12px;
          color: #8892b0;
          font-family: monospace;
        }

        .btn-play {
          padding: 10px 24px;
          font-size: 14px;
          font-weight: 600;
          border: none;
          border-radius: 6px;
          background: linear-gradient(135deg, #e94560, #ff6b8a);
          color: white;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .btn-play:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(233, 69, 96, 0.4);
        }

        .bpm-control {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .bpm-control label {
          font-size: 12px;
          color: #8892b0;
        }

        .bpm-control input {
          width: 60px;
          padding: 6px 10px;
          font-size: 14px;
          font-weight: 600;
          text-align: center;
          border: 1px solid #233554;
          border-radius: 4px;
          background: #1a1a2e;
          color: #e6f1ff;
          outline: none;
        }

        .bpm-control input:focus {
          border-color: #e94560;
        }

        .btn-save {
          padding: 8px 20px;
          font-size: 13px;
          font-weight: 600;
          border: 1px solid #233554;
          border-radius: 6px;
          background: transparent;
          color: #8892b0;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .btn-save:hover {
          border-color: #e94560;
          color: #e94560;
        }

        .btn-save.saving {
          background: rgba(22, 199, 154, 0.2);
          border-color: #16c79a;
          color: #16c79a;
        }

        .user-list {
          display: flex;
          gap: -8px;
        }

        .user-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 600;
          color: white;
          border: 2px solid #0f3460;
          margin-left: -8px;
        }

        .user-avatar:first-child {
          margin-left: 0;
        }

        .main-content {
          flex: 1;
          display: flex;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}

export default App;
