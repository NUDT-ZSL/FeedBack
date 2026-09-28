import React, { useRef, useEffect, useState } from 'react';
import { BattleLogEntry } from '../types';

interface BattleLogProps {
  logs: BattleLogEntry[];
  autoScroll: boolean;
  onToggleAutoScroll: () => void;
}

const BattleLog: React.FC<BattleLogProps> = ({ logs, autoScroll, onToggleAutoScroll }) => {
  const logRef = useRef<HTMLDivElement>(null);
  const [displayedLogs, setDisplayedLogs] = useState<BattleLogEntry[]>([]);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (!autoScroll || isPaused) return;

    const timer = setInterval(() => {
      setDisplayedLogs((prev) => {
        if (prev.length >= logs.length) return prev;
        const nextCount = Math.min(prev.length + 3, logs.length);
        return logs.slice(0, nextCount);
      });
    }, 16);

    return () => clearInterval(timer);
  }, [logs, autoScroll, isPaused]);

  useEffect(() => {
    if (autoScroll && !isPaused && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [displayedLogs, autoScroll, isPaused]);

  useEffect(() => {
    if (!autoScroll) {
      setDisplayedLogs(logs);
    }
  }, [logs, autoScroll]);

  const handlePauseToggle = () => {
    setIsPaused(!isPaused);
    onToggleAutoScroll();
  };

  const renderLogEntry = (log: BattleLogEntry, index: number) => {
    const isTurnStart =
      index === 0 || logs[index - 1]?.turn !== log.turn;

    return (
      <React.Fragment key={index}>
        {isTurnStart && (
          <div className="log-entry turn-divider">
            — 第 {log.turn} 回合 —
          </div>
        )}
        <div className={`log-entry ${log.action}`}>
          <span className="actor-name">{log.actor}</span>
          {log.skillName ? (
            <>
              {' '}
              使用
              <span
                className="skill-name"
                style={{ backgroundColor: log.skillColor + '30', color: log.skillColor }}
              >
                {log.skillName}
              </span>
            </>
          ) : (
            <> 普通攻击</>
          )}
          {log.action === 'heal' ? (
            <> ，回复了 <strong>{log.value}</strong> 点生命值</>
          ) : log.action === 'shield' ? (
            <> ，获得了 <strong>{log.value}</strong> 点护盾</>
          ) : (
            <> 对 <span className="actor-name">{log.target}</span> 造成了 <strong>{log.value}</strong> 点伤害</>
          )}
          {log.action !== 'heal' && log.action !== 'shield' && (
            <>（剩余 {log.remainingHp} HP）</>
          )}
        </div>
      </React.Fragment>
    );
  };

  return (
    <div className="panel battle-log-panel">
      <div className="battle-log-header">
        <h2 style={{ marginBottom: 0 }}>战斗日志</h2>
        <button
          className={`log-toggle-btn ${!isPaused ? 'active' : ''}`}
          onClick={handlePauseToggle}
        >
          {isPaused ? '▶ 继续' : '⏸ 暂停'}
        </button>
      </div>
      <div className="battle-log" ref={logRef}>
        {displayedLogs.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,0.5)', textAlign: 'center', padding: '20px' }}>
            等待战斗开始...
          </div>
        ) : (
          displayedLogs.map((log, index) => renderLogEntry(log, index))
        )}
      </div>
    </div>
  );
};

export default BattleLog;
