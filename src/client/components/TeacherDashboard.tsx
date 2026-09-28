import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Poll } from '../types';
import {
  createPoll,
  toggleDanmaku,
  getWordCloud,
  blockWord,
  unblockWord,
  getWordColor,
} from '../api';
import WordCloud from 'wordcloud';

interface TeacherDashboardProps {
  roomId: string;
  currentPoll: Poll | null;
  danmakuEnabled: boolean;
  blockedWords: string[];
  isConnected: boolean;
  onBack: () => void;
}

const TeacherDashboard: React.FC<TeacherDashboardProps> = ({
  roomId,
  currentPoll,
  danmakuEnabled,
  blockedWords,
  onBack
}) => {
  const [showPollModal, setShowPollModal] = useState(false);
  const [pollTitle, setPollTitle] = useState('');
  const [pollType, setPollType] = useState<'single' | 'multiple'>('single');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wordCloudData, setWordCloudData] = useState<Array<[string, number]>>([]);

  const chartCanvasRef = useRef<HTMLCanvasElement>(null);
  const wordcloudCanvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const targetVotesRef = useRef<number[]>([]);
  const currentVotesRef = useRef<number[]>([]);
  const animationStartTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!currentPoll) return;

    targetVotesRef.current = currentPoll.options.map(o => o.votes);
    
    if (currentVotesRef.current.length !== currentPoll.options.length) {
      currentVotesRef.current = currentPoll.options.map(() => 0);
    }
    
    animationStartTimeRef.current = null;
    
    if (chartCanvasRef.current) {
      animateChart();
    }
  }, [currentPoll?.options.map(o => o.votes).join(',')]);

  const animateChart = useCallback(() => {
    if (!chartCanvasRef.current || !currentPoll) return;

    const canvas = chartCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const padding = { top: 30, right: 30, bottom: 60, left: 50 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const animate = (timestamp: number) => {
      if (animationStartTimeRef.current === null) {
        animationStartTimeRef.current = timestamp;
      }

      const elapsed = timestamp - animationStartTimeRef.current;
      const duration = 300;
      const progress = Math.min(elapsed / duration, 1);
      const easeProgress = 1 - Math.pow(1 - progress, 3);

      currentVotesRef.current = targetVotesRef.current.map((target, i) => {
        const start = currentVotesRef.current[i] || 0;
        return start + (target - start) * easeProgress;
      });

      ctx.clearRect(0, 0, width, height);

      ctx.fillStyle = '#16213e';
      ctx.fillRect(0, 0, width, height);

      const maxVotes = Math.max(...targetVotesRef.current, 1);
      const barCount = currentPoll.options.length;
      const barWidth = (chartWidth / barCount) * 0.7;
      const barGap = (chartWidth / barCount) * 0.3;

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = padding.top + (chartHeight / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();

        ctx.fillStyle = '#888';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'right';
        const value = Math.round((maxVotes / 4) * (4 - i));
        ctx.fillText(value.toString(), padding.left - 10, y + 4);
      }

      currentPoll.options.forEach((option, index) => {
        const x = padding.left + index * (barWidth + barGap) + barGap / 2;
        const barHeight = (currentVotesRef.current[index] / maxVotes) * chartHeight;
        const y = padding.top + chartHeight - barHeight;

        const gradient = ctx.createLinearGradient(x, y, x, y + barHeight);
        gradient.addColorStop(0, '#e94560');
        gradient.addColorStop(1, '#f5a623');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 4);
        ctx.fill();

        ctx.fillStyle = '#eee';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        
        const optionText = option.text.length > 8 
          ? option.text.substring(0, 8) + '...' 
          : option.text;
        ctx.fillText(optionText, x + barWidth / 2, height - padding.bottom + 20);

        const votes = Math.round(currentVotesRef.current[index]);
        if (votes > 0) {
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 12px sans-serif';
          ctx.fillText(votes.toString(), x + barWidth / 2, y - 8);
        }
      });

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(padding.left, padding.top);
      ctx.lineTo(padding.left, height - padding.bottom);
      ctx.lineTo(width - padding.right, height - padding.bottom);
      ctx.stroke();

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);
  }, [currentPoll]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!roomId) return;

    const fetchWordCloud = async () => {
      try {
        const data = await getWordCloud(roomId);
        const sortedData = data
          .sort((a, b) => b.count - a.count)
          .slice(0, 30)
          .map(item => [item.word, item.count] as [string, number]);
        setWordCloudData(sortedData);
      } catch (err) {
        console.error('Failed to fetch word cloud:', err);
      }
    };

    fetchWordCloud();
    const interval = setInterval(fetchWordCloud, 5000);

    return () => clearInterval(interval);
  }, [roomId]);

  const handleWordCloudItemClick = useCallback(async (item: [string, number]) => {
    const word = item[0];
    if (!roomId || blockedWords.includes(word)) return;

    try {
      await blockWord(roomId, word);
    } catch (err) {
      console.error('Failed to block word:', err);
    }
  }, [roomId, blockedWords]);

  useEffect(() => {
    if (!wordcloudCanvasRef.current || wordCloudData.length === 0) return;

    const canvas = wordcloudCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const startTime = performance.now();

    WordCloud(canvas, {
      list: wordCloudData,
      gridSize: 8,
      weightFactor: (size: number) => {
        const minSize = 12;
        const maxSize = 48;
        const maxCount = Math.max(...wordCloudData.map(d => d[1]), 1);
        const normalized = size / maxCount;
        return (minSize + normalized * (maxSize - minSize)) * dpr;
      },
      fontFamily: 'sans-serif',
      color: getWordColor,
      rotateRatio: 0,
      backgroundColor: '#ffffff',
      drawOutOfBound: false,
      shrinkToFit: true,
      click: (item: [string, number]) => {
        handleWordCloudItemClick(item);
      },
    });

    const renderTime = performance.now() - startTime;
    if (renderTime > 500) {
      console.warn(`Word cloud render took ${renderTime}ms, exceeding 500ms target`);
    }
  }, [wordCloudData, handleWordCloudItemClick]);

  const handleAddOption = useCallback(() => {
    if (pollOptions.length < 6) {
      setPollOptions(prev => [...prev, '']);
    }
  }, [pollOptions.length]);

  const handleRemoveOption = useCallback((index: number) => {
    if (pollOptions.length > 2) {
      setPollOptions(prev => prev.filter((_, i) => i !== index));
    }
  }, [pollOptions.length]);

  const handleOptionChange = useCallback((index: number, value: string) => {
    setPollOptions(prev => prev.map((opt, i) => i === index ? value : opt));
  }, []);

  const handleCreatePoll = useCallback(async () => {
    const validOptions = pollOptions.filter(o => o.trim());
    if (!pollTitle.trim() || validOptions.length < 2) {
      setError('请输入投票标题和至少2个选项');
      return;
    }

    setIsCreating(true);
    setError(null);
    try {
      await createPoll({
        roomId,
        title: pollTitle.trim(),
        type: pollType,
        options: validOptions,
      });
      setShowPollModal(false);
      setPollTitle('');
      setPollType('single');
      setPollOptions(['', '']);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建投票失败');
    } finally {
      setIsCreating(false);
    }
  }, [roomId, pollTitle, pollType, pollOptions]);

  const handleToggleDanmaku = useCallback(async () => {
    try {
      await toggleDanmaku(roomId, !danmakuEnabled);
    } catch (err) {
      console.error('Failed to toggle danmaku:', err);
    }
  }, [roomId, danmakuEnabled]);

  const handleUnblockWord = useCallback(async (word: string) => {
    try {
      await unblockWord(roomId, word);
    } catch (err) {
      console.error('Failed to unblock word:', err);
    }
  }, [roomId]);

  return (
    <div className="teacher-dashboard">
      <div className="room-header">
        <div>
          <h2>教师控制台</h2>
          <span className="room-code">{roomId}</span>
        </div>
        <div className="teacher-controls">
          <button
            className={`control-btn ${danmakuEnabled ? 'active' : ''}`}
            onClick={handleToggleDanmaku}
          >
            {danmakuEnabled ? '弹幕开启' : '弹幕关闭'}
          </button>
          <button
            className="control-btn active"
            onClick={() => setShowPollModal(true)}
          >
            发起投票
          </button>
          <button className="control-btn" onClick={onBack}>
            退出
          </button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {currentPoll && (
        <div className="chart-container">
          <h3>
            {currentPoll.title}
            <span style={{ fontSize: '14px', color: '#888', marginLeft: '12px' }}>
              {currentPoll.type === 'single' ? '单选' : '多选'} · 
              共 {currentPoll.options.reduce((sum, o) => sum + o.votes, 0)} 票
            </span>
          </h3>
          <canvas
            ref={chartCanvasRef}
            className="chart-canvas"
          />
        </div>
      )}

      <div className="wordcloud-container">
        <h3>实时词云</h3>
        <div className="wordcloud-canvas-wrapper">
          <canvas
            ref={wordcloudCanvasRef}
            className="wordcloud-canvas"
          />
        </div>
        
        {blockedWords.length > 0 && (
          <div className="blocked-words">
            <span style={{ color: '#888', fontSize: '12px' }}>已屏蔽：</span>
            {blockedWords.map(word => (
              <span key={word} className="blocked-word-tag">
                {word}
                <button onClick={() => handleUnblockWord(word)}>×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {showPollModal && (
        <div className="create-poll-modal" onClick={(e) => e.target === e.currentTarget && setShowPollModal(false)}>
          <div className="modal-content">
            <h3>创建新投票</h3>
            
            <div className="form-group">
              <label>投票标题</label>
              <input
                type="text"
                value={pollTitle}
                onChange={(e) => setPollTitle(e.target.value)}
                placeholder="请输入投票标题"
                maxLength={100}
              />
            </div>

            <div className="form-group">
              <label>投票类型</label>
              <select
                value={pollType}
                onChange={(e) => setPollType(e.target.value as 'single' | 'multiple')}
              >
                <option value="single">单选</option>
                <option value="multiple">多选</option>
              </select>
            </div>

            <div className="form-group">
              <label>选项（{pollOptions.length}/6）</label>
              {pollOptions.map((option, index) => (
                <div key={index} className="option-input-row">
                  <input
                    type="text"
                    value={option}
                    onChange={(e) => handleOptionChange(index, e.target.value)}
                    placeholder={`选项 ${index + 1}`}
                    maxLength={50}
                  />
                  {pollOptions.length > 2 && (
                    <button onClick={() => handleRemoveOption(index)}>×</button>
                  )}
                </div>
              ))}
              {pollOptions.length < 6 && (
                <button className="add-option-btn" onClick={handleAddOption}>
                  + 添加选项
                </button>
              )}
            </div>

            <div className="modal-actions">
              <button className="cancel-btn" onClick={() => setShowPollModal(false)}>
                取消
              </button>
              <button
                className="confirm-btn"
                onClick={handleCreatePoll}
                disabled={isCreating}
              >
                {isCreating ? '创建中...' : '发布投票'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeacherDashboard;
