import { useEffect, useState } from 'react';
import { useGameStore } from '../store';
import { CityWall } from '../components/CityWall';
import { Catapult } from '../components/Catapult';
import { Soldier } from '../components/Soldier';
import { Projectile } from '../components/Projectile';
import { Particle } from '../components/Particle';
import { ResourcePanel } from '../components/ResourcePanel';
import { BreakoutPanel } from '../components/BreakoutPanel';
import { BatchPanel } from '../components/BatchPanel';
import { GRID_WIDTH, GRID_HEIGHT, WALL_ROW, TILE_SIZE, Position } from '../types';

const BOARD_WIDTH = GRID_WIDTH * TILE_SIZE;
const BOARD_HEIGHT = GRID_HEIGHT * TILE_SIZE;

export default function Home() {
  const state = useGameStore();
  const { dispatch } = state;
  const [showBatch, setShowBatch] = useState(false);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      dispatch({ type: 'UPDATE_PARTICLES' });
      dispatch({ type: 'UPDATE_PROJECTILES' });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dispatch]);

  const handleBoardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (state.phase !== 'player' || state.winner) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const tile: Position = {
      x: Math.floor((e.clientX - rect.left) / TILE_SIZE),
      y: Math.floor((e.clientY - rect.top) / TILE_SIZE)
    };
    if (tile.x < 0 || tile.x >= GRID_WIDTH || tile.y < 0 || tile.y >= GRID_HEIGHT) return;

    if (tile.y === WALL_ROW && state.selectedCatapult) {
      dispatch({ type: 'ATTACK', catapultId: state.selectedCatapult, target: tile });
    } else if (tile.y > WALL_ROW) {
      if (state.selectedCatapult) {
        dispatch({ type: 'MOVE_CATAPULT', id: state.selectedCatapult, position: tile });
      } else {
        dispatch({ type: 'DEPLOY_CATAPULT', position: tile });
      }
    }
  };

  const phaseBanner =
    state.phase === 'transition'
      ? `第 ${state.turn} 回合`
      : state.phase === 'imperial'
        ? '守军反击中…'
        : null;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #f5e6d3 0%, #e8d5b7 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '"ZCOOL QingKe HuangYou", sans-serif',
        userSelect: 'none'
      }}
    >
      <div style={{ position: 'relative', display: 'flex', gap: 8 }}>
        <ResourcePanel side="left" resources={state.resources} catapultCount={state.catapults.length} gateDestroyed={state.gateDestroyed} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div
            onClick={handleBoardClick}
            style={{
              position: 'relative',
              width: BOARD_WIDTH,
              height: BOARD_HEIGHT,
              background: 'linear-gradient(180deg, #d4c4a8 0%, #d4a76a 45%, #c49a6c 100%)',
              border: '3px solid #8b5e3c',
              borderRadius: 6,
              overflow: 'hidden',
              cursor: state.phase === 'player' && !state.winner ? 'pointer' : 'default',
              boxShadow: '0 8px 24px rgba(74, 46, 27, 0.35)'
            }}
          >
            {/* 平原网格 */}
            {Array.from({ length: GRID_HEIGHT - WALL_ROW - 1 }).map((_, row) =>
              Array.from({ length: GRID_WIDTH }).map((_, col) => (
                <div
                  key={`tile-${col}-${row}`}
                  style={{
                    position: 'absolute',
                    left: col * TILE_SIZE,
                    top: (WALL_ROW + 1 + row) * TILE_SIZE,
                    width: TILE_SIZE,
                    height: TILE_SIZE,
                    border: '1px solid rgba(139, 94, 60, 0.18)',
                    boxSizing: 'border-box'
                  }}
                />
              ))
            )}

            <CityWall segments={state.wallSegments} tileSize={TILE_SIZE} gateDestroyed={state.gateDestroyed} />

            {/* 城墙段攻击热区 */}
            {state.wallSegments.map(seg => (
              <div
                key={`hot-${seg.id}`}
                title={`${seg.isGate ? '城门' : '城墙'} 耐久 ${seg.durability}`}
                style={{
                  position: 'absolute',
                  left: seg.position.x * TILE_SIZE,
                  top: seg.position.y * TILE_SIZE,
                  width: TILE_SIZE,
                  height: TILE_SIZE,
                  zIndex: 5
                }}
              />
            ))}

            {/* 热油区域 */}
            {state.oilAreas.map((oil, i) => (
              <div
                key={`oil-${i}`}
                style={{
                  position: 'absolute',
                  left: oil.position.x * TILE_SIZE,
                  top: oil.position.y * TILE_SIZE,
                  width: TILE_SIZE,
                  height: TILE_SIZE,
                  background: 'radial-gradient(circle, rgba(61,43,31,0.75) 0%, rgba(45,31,20,0.4) 70%, transparent 100%)',
                  zIndex: 6,
                  pointerEvents: 'none'
                }}
              />
            ))}

            {state.catapults.map(c => (
              <Catapult
                key={c.id}
                catapult={c}
                tileSize={TILE_SIZE}
                isSelected={state.selectedCatapult === c.id}
                onClick={() => dispatch({ type: 'SELECT_CATAPULT', id: state.selectedCatapult === c.id ? null : c.id })}
              />
            ))}

            {state.soldiers.map(s => (
              <Soldier key={s.id} soldier={s} tileSize={TILE_SIZE} />
            ))}

            {state.projectiles.map((p, i) => (
              <Projectile key={p.id} projectile={p} tileSize={TILE_SIZE} index={i} />
            ))}

            {state.particles.map(p => (
              <Particle key={p.id} particle={p} />
            ))}

            {/* 回合转场 */}
            {phaseBanner && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(42, 32, 24, 0.35)',
                  zIndex: 50,
                  pointerEvents: 'none'
                }}
              >
                <div
                  style={{
                    padding: '14px 48px',
                    background: 'linear-gradient(90deg, #f5e6d3 0%, #d9c9b9 100%)',
                    border: '2px solid #8b5e3c',
                    borderRadius: 4,
                    fontSize: 28,
                    color: '#5d3a1a',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.4)'
                  }}
                >
                  {phaseBanner}
                </div>
              </div>
            )}

            {/* 胜负 */}
            {state.winner && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 12,
                  background: 'rgba(26, 16, 8, 0.6)',
                  zIndex: 60
                }}
              >
                <div
                  style={{
                    width: 70,
                    height: 90,
                    background: state.winner === 'rebels' ? '#ffd700' : '#f0f0f0',
                    clipPath: 'polygon(0% 0%, 100% 0%, 100% 75%, 50% 100%, 0% 75%)',
                    boxShadow: '0 0 24px rgba(255,215,0,0.6)'
                  }}
                />
                <div style={{ fontSize: 32, color: state.winner === 'rebels' ? '#ffd700' : '#f0f0f0' }}>
                  {state.winner === 'rebels' ? '起义军攻克杭州！' : '官兵守住了杭州'}
                </div>
                <div style={{ fontSize: 14, color: '#d9c9b9' }}>
                  {state.winner === 'rebels'
                    ? `守军${state.defenders.status === 'routed' ? '溃散' : state.defenders.status === 'escaped' ? '弃城' : '被压制'}，逃出 ${state.defenders.escapedCount} 人，阵亡 ${state.defenders.casualtyCount} 人`
                    : state.resources.morale <= 0
                      ? '起义军士气崩溃'
                      : '投石机全军覆没'}
                </div>
              </div>
            )}

            <BreakoutPanel defenders={state.defenders} log={state.breakoutLog} gateDestroyed={state.gateDestroyed} />
          </div>

          {/* 底部操作栏 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '8px 16px',
              background: 'linear-gradient(180deg, #6b4423 0%, #5d3a1a 100%)',
              borderRadius: 6,
              border: '2px solid #4a2e1b'
            }}
          >
            <span style={{ color: '#f5e6d3', fontSize: 14 }}>
              第 {state.turn} 回合 · {state.selectedCatapult ? '已选中投石机：点击城墙攻击 / 点击平原移动' : '点击平原部署投石机，点击投石机选中'}
            </span>
            <div style={{ flex: 1 }} />
            {!state.gateDestroyed && (
              <button style={btnStyle} onClick={() => dispatch({ type: 'BREAK_GATE' })} title="演示用：直接砸毁城门，观察守军突围连锁">
                砸毁城门
              </button>
            )}
            <button style={btnStyle} onClick={() => setShowBatch(true)}>批量推演</button>
            <button style={btnStyle} onClick={() => dispatch({ type: 'RESET_GAME' })}>重新开始</button>
            <button
              style={{
                ...btnStyle,
                background: state.phase === 'player' && !state.winner ? 'radial-gradient(circle, #c49a6c 0%, #a67c52 100%)' : '#777',
                color: '#4a2e1b',
                fontWeight: 700,
                cursor: state.phase === 'player' && !state.winner ? 'pointer' : 'not-allowed'
              }}
              disabled={state.phase !== 'player' || !!state.winner}
              onClick={() => dispatch({ type: 'END_TURN' })}
            >
              回合结束
            </button>
          </div>
        </div>

        <ResourcePanel side="right" resources={state.resources} catapultCount={state.catapults.length} gateDestroyed={state.gateDestroyed} />
      </div>

      {showBatch && <BatchPanel onClose={() => setShowBatch(false)} />}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: '8px 16px',
  background: 'linear-gradient(180deg, #f5e6d3 0%, #d9c9b9 100%)',
  border: '2px solid #4a2e1b',
  borderRadius: 20,
  color: '#5d3a1a',
  fontSize: 14,
  fontFamily: 'inherit',
  cursor: 'pointer'
};
