import React, { useEffect, useRef } from 'react';
import { DefenderState, BreakoutEvent, ROUT_MORALE_THRESHOLD, BREAKOUT_MORALE_REQUIRED } from '../types';

interface BreakoutPanelProps {
  defenders: DefenderState;
  log: BreakoutEvent[];
  gateDestroyed: boolean;
}

const statusLabel: Record<DefenderState['status'], string> = {
  holding: '坚守',
  breaking: '突围中',
  routed: '已溃散',
  escaped: '已撤出'
};

const statusColor: Record<DefenderState['status'], string> = {
  holding: '#7fb069',
  breaking: '#e6a23c',
  routed: '#c0392b',
  escaped: '#f0f0f0'
};

const phaseColor: Record<BreakoutEvent['phase'], string> = {
  decision: '#d4a76a',
  sortie: '#e6a23c',
  interception: '#87ceeb',
  morale: '#c39bd3',
  rout: '#e74c3c'
};

const phaseLabel: Record<BreakoutEvent['phase'], string> = {
  decision: '决策',
  sortie: '突围',
  interception: '拦截',
  morale: '士气',
  rout: '溃散'
};

export const BreakoutPanel: React.FC<BreakoutPanelProps> = ({ defenders, log, gateDestroyed }) => {
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log.length]);

  const moralePercent = defenders.morale;
  const moraleDanger = defenders.morale <= ROUT_MORALE_THRESHOLD;
  const moraleLow = defenders.morale < BREAKOUT_MORALE_REQUIRED;

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 460,
        maxHeight: 220,
        background: 'rgba(42, 32, 24, 0.88)',
        border: '1px solid #8b5e3c',
        borderRadius: 8,
        padding: '8px 12px',
        color: '#f5e6d3',
        fontSize: 12,
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        pointerEvents: 'auto'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, color: '#d4a76a' }}>守军突围连锁</span>
        <span>
          状态：
          <span style={{ color: statusColor[defenders.status], fontWeight: 700 }}>
            {gateDestroyed ? statusLabel[defenders.status] : '城门未破'}
          </span>
        </span>
        <span>
          士气：
          <span style={{ color: moraleDanger ? '#e74c3c' : moraleLow ? '#e6a23c' : '#7fb069', fontWeight: 700 }}>
            {defenders.morale}
          </span>
          <span style={{ display: 'inline-block', width: 80, height: 8, background: '#4a3525', borderRadius: 4, marginLeft: 4, verticalAlign: 'middle' }}>
            <span
              style={{
                display: 'block',
                width: `${moralePercent}%`,
                height: '100%',
                borderRadius: 4,
                background: moraleDanger ? '#e74c3c' : moraleLow ? '#e6a23c' : '#7fb069',
                transition: 'width 0.4s'
              }}
            />
          </span>
        </span>
        <span>军粮：<b style={{ color: defenders.grain <= 4 ? '#e74c3c' : '#d4a76a' }}>{defenders.grain}</b></span>
        <span>城墙防守：<b style={{ color: '#87ceeb' }}>{defenders.wallDefense}</b></span>
        <span>逃出 <b style={{ color: '#7fb069' }}>{defenders.escapedCount}</b> / 阵亡 <b style={{ color: '#e74c3c' }}>{defenders.casualtyCount}</b></span>
      </div>
      <div
        ref={logRef}
        style={{
          overflowY: 'auto',
          maxHeight: 150,
          borderTop: '1px solid #5d3a1a',
          paddingTop: 4,
          display: 'flex',
          flexDirection: 'column',
          gap: 2
        }}
      >
        {log.length === 0 && (
          <span style={{ color: '#a08c6c' }}>
            {gateDestroyed ? '等待回合结算…' : '城门完好，突围连锁未触发。'}
          </span>
        )}
        {log.map((e, i) => (
          <div key={i} style={{ lineHeight: 1.5 }}>
            <span style={{ color: '#a08c6c' }}>T{e.turn}</span>{' '}
            <span
              style={{
                display: 'inline-block',
                padding: '0 4px',
                marginRight: 4,
                borderRadius: 3,
                background: phaseColor[e.phase],
                color: '#2a2018',
                fontWeight: 700,
                fontSize: 11
              }}
            >
              {phaseLabel[e.phase]}
            </span>
            <span>{e.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
