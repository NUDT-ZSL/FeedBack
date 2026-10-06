import React, { useState } from 'react';
import {
  runContinuous,
  runStepwise,
  verifyConsistency,
  StateSnapshot,
  ScenarioOptions
} from '../simulation';
import { BreakoutEvent } from '../types';

interface BatchResult {
  mode: 'continuous' | 'stepwise' | 'consistency';
  final?: StateSnapshot;
  snapshots?: StateSnapshot[];
  events?: BreakoutEvent[];
  verdict?: { consistent: boolean; mismatchTurn: number | null; turns: number };
  elapsedMs: number;
}

const emptyField = (v: number | undefined) => (v === undefined ? '' : String(v));

export const BatchPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [turns, setTurns] = useState(14);
  const [defenderGrain, setDefenderGrain] = useState<number | undefined>(undefined);
  const [defenderMorale, setDefenderMorale] = useState<number | undefined>(undefined);
  const [forceGateByTurn, setForceGateByTurn] = useState<number | undefined>(3);
  const [result, setResult] = useState<BatchResult | null>(null);

  const options = (): Partial<ScenarioOptions> => ({
    turns,
    defenderGrain,
    defenderMorale,
    forceGateByTurn
  });

  const run = (mode: 'continuous' | 'stepwise' | 'consistency') => {
    const start = performance.now();
    if (mode === 'continuous') {
      const r = runContinuous(options());
      setResult({ mode, final: r.snapshots[r.snapshots.length - 1], snapshots: r.snapshots, events: r.final.breakoutLog, elapsedMs: performance.now() - start });
    } else if (mode === 'stepwise') {
      const r = runStepwise(options());
      setResult({ mode, final: r.snapshots[r.snapshots.length - 1], snapshots: r.snapshots, events: r.final.breakoutLog, elapsedMs: performance.now() - start });
    } else {
      setResult({ mode, verdict: verifyConsistency(options()), elapsedMs: performance.now() - start });
    }
  };

  const inputStyle: React.CSSProperties = {
    width: 60,
    background: '#3d2b1f',
    border: '1px solid #6b4423',
    color: '#f5e6d3',
    borderRadius: 3,
    padding: '2px 4px',
    fontSize: 12
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 760,
          maxHeight: '85vh',
          overflowY: 'auto',
          background: 'linear-gradient(180deg, #2a2018 0%, #1f1812 100%)',
          border: '2px solid #8b5e3c',
          borderRadius: 10,
          padding: 18,
          color: '#f5e6d3',
          fontSize: 13
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0, color: '#d4a76a', fontSize: 18 }}>批量推演 · 突围连锁离线验收</h2>
          <button onClick={onClose} style={{ ...inputStyle, width: 'auto', cursor: 'pointer' }}>关闭</button>
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
          <label>回合数 <input style={inputStyle} type="number" value={turns} min={1} max={60} onChange={e => setTurns(Number(e.target.value))} /></label>
          <label>守军军粮(留空=30) <input style={inputStyle} type="number" value={emptyField(defenderGrain)} onChange={e => setDefenderGrain(e.target.value === '' ? undefined : Number(e.target.value))} /></label>
          <label>守军士气(留空=100) <input style={inputStyle} type="number" value={emptyField(defenderMorale)} onChange={e => setDefenderMorale(e.target.value === '' ? undefined : Number(e.target.value))} /></label>
          <label>城门破于第N回合(留空=自然砸破) <input style={inputStyle} type="number" value={emptyField(forceGateByTurn)} onChange={e => setForceGateByTurn(e.target.value === '' ? undefined : Number(e.target.value))} /></label>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <button style={{ ...inputStyle, width: 'auto', padding: '6px 12px', cursor: 'pointer' }} onClick={() => run('continuous')}>连续推演</button>
          <button style={{ ...inputStyle, width: 'auto', padding: '6px 12px', cursor: 'pointer' }} onClick={() => run('stepwise')}>逐回合推演</button>
          <button style={{ ...inputStyle, width: 'auto', padding: '6px 12px', cursor: 'pointer' }} onClick={() => run('consistency')}>一致性校验（两种顺序）</button>
        </div>

        {result && (
          <div>
            <div style={{ color: '#a08c6c', marginBottom: 8 }}>耗时 {result.elapsedMs.toFixed(1)} ms</div>
            {result.verdict && (
              <div style={{
                padding: 12,
                borderRadius: 6,
                background: result.verdict.consistent ? 'rgba(127,176,105,0.18)' : 'rgba(192,57,43,0.18)',
                border: `1px solid ${result.verdict.consistent ? '#7fb069' : '#c0392b'}`
              }}>
                {result.verdict.consistent
                  ? `PASS：连续推演与逐回合单独结算在 ${result.verdict.turns} 个回合内逐回合快照完全一致`
                  : `FAIL：第 ${result.verdict.mismatchTurn} 回合出现分歧`}
              </div>
            )}
            {result.final && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 6,
                marginBottom: 12,
                padding: 10,
                background: 'rgba(0,0,0,0.25)',
                borderRadius: 6
              }}>
                <span>终局回合：<b>{result.final.turn}</b></span>
                <span>胜方：<b style={{ color: result.final.winner === 'rebels' ? '#ffd700' : '#f0f0f0' }}>{result.final.winner ?? '未定'}</b></span>
                <span>守军士气：<b>{result.final.defenderMorale}</b></span>
                <span>守军军粮：<b>{result.final.defenderGrain}</b></span>
                <span>守军状态：<b>{result.final.defenderStatus}</b></span>
                <span>城墙防守：<b>{result.final.wallDefense}</b></span>
                <span>逃出：<b>{result.final.escapedCount}</b></span>
                <span>阵亡：<b>{result.final.casualtyCount}</b></span>
              </div>
            )}
            {result.snapshots && (
              <div style={{ overflowX: 'auto', marginBottom: 12 }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: '#d4a76a' }}>
                      {['回合', '城门破', '守军士气', '守军军粮', '状态', '防守', '逃出', '阵亡', '箭矢', '起义军/守军', '胜方'].map(h => (
                        <th key={h} style={{ border: '1px solid #4a3525', padding: '2px 6px', textAlign: 'right' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.snapshots.map((s, i) => (
                      <tr key={i}>
                        <td style={{ border: '1px solid #4a3525', padding: '2px 6px', textAlign: 'right' }}>{s.turn}</td>
                        <td style={{ border: '1px solid #4a3525', padding: '2px 6px', textAlign: 'center' }}>{s.gateDestroyed ? '是' : '否'}</td>
                        <td style={{ border: '1px solid #4a3525', padding: '2px 6px', textAlign: 'right' }}>{s.defenderMorale}</td>
                        <td style={{ border: '1px solid #4a3525', padding: '2px 6px', textAlign: 'right' }}>{s.defenderGrain}</td>
                        <td style={{ border: '1px solid #4a3525', padding: '2px 6px', textAlign: 'center' }}>{s.defenderStatus}</td>
                        <td style={{ border: '1px solid #4a3525', padding: '2px 6px', textAlign: 'right' }}>{s.wallDefense}</td>
                        <td style={{ border: '1px solid #4a3525', padding: '2px 6px', textAlign: 'right' }}>{s.escapedCount}</td>
                        <td style={{ border: '1px solid #4a3525', padding: '2px 6px', textAlign: 'right' }}>{s.casualtyCount}</td>
                        <td style={{ border: '1px solid #4a3525', padding: '2px 6px', textAlign: 'right' }}>{s.arrows.toFixed(1)}</td>
                        <td style={{ border: '1px solid #4a3525', padding: '2px 6px', textAlign: 'center' }}>
                          {s.soldiers.filter(x => x.side === 'rebels').length}/{s.soldiers.filter(x => x.side === 'imperial').length}
                        </td>
                        <td style={{ border: '1px solid #4a3525', padding: '2px 6px', textAlign: 'center' }}>{s.winner ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {result.events && result.events.length > 0 && (
              <div style={{ maxHeight: 240, overflowY: 'auto', background: 'rgba(0,0,0,0.3)', borderRadius: 6, padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {result.events.map((e, i) => (
                  <span key={i} style={{ fontSize: 12, lineHeight: 1.5 }}>
                    <span style={{ color: '#a08c6c' }}>T{e.turn}</span> [{e.phase}] {e.message}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
