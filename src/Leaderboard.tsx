import { useState, useEffect, useRef } from 'react';
import type { PlayerScore } from './types';

interface LeaderboardProps {
  avatars: string[];
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function getRankClass(index: number): string {
  if (index === 0) return 'rank-1';
  if (index === 1) return 'rank-2';
  if (index === 2) return 'rank-3';
  return 'rank-other';
}

function getRankBadge(index: number): string {
  if (index === 0) return '🥇';
  if (index === 1) return '🥈';
  if (index === 2) return '🥉';
  return `${index + 1}`;
}

export default function Leaderboard({ avatars }: LeaderboardProps) {
  const [data, setData] = useState<PlayerScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [fadePhase, setFadePhase] = useState<'enter' | 'idle' | 'exit'>('enter');
  const displayDataRef = useRef<PlayerScore[]>([]);
  const lastDataRef = useRef<PlayerScore[]>([]);
  const rafRef = useRef<number>();

  const fetchLeaderboard = async (isInitial = false) => {
    try {
      const res = await fetch('/api/leaderboard');
      const newData: PlayerScore[] = await res.json();

      const dataChanged = JSON.stringify(newData) !== JSON.stringify(lastDataRef.current);

      if (dataChanged) {
        lastDataRef.current = newData;

        if (isInitial) {
          displayDataRef.current = newData;
          setData(newData);
          setFadePhase('enter');
        } else {
          setFadePhase('exit');
          if (rafRef.current) cancelAnimationFrame(rafRef.current);

          rafRef.current = requestAnimationFrame(() => {
            setTimeout(() => {
              displayDataRef.current = newData;
              setData(newData);
              setFadePhase('enter');
            }, 300);
          }, 0);
        }
      }
    } catch (err) {
      console.error('获取排行榜失败:', err);
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaderboard(true);
    const interval = setInterval(() => fetchLeaderboard(false), 5000);
    return () => {
      clearInterval(interval);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const displayData = displayDataRef.current;

  if (loading) {
    return (
      <div className="leaderboard-container">
        <div className="loading-container">
          <div className="spinner" />
          <p className="loading-text">正在加载排行榜...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="leaderboard-container">
      <div className="leaderboard-header">
        <h2 className="leaderboard-title">🏆 排行榜</h2>
        <p className="leaderboard-subtitle">每5秒自动刷新 · 显示前10名玩家</p>
      </div>

      <div className="leaderboard-card">
        {displayData.length === 0 ? (
          <div className="empty-state">
            <div className="empty-emoji">🎯</div>
            <p className="empty-text">暂无玩家记录，成为第一个上榜的人吧！</p>
          </div>
        ) : (
          <div className="leaderboard-table">
            <div className="leaderboard-thead">
              <div style={{ display: 'table-row' }}>
                <div className="leaderboard-th rank">排名</div>
                <div className="leaderboard-th player">玩家</div>
                <div className="leaderboard-th score">分数</div>
                <div className="leaderboard-th time">用时</div>
              </div>
            </div>
            <div
              className={`leaderboard-tbody ${
                fadePhase === 'enter' ? 'fade-enter' : fadePhase === 'exit' ? 'fade-exit' : ''
              }`}
              style={{ opacity: fadePhase === 'idle' ? 1 : undefined }}
              onAnimationEnd={() => {
                if (fadePhase === 'enter') setFadePhase('idle');
              }}
            >
              {displayData.map((player, index) => (
                <div
                  key={`${player.nickname}-${index}`}
                  className={`leaderboard-tr ${getRankClass(index)}`}
                >
                  <div className="leaderboard-td rank">
                    {getRankBadge(index)}
                  </div>
                  <div className="leaderboard-td">
                    <div className="player-info">
                      <div className="player-avatar">
                        {avatars[player.avatar] || avatars[0]}
                      </div>
                      <span className="player-name">{player.nickname}</span>
                    </div>
                  </div>
                  <div className="leaderboard-td score">
                    {player.score}
                  </div>
                  <div className="leaderboard-td time">
                    {formatTime(player.timeInSeconds)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
