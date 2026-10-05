import { useEffect, useReducer, useRef, useState } from 'react';
import MillScene from '@/components/MillScene';
import { createInitialState, millReducer } from '@/millReducer';
import { loadBatches, saveBatches } from '@/storage';
import {
  MAX_GAP,
  MIN_GAP,
  OVERLOAD_THRESHOLD,
  formatDate,
  formatRatios,
  getFlourTypeColor,
  getFlourTypeName,
  roundWeight,
} from '@/MillCore';
import type { Batch } from '@/types';
import { FLOUR_TYPES } from '@/types';

const WOOD = '#8b5a2b';
const RUNNING_THRESHOLD = 0;

const millButtonStyle: React.CSSProperties = {
  borderRadius: 8,
  background: WOOD,
  color: '#fdf6e9',
  border: 'none',
  padding: '6px 12px',
  fontFamily: 'inherit',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'background 0.3s ease',
};

const cardStyle: React.CSSProperties = {
  background: 'rgba(255,248,232,0.85)',
  border: `2px solid ${WOOD}`,
  borderRadius: 12,
  padding: 12,
};

function BatchCard({ batch }: { batch: Batch }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span
          style={{
            display: 'inline-block',
            width: 14,
            height: 14,
            borderRadius: 3,
            background: getFlourTypeColor(batch.type),
            border: '1px solid #b89a66',
          }}
        />
        <strong style={{ color: WOOD }}>#{batch.seq}</strong>
        <span style={{ color: '#5d3a1a', fontWeight: 600 }}>{getFlourTypeName(batch.type)}</span>
        <span style={{ color: WOOD }}>{batch.weight.toFixed(1)} 斤</span>
        <span style={{ color: '#8a6f4d', fontSize: 12, marginLeft: 'auto' }}>
          {formatDate(batch.packedAt)}
        </span>
        <button style={millButtonStyle} onClick={() => setOpen((v) => !v)}>
          {open ? '收起依据' : `追溯依据(${batch.evidence.length})`}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: 8, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: WOOD, textAlign: 'left' }}>
                <th style={{ padding: '2px 6px' }}>工况段</th>
                <th style={{ padding: '2px 6px' }}>时长</th>
                <th style={{ padding: '2px 6px' }}>间隙</th>
                <th style={{ padding: '2px 6px' }}>阀门</th>
                <th style={{ padding: '2px 6px' }}>转速</th>
                <th style={{ padding: '2px 6px' }}>负载</th>
                <th style={{ padding: '2px 6px' }}>产出比例</th>
                <th style={{ padding: '2px 6px' }}>本袋贡献</th>
              </tr>
            </thead>
            <tbody>
              {batch.evidence.map((ev, i) => (
                <tr key={ev.segmentId} style={{ borderTop: '1px dashed #cbb287' }}>
                  <td style={{ padding: '3px 6px' }}>{i + 1}</td>
                  <td style={{ padding: '3px 6px' }}>{ev.duration.toFixed(2)}s</td>
                  <td style={{ padding: '3px 6px' }}>{ev.gap.toFixed(2)}mm</td>
                  <td style={{ padding: '3px 6px' }}>{ev.valve.toFixed(0)}%</td>
                  <td style={{ padding: '3px 6px' }}>{ev.speed.toFixed(1)}rpm</td>
                  <td style={{ padding: '3px 6px', color: ev.load > OVERLOAD_THRESHOLD ? '#dc2626' : undefined }}>
                    {ev.load.toFixed(0)}%
                  </td>
                  <td style={{ padding: '3px 6px' }}>{formatRatios(ev.ratios)}</td>
                  <td style={{ padding: '3px 6px', fontWeight: 600 }}>{ev.typeWeight.toFixed(4)}斤</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [state, dispatch] = useReducer(millReducer, undefined, createInitialState);
  const rafRef = useRef(0);
  const lastRef = useRef(performance.now());

  // 刷新后恢复批次历史（离线 localStorage）
  useEffect(() => {
    const saved = loadBatches();
    if (saved.length > 0) dispatch({ type: 'LOAD_BATCHES', payload: saved });
  }, []);

  useEffect(() => {
    saveBatches(state.ledger.batches);
  }, [state.ledger.batches]);

  useEffect(() => {
    const loop = (now: number) => {
      const dt = Math.min(1, (now - lastRef.current) / 1000);
      lastRef.current = now;
      if (dt > 0) dispatch({ type: 'TICK', payload: dt });
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const { ledger, animatingBags, sieveProgress } = state;
  const running = ledger.speed > RUNNING_THRESHOLD && !ledger.overloaded;

  return (
    <div style={{ minHeight: '100vh', padding: '16px 20px 48px', maxWidth: 1080, margin: '0 auto' }}>
      <h1 style={{ color: WOOD, textAlign: 'center', margin: '4px 0 16px' }}>宋代水力石磨坊</h1>

      {/* 控制区 */}
      <div style={{ ...cardStyle, display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 16 }}>
        <label style={{ flex: 1, minWidth: 240, color: '#5d3a1a', fontWeight: 600 }}>
          水流阀门 {ledger.valve.toFixed(0)}%
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={ledger.valve}
            onChange={(e) => dispatch({ type: 'SET_VALVE', payload: Number(e.target.value) })}
            style={{ width: '100%' }}
          />
        </label>
        <label style={{ flex: 1, minWidth: 240, color: '#5d3a1a', fontWeight: 600 }}>
          磨盘间隙 {ledger.gap.toFixed(1)} mm
          <input
            type="range"
            min={MIN_GAP}
            max={MAX_GAP}
            step={0.1}
            value={ledger.gap}
            onChange={(e) => dispatch({ type: 'SET_GAP', payload: Number(e.target.value) })}
            style={{ width: '100%' }}
          />
        </label>
      </div>

      <MillScene speed={ledger.speed} gap={ledger.gap} load={ledger.load} overloaded={ledger.overloaded} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 16, marginTop: 16 }}>
        {/* 罗筛塔 */}
        <div style={cardStyle}>
          <h3 style={{ color: WOOD, marginTop: 0 }}>三层罗筛塔</h3>
          {(['fine', 'medium', 'bran'] as const).map((type, i) => (
            <div
              key={type}
              style={{
                height: 34,
                margin: '8px 0',
                borderRadius: 8,
                background: i === 0 ? '#f8f2e2' : i === 1 ? '#efe0bd' : '#dfbd8e',
                border: `2px solid ${WOOD}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#5d3a1a',
                fontWeight: 600,
                animation: running ? `sieve-shake 0.6s ease-in-out infinite` : 'none',
                animationDelay: `${i * 0.12}s`,
                opacity: running ? 1 : 0.6,
              }}
            >
              {i === 0 ? '80目 · 精白面' : i === 1 ? '60目 · 中筋面' : '底层 · 麸皮'}
            </div>
          ))}
          <div style={{ fontSize: 12, color: '#8a6f4d' }}>筛分相位 {(sieveProgress * 100).toFixed(0)}%</div>
        </div>

        {/* 木桶与打包 */}
        <div style={cardStyle}>
          <h3 style={{ color: WOOD, marginTop: 0 }}>接面木桶</h3>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', position: 'relative' }}>
            {FLOUR_TYPES.map((type) => {
              const weight = roundWeight(ledger.pendingTotals[type]);
              const canPack = weight > 0;
              return (
                <div key={type} style={{ flex: 1, minWidth: 130, textAlign: 'center', position: 'relative' }}>
                  <div
                    style={{
                      width: 90,
                      height: 78,
                      margin: '0 auto',
                      borderRadius: '8px 8px 18px 18px',
                      background: 'linear-gradient(180deg, #a9794c 0%, #7a5230 100%)',
                      border: `3px solid ${WOOD}`,
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        height: `${Math.min(100, weight * 30)}%`,
                        background: getFlourTypeColor(type),
                        transition: 'height 0.4s ease-out',
                        opacity: 0.9,
                      }}
                    />
                    <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#4a2f15' }}>
                      {weight.toFixed(1)}
                    </span>
                  </div>
                  <div style={{ margin: '6px 0 4px', color: '#5d3a1a', fontWeight: 600 }}>{getFlourTypeName(type)}</div>
                  <button
                    style={{ ...millButtonStyle, opacity: canPack ? 1 : 0.45, cursor: canPack ? 'pointer' : 'not-allowed' }}
                    disabled={!canPack}
                    onClick={() => dispatch({ type: 'PACK', payload: type })}
                  >
                    清空并打包
                  </button>
                </div>
              );
            })}

            {/* 弹出的动画袋：与批次记录共用 id，一一对应 */}
            {animatingBags.map((bag, index) => (
              <div
                key={bag.id}
                className="bag-pop"
                onAnimationEnd={() => dispatch({ type: 'REMOVE_BAG_ANIMATION', payload: bag.id })}
                style={{
                  position: 'absolute',
                  left: `${(index % 3) * 33 + 4}%`,
                  bottom: 96,
                  width: 72,
                  padding: '6px 4px',
                  borderRadius: 8,
                  background: '#d4b886',
                  border: `2px solid ${WOOD}`,
                  textAlign: 'center',
                  fontSize: 11,
                  color: '#4a2f15',
                  zIndex: 5,
                  boxShadow: '2px 4px 8px rgba(0,0,0,0.3)',
                }}
              >
                <div style={{ fontWeight: 700 }}>{getFlourTypeName(bag.type)}</div>
                <div>{bag.weight.toFixed(1)}斤</div>
                <div style={{ fontSize: 9 }}>#{bag.id.replace('batch-', '')}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 批次台账 */}
      <div style={{ marginTop: 16 }}>
        <h3 style={{ color: WOOD }}>
          批次台账（共 {ledger.batches.length} 袋，已离线保存，刷新不丢失）
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[...ledger.batches].reverse().map((batch) => (
            <BatchCard key={batch.id} batch={batch} />
          ))}
          {ledger.batches.length === 0 && (
            <div style={{ ...cardStyle, color: '#8a6f4d' }}>尚无批次，打开阀门磨面后点击"清空并打包"。</div>
          )}
        </div>
      </div>
    </div>
  );
}
