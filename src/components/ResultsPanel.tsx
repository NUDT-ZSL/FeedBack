import React, { useEffect, useRef } from 'react';
import { BattleLogEntry, BattleStats, CARD_LIBRARY } from './BattleEngine';

interface ResultsPanelProps {
  progress: number;
  totalRounds: number;
  logs: BattleLogEntry[];
  stats: BattleStats | null;
  isRunning: boolean;
}

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  return `${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}`;
};

const getCardName = (cardId: string): string => {
  const card = CARD_LIBRARY.find(c => c.id === cardId);
  return card ? card.name : cardId;
};

const BarChart: React.FC<{
  title: string;
  data: Record<string, number>;
  faction: 'A' | 'B';
  maxValue?: number;
}> = ({ title, data, faction, maxValue }) => {
  const entries = Object.entries(data)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  if (entries.length === 0) {
    return (
      <div className="bar-chart">
        <div className="bar-chart-title">{title}</div>
        <div className="empty-state" style={{ padding: '20px 0' }}>暂无数据</div>
      </div>
    );
  }

  const max = maxValue || Math.max(...entries.map(([, v]) => v), 1);

  return (
    <div className="bar-chart">
      <div className="bar-chart-title">{title}</div>
      {entries.map(([cardId, value], index) => (
        <div
          key={cardId}
          className="bar-row"
          style={{ animationDelay: `${index * 0.05}s` }}
        >
          <div className="bar-label" title={getCardName(cardId)}>
            {getCardName(cardId)}
          </div>
          <div className="bar-container">
            <div
              className={`bar-fill faction-${faction.toLowerCase()}`}
              style={{ width: `${(value / max) * 100}%` }}
            />
          </div>
          <div className="bar-value">{Math.round(value)}</div>
        </div>
      ))}
    </div>
  );
};

export const ResultsPanel: React.FC<ResultsPanelProps> = ({
  progress,
  totalRounds,
  logs,
  stats,
  isRunning,
}) => {
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  const progressPercent = totalRounds > 0 ? (progress / totalRounds) * 100 : 0;

  return (
    <>
      <div className="progress-section">
        <div className="progress-label">
          <span>模拟进度</span>
          <span>{progress} / {totalRounds} 轮</span>
        </div>
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <div className="log-panel">
        <div className="log-header">
          <span className={`dot${isRunning ? '' : ''}`} style={{ background: isRunning ? 'var(--progress-start)' : 'var(--text-muted)', animation: isRunning ? undefined : 'none' }}></span>
          对战日志
        </div>
        <div className="log-content" ref={logRef}>
          {logs.length === 0 ? (
            <div className="empty-state">
              点击「开始对弈」运行模拟对战
            </div>
          ) : (
            logs.map((log, index) => (
              <div key={index} className="log-entry">
                <span className="log-time">{formatTime(log.timestamp)}</span>
                <span className={`log-player-${log.player.toLowerCase()}`}>
                  [{log.player}]
                </span>
                <span className="log-msg">{log.message}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {stats && (
        <div className="stats-section">
          <h3>📊 统计结果</h3>

          <div className="winrate-display">
            <div className="winrate-item faction-a">
              <div className="winrate-label">卡组 A 胜率</div>
              <div className="winrate-value">{stats.winRateA.toFixed(1)}%</div>
            </div>
            <div className="winrate-item faction-b">
              <div className="winrate-label">卡组 B 胜率</div>
              <div className="winrate-value">{stats.winRateB.toFixed(1)}%</div>
            </div>
          </div>

          <BarChart
            title="卡组 A - 伤害输出排名"
            data={stats.cardDamageA}
            faction="A"
          />

          <div style={{ height: '16px' }} />

          <BarChart
            title="卡组 B - 伤害输出排名"
            data={stats.cardDamageB}
            faction="B"
          />

          <div style={{ height: '16px' }} />

          <BarChart
            title="卡组 A - 使用次数"
            data={stats.cardUsageA}
            faction="A"
          />

          <div style={{ height: '16px' }} />

          <BarChart
            title="卡组 B - 使用次数"
            data={stats.cardUsageB}
            faction="B"
          />

          <div className="balance-suggestion">
            <strong>平衡性建议：</strong>
            {stats.balanceSuggestion}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px', fontSize: '12px', color: 'var(--text-muted)' }}>
            <span>平局: {stats.draws} 场</span>
            <span>A 平均剩余: {stats.avgHealthA.toFixed(1)} 血</span>
            <span>B 平均剩余: {stats.avgHealthB.toFixed(1)} 血</span>
          </div>
        </div>
      )}
    </>
  );
};
