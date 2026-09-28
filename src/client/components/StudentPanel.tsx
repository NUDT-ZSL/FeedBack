import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Poll, Danmaku } from '../types';
import { submitVote, submitDanmaku, getDanmakuStyle, getRandomDanmakuDuration } from '../api';

interface StudentPanelProps {
  roomId: string;
  currentPoll: Poll | null;
  danmakuEnabled: boolean;
  blockedWords: string[];
  isConnected: boolean;
  danmakuStream: Danmaku[];
  onBack: () => void;
}

const StudentPanel: React.FC<StudentPanelProps> = ({
  roomId,
  currentPoll,
  danmakuEnabled,
  blockedWords,
  danmakuStream,
  onBack
}) => {
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [danmakuInput, setDanmakuInput] = useState('');
  const [hasVoted, setHasVoted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeDanmaku, setActiveDanmaku] = useState<Array<{
    id: string;
    text: string;
    style: { color: string; backgroundColor: string };
    top: number;
    duration: number;
    createdAt: number;
  }>>([]);

  const danmakuContainerRef = useRef<HTMLDivElement>(null);
  const danmakuIdCounter = useRef(0);
  const lastDanmakuIdRef = useRef<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setActiveDanmaku(prev => prev.filter(d => now - d.createdAt < d.duration * 1000 + 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const latestDanmaku = danmakuStream[danmakuStream.length - 1];
    if (latestDanmaku && latestDanmaku.id !== lastDanmakuIdRef.current) {
      lastDanmakuIdRef.current = latestDanmaku.id;
      
      const containsBlocked = blockedWords.some(word => latestDanmaku.text.includes(word));
      if (containsBlocked) return;

      const style = getDanmakuStyle();
      const duration = getRandomDanmakuDuration();
      const top = Math.random() * 100;

      const newDanmaku = {
        id: `ws-${latestDanmaku.id}`,
        text: latestDanmaku.text,
        style,
        top,
        duration,
        createdAt: Date.now()
      };

      setActiveDanmaku(prev => [...prev, newDanmaku]);
    }
  }, [danmakuStream, blockedWords]);

  useEffect(() => {
    setSelectedOptions([]);
    setHasVoted(false);
  }, [currentPoll?.id]);

  const handleOptionClick = useCallback((optionId: string) => {
    if (hasVoted || !currentPoll?.isActive) return;

    if (currentPoll.type === 'single') {
      setSelectedOptions([optionId]);
    } else {
      setSelectedOptions(prev =>
        prev.includes(optionId)
          ? prev.filter(id => id !== optionId)
          : [...prev, optionId]
      );
    }
  }, [hasVoted, currentPoll]);

  const handleSubmitVote = useCallback(async () => {
    if (!currentPoll || selectedOptions.length === 0 || hasVoted) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await submitVote({
        roomId,
        pollId: currentPoll.id,
        optionIds: selectedOptions,
      });
      setHasVoted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setIsSubmitting(false);
    }
  }, [roomId, currentPoll, selectedOptions, hasVoted]);

  const containsBlockedWord = useCallback((text: string): boolean => {
    return blockedWords.some(word => text.includes(word));
  }, [blockedWords]);

  const handleSendDanmaku = useCallback(async () => {
    const text = danmakuInput.trim();
    if (!text || !danmakuEnabled) return;

    if (containsBlockedWord(text)) {
      setError('消息包含屏蔽词，无法发送');
      setTimeout(() => setError(null), 2000);
      return;
    }

    setError(null);
    try {
      const style = getDanmakuStyle();
      const duration = getRandomDanmakuDuration();
      const top = Math.random() * 100;

      const localDanmaku = {
        id: `local-${danmakuIdCounter.current++}`,
        text,
        style,
        top,
        duration,
        createdAt: Date.now()
      };

      setActiveDanmaku(prev => [...prev, localDanmaku]);

      await submitDanmaku({ roomId, text });
      setDanmakuInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败');
    }
  }, [danmakuInput, danmakuEnabled, roomId, containsBlockedWord]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendDanmaku();
    }
  }, [handleSendDanmaku]);

  const visibleDanmaku = useMemo(() => {
    return activeDanmaku.filter(d => !blockedWords.some(word => d.text.includes(word)));
  }, [activeDanmaku, blockedWords]);

  return (
    <div className="student-panel">
      <div className="room-header">
        <div>
          <h2>学生端</h2>
          <span className="room-code">{roomId}</span>
        </div>
        <button className="control-btn" onClick={onBack}>
          退出
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="danmaku-container" ref={danmakuContainerRef}>
        {visibleDanmaku.map(danmaku => (
          <div
            key={danmaku.id}
            className="danmaku-item"
            style={{
              color: danmaku.style.color,
              backgroundColor: danmaku.style.backgroundColor,
              top: `${danmaku.top}%`,
              animationDuration: `${danmaku.duration}s`,
            }}
          >
            {danmaku.text}
          </div>
        ))}
      </div>

      {currentPoll && currentPoll.isActive && (
        <div className="poll-card">
          <h3>{currentPoll.type === 'single' ? '单选投票' : '多选投票'}</h3>
          <div className="poll-title">{currentPoll.title}</div>
          
          <div className="poll-options">
            {currentPoll.options.map(option => (
              <div
                key={option.id}
                className={`poll-option ${selectedOptions.includes(option.id) ? 'selected' : ''} ${hasVoted ? 'disabled' : ''}`}
                onClick={() => handleOptionClick(option.id)}
              >
                {option.text}
                {hasVoted && (
                  <div style={{ marginTop: '8px', fontSize: '12px', opacity: 0.7 }}>
                    {option.votes} 票
                  </div>
                )}
              </div>
            ))}
          </div>

          {!hasVoted ? (
            <button
              className="submit-vote-btn"
              onClick={handleSubmitVote}
              disabled={selectedOptions.length === 0 || isSubmitting}
            >
              {isSubmitting ? '提交中...' : '提交投票'}
            </button>
          ) : (
            <div style={{ marginTop: '16px', color: '#27ae60' }}>
              ✓ 已提交投票
            </div>
          )}
        </div>
      )}

      <div className="danmaku-input-container">
        <input
          type="text"
          className="danmaku-input"
          placeholder={danmakuEnabled ? '发送弹幕...' : '弹幕已关闭'}
          value={danmakuInput}
          onChange={(e) => setDanmakuInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!danmakuEnabled}
          maxLength={50}
        />
        <button
          className="send-danmaku-btn"
          onClick={handleSendDanmaku}
          disabled={!danmakuEnabled || !danmakuInput.trim()}
        >
          发送
        </button>
      </div>
    </div>
  );
};

export default StudentPanel;
