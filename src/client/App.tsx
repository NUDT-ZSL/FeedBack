import React, { useState, useCallback, useEffect, useMemo } from 'react';
import StudentPanel from './components/StudentPanel';
import TeacherDashboard from './components/TeacherDashboard';
import { useWebSocket } from './hooks/useWebSocket';
import { createRoom, joinRoom, formatTimestamp, getFeedbackItemBackground } from './api';
import { Danmaku } from './types';

type Role = 'student' | 'teacher' | null;

const App: React.FC = () => {
  const [role, setRole] = useState<Role>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomInput, setRoomInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  const { currentPoll, danmakuEnabled, blockedWords, danmakuStream, isConnected } = useWebSocket(roomId);

  const handleCreateRoom = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await createRoom();
      setRoomId(response.roomId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建房间失败');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleJoinRoom = useCallback(async () => {
    const trimmedInput = roomInput.trim().toUpperCase();
    if (!trimmedInput) {
      setError('请输入课堂码');
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      await joinRoom(trimmedInput);
      setRoomId(trimmedInput);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加入房间失败');
    } finally {
      setIsLoading(false);
    }
  }, [roomInput]);

  const handleSelectRole = useCallback((selectedRole: Role) => {
    setRole(selectedRole);
    setRoomId(null);
    setRoomInput('');
    setError(null);
  }, []);

  const handleBackToEntry = useCallback(() => {
    setRole(null);
    setRoomId(null);
    setRoomInput('');
    setError(null);
    setIsPanelOpen(false);
  }, []);

  useEffect(() => {
    if (role === 'teacher' && !roomId) {
      handleCreateRoom();
    }
  }, [role, roomId, handleCreateRoom]);

  const filteredDanmaku = useMemo(() => {
    return danmakuStream.filter(d => {
      return !blockedWords.some(word => d.text.includes(word));
    });
  }, [danmakuStream, blockedWords]);

  const renderEntryScreen = () => (
    <div className="entry-screen">
      <h1>课堂实时互动工具</h1>
      {error && <div className="error-message">{error}</div>}
      
      <div className="role-buttons">
        <button
          className={`role-btn ${role === 'student' ? 'active' : ''}`}
          onClick={() => handleSelectRole('student')}
        >
          学生端
        </button>
        <button
          className={`role-btn ${role === 'teacher' ? 'active' : ''}`}
          onClick={() => handleSelectRole('teacher')}
        >
          教师端
        </button>
      </div>

      {role === 'student' && (
        <div className="room-input">
          <input
            type="text"
            placeholder="输入6位课堂码"
            value={roomInput}
            onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
            maxLength={6}
            onKeyDown={(e) => e.key === 'Enter' && handleJoinRoom()}
          />
          <button
            className="enter-btn"
            onClick={handleJoinRoom}
            disabled={isLoading || roomInput.length !== 6}
          >
            {isLoading ? '加入中...' : '进入课堂'}
          </button>
        </div>
      )}

      {role === 'teacher' && isLoading && (
        <div className="loading">正在创建课堂...</div>
      )}
    </div>
  );

  const renderFeedbackPanel = () => (
    <>
      <div
        className={`panel-overlay ${isPanelOpen ? 'active' : ''}`}
        onClick={() => setIsPanelOpen(false)}
      />
      <div className={`feedback-panel ${isPanelOpen ? 'open' : ''}`}>
        <h3>实时反馈</h3>
        <div className="feedback-list">
          {filteredDanmaku.slice(-10).reverse().map((danmaku: Danmaku) => (
            <div
              key={danmaku.id}
              className="feedback-item"
              style={{ backgroundColor: getFeedbackItemBackground(danmaku.text) }}
            >
              <div className="feedback-time">
                {formatTimestamp(danmaku.timestamp)}
              </div>
              <div>{danmaku.text}</div>
            </div>
          ))}
          {filteredDanmaku.length === 0 && (
            <div style={{ color: '#666', textAlign: 'center', padding: '20px' }}>
              暂无弹幕
            </div>
          )}
        </div>
      </div>
    </>
  );

  if (!role || !roomId) {
    return renderEntryScreen();
  }

  return (
    <div className="app-container">
      <div className="main-content">
        {role === 'student' ? (
          <StudentPanel
            roomId={roomId}
            currentPoll={currentPoll}
            danmakuEnabled={danmakuEnabled}
            blockedWords={blockedWords}
            isConnected={isConnected}
            danmakuStream={danmakuStream}
            onBack={handleBackToEntry}
          />
        ) : (
          <TeacherDashboard
            roomId={roomId}
            currentPoll={currentPoll}
            danmakuEnabled={danmakuEnabled}
            blockedWords={blockedWords}
            isConnected={isConnected}
            onBack={handleBackToEntry}
          />
        )}
      </div>

      <button
        className="hamburger-btn"
        onClick={() => setIsPanelOpen(!isPanelOpen)}
      >
        {isPanelOpen ? '✕' : '☰'}
      </button>

      {renderFeedbackPanel()}
    </div>
  );
};

export default App;
