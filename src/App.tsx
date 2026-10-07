import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DragState, Gourd, Herb, Pill } from './types';
import { HERBS, INITIAL_GOURDS, ELEMENT_COLORS, ELEMENT_NAMES } from './constants';
import HerbCabinet from './HerbCabinet';
import Furnace from './Furnace';
import PillResult, { CollectedPill } from './PillResult';
import { AlchemyWorkshop, MAX_FURNACES } from './engine/workshop';
import { FurnaceState, FurnaceStatus } from './engine/model';

const STATUS_NAMES: Record<FurnaceStatus, string> = {
  idle: '空闲',
  refining: '炼制中',
  conflicted: '药性相冲·废丹',
  exploded: '炸炉'
};

const STATUS_COLORS: Record<FurnaceStatus, string> = {
  idle: '#8b7355',
  refining: '#d4ac0d',
  conflicted: '#e67e22',
  exploded: '#c0392b'
};

const INITIAL_HERB_COUNT = 5;

const App: React.FC = () => {
  const workshopRef = useRef<AlchemyWorkshop | null>(null);
  if (!workshopRef.current) {
    const workshop = new AlchemyWorkshop();
    workshop.addFurnace();
    workshop.addFurnace();
    workshop.addFurnace();
    workshopRef.current = workshop;
  }
  const workshop = workshopRef.current;

  const [, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    herb: null,
    offsetX: 0,
    offsetY: 0,
    currentX: 0,
    currentY: 0
  });
  const [herbCounts, setHerbCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(HERBS.map((herb) => [herb.id, INITIAL_HERB_COUNT]))
  );
  const [collectedPills, setCollectedPills] = useState<CollectedPill[]>([]);
  const [gourds, setGourds] = useState<Gourd[]>(() =>
    INITIAL_GOURDS.map((gourd) => ({ ...gourd, pills: [] }))
  );

  useEffect(() => {
    const timer = setInterval(() => {
      workshop.tick(100);
      refresh();
    }, 100);
    return () => clearInterval(timer);
  }, [workshop, refresh]);

  const selected = workshop.getSelectedFurnace() as FurnaceState;

  const handleDragStart = useCallback((herb: Herb, e: React.MouseEvent) => {
    setDragState({
      isDragging: true,
      herb,
      offsetX: 0,
      offsetY: 0,
      currentX: e.clientX,
      currentY: e.clientY
    });
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragState((prev) => ({ ...prev, isDragging: false, herb: null }));
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setDragState((prev) =>
      prev.isDragging ? { ...prev, currentX: e.clientX, currentY: e.clientY } : prev
    );
  }, []);

  const handleDropHerb = useCallback(
    (herb: Herb) => {
      const selectedId = workshop.getSelectedId();
      if (!selectedId) {
        return { outcome: 'none' as const, pill: null, reason: '未选中丹炉', elements: [] };
      }
      workshop.addIngredient(selectedId, herb);
      setHerbCounts((counts) => ({
        ...counts,
        [herb.id]: Math.max(0, (counts[herb.id] ?? 0) - 1)
      }));
      refresh();
      return workshop.toDropOutcome(selectedId);
    },
    [workshop, refresh]
  );

  const handleAirflowChange = useCallback(
    (value: number) => {
      const selectedId = workshop.getSelectedId();
      if (!selectedId) return;
      workshop.setAirflow(selectedId, value);
      refresh();
    },
    [workshop, refresh]
  );

  const handlePillCreated = useCallback(
    (pill: Pill, reason: string) => {
      const furnaceName = workshop.getSelectedFurnace()?.name ?? '未知丹炉';
      setCollectedPills((pills) => [
        ...pills,
        { pill, furnaceName, reason, collectedAt: Date.now(), stored: false }
      ]);
    },
    [workshop]
  );

  const handleStorePill = useCallback(
    (pillId: string) => {
      const targetGourd = gourds.find((gourd) => gourd.pills.length < gourd.maxPills);
      const pillEntry = collectedPills.find((entry) => entry.pill.id === pillId && !entry.stored);
      if (!targetGourd || !pillEntry) return;
      setGourds(
        gourds.map((gourd) =>
          gourd.color === targetGourd.color
            ? { ...gourd, pills: [...gourd.pills, { pill: pillEntry.pill, storedAt: Date.now() }] }
            : gourd
        )
      );
      setCollectedPills((pills) =>
        pills.map((entry) => (entry.pill.id === pillId ? { ...entry, stored: true } : entry))
      );
    },
    [collectedPills, gourds]
  );

  const handleRestock = useCallback(() => {
    setHerbCounts(Object.fromEntries(HERBS.map((herb) => [herb.id, INITIAL_HERB_COUNT])));
  }, []);

  const furnaces = workshop.getFurnaces();

  return (
    <div style={styles.root} onMouseMove={handleMouseMove} onMouseUp={handleDragEnd}>
      <header style={styles.header}>
        <div style={styles.title}>太上丹房 · 并行炼丹台</div>
        <div style={styles.tabs}>
          {furnaces.map((furnace) => {
            const isSelected = furnace.id === selected?.id;
            return (
              <button
                key={furnace.id}
                onClick={() => {
                  workshop.selectFurnace(furnace.id);
                  refresh();
                }}
                style={{
                  ...styles.tab,
                  borderColor: isSelected ? '#d4ac0d' : '#6b4c3a',
                  background: isSelected ? 'rgba(212, 172, 13, 0.15)' : 'rgba(42, 26, 14, 0.8)'
                }}
              >
                <span
                  style={{ ...styles.statusDot, background: STATUS_COLORS[furnace.status] }}
                />
                <span style={styles.tabName}>{furnace.name}</span>
                <span style={styles.tabTemp}>{Math.round(furnace.temperature)}℃</span>
              </button>
            );
          })}
          {furnaces.length < MAX_FURNACES && (
            <button
              style={{ ...styles.tab, ...styles.addTab }}
              onClick={() => {
                const furnace = workshop.addFurnace();
                workshop.selectFurnace(furnace.id);
                refresh();
              }}
            >
              ＋ 新开一炉
            </button>
          )}
        </div>
      </header>

      <HerbCabinet
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        dragState={dragState}
        onHerbUsed={() => undefined}
        herbCounts={herbCounts}
      />

      {selected && (
        <Furnace
          key={selected.id}
          dragState={dragState}
          furnaceView={{
            temperature: selected.temperature,
            flameColor: selected.flameColor,
            flameHeight: selected.flameHeight,
            status: selected.status,
            elements: selected.elements
          }}
          onDropHerb={handleDropHerb}
          onPillCreated={handlePillCreated}
          airflow={selected.airflow}
          onAirflowChange={handleAirflowChange}
        />
      )}

      <aside style={styles.sidebar}>
        {selected && (
          <>
            <section style={styles.panel}>
              <div style={styles.panelTitle}>
                {selected.name}
                <span style={{ ...styles.statusBadge, color: STATUS_COLORS[selected.status] }}>
                  {STATUS_NAMES[selected.status]}
                </span>
              </div>
              <div style={styles.statRow}>
                <span>炉温 {Math.round(selected.temperature)}℃</span>
                <span>风量 {selected.airflow}</span>
                <span>
                  五行{' '}
                  {selected.elements.length === 0
                    ? '无'
                    : selected.elements.map((element) => (
                        <span key={element} style={{ color: ELEMENT_COLORS[element] }}>
                          {ELEMENT_NAMES[element]}
                        </span>
                      ))}
                </span>
              </div>
              <div style={styles.buttonRow}>
                <button
                  style={{
                    ...styles.actionButton,
                    opacity: selected.undoStack.length > 0 ? 1 : 0.4
                  }}
                  disabled={selected.undoStack.length === 0}
                  onClick={() => {
                    workshop.undoLastIngredient(selected.id);
                    refresh();
                  }}
                >
                  回退上一味
                </button>
                <button
                  style={styles.actionButton}
                  onClick={() => {
                    workshop.clearFurnace(selected.id);
                    refresh();
                  }}
                >
                  清理炉膛
                </button>
                <button style={styles.actionButton} onClick={handleRestock}>
                  补齐药材
                </button>
              </div>
            </section>

            <section style={styles.panel}>
              <div style={styles.panelTitle}>投料记录（{selected.ingredients.length}）</div>
              {selected.ingredients.length === 0 && <div style={styles.dim}>炉膛空净</div>}
              {selected.ingredients.map((record) => (
                <div key={record.seq} style={styles.recordRow}>
                  <span style={styles.recordSeq}>#{record.seq}</span>
                  <span>{record.herb.name}</span>
                  <span style={{ color: ELEMENT_COLORS[record.herb.element] }}>
                    {ELEMENT_NAMES[record.herb.element]}
                  </span>
                </div>
              ))}
            </section>

            {selected.conflictHistory.length > 0 && (
              <section style={styles.panel}>
                <div style={styles.panelTitle}>冲突备案（{selected.conflictHistory.length}）</div>
                {selected.conflictHistory.map((conflict) => (
                  <div key={conflict.id} style={styles.conflictItem}>
                    <div style={styles.conflictHead}>
                      <span style={{ color: conflict.kind === 'restrain' ? '#c0392b' : '#e67e22' }}>
                        {conflict.kind === 'restrain' ? '相克·炸炉' : '重复·废丹'}
                      </span>
                      <span style={styles.dim}>{conflict.active ? '生效中' : '已解除'}</span>
                    </div>
                    <div style={styles.conflictReason}>{conflict.reason}</div>
                  </div>
                ))}
              </section>
            )}

            <section style={styles.panel}>
              <div style={styles.panelTitle}>成丹结论</div>
              <div style={styles.verdictReason}>{selected.verdict.reason}</div>
              {selected.verdict.basis.map((line, index) => (
                <div key={index} style={styles.basisLine}>
                  · {line}
                </div>
              ))}
            </section>

            <section style={styles.panel}>
              <div style={styles.panelTitle}>丹炉日志</div>
              <div style={styles.logBox}>
                {selected.log.slice(-40).map((event) => (
                  <div key={event.seq} style={styles.logLine}>
                    <span style={styles.logSeq}>#{event.seq}</span>
                    {event.message}
                  </div>
                ))}
              </div>
            </section>

            <PillResult pills={collectedPills} gourds={gourds} onStorePill={handleStorePill} />
          </>
        )}
      </aside>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: 'relative',
    width: '100%',
    height: '100%',
    display: 'flex',
    overflow: 'hidden',
    background: '#2a1a0e'
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '8px 20px',
    zIndex: 15,
    background: 'linear-gradient(180deg, rgba(26,16,8,0.95), rgba(26,16,8,0.6))',
    borderBottom: '1px solid #6b4c3a'
  },
  title: {
    fontSize: 22,
    color: '#d4ac0d',
    fontFamily: "'Ma Shan Zheng', cursive",
    whiteSpace: 'nowrap'
  },
  tabs: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap'
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 12px',
    border: '2px solid #6b4c3a',
    borderRadius: 8,
    color: '#d8c9a3',
    cursor: 'pointer',
    fontFamily: "'ZCOOL KuaiLe', cursive",
    fontSize: 14
  },
  addTab: {
    color: '#d4ac0d',
    borderStyle: 'dashed'
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%'
  },
  tabName: {
    fontSize: 14
  },
  tabTemp: {
    fontSize: 12,
    color: '#8b7355'
  },
  sidebar: {
    position: 'absolute',
    top: 56,
    right: 12,
    bottom: 12,
    width: 320,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    zIndex: 12
  },
  panel: {
    background: 'linear-gradient(145deg, #3d2817, #2a1a0e)',
    border: '2px solid #6b4c3a',
    borderRadius: 10,
    padding: '10px 12px'
  },
  panelTitle: {
    fontSize: 16,
    color: '#d4ac0d',
    fontFamily: "'Ma Shan Zheng', cursive",
    marginBottom: 6,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  statusBadge: {
    fontSize: 13,
    fontFamily: "'ZCOOL KuaiLe', cursive"
  },
  statRow: {
    display: 'flex',
    gap: 14,
    fontSize: 13,
    color: '#d8c9a3',
    fontFamily: "'ZCOOL KuaiLe', cursive",
    flexWrap: 'wrap'
  },
  buttonRow: {
    display: 'flex',
    gap: 8,
    marginTop: 8
  },
  actionButton: {
    flex: 1,
    padding: '6px 0',
    background: '#c0392b',
    color: '#f5e6c8',
    border: '2px solid #d4ac0d',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: "'ZCOOL KuaiLe', cursive",
    fontSize: 13
  },
  dim: {
    color: '#8b7355',
    fontSize: 12,
    fontFamily: "'ZCOOL KuaiLe', cursive"
  },
  recordRow: {
    display: 'flex',
    gap: 8,
    fontSize: 13,
    color: '#d8c9a3',
    fontFamily: "'ZCOOL KuaiLe', cursive",
    padding: '2px 0'
  },
  recordSeq: {
    color: '#8b7355',
    minWidth: 28
  },
  conflictItem: {
    borderLeft: '3px solid #c0392b',
    paddingLeft: 8,
    marginBottom: 6
  },
  conflictHead: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 13,
    fontFamily: "'ZCOOL KuaiLe', cursive"
  },
  conflictReason: {
    fontSize: 12,
    color: '#d8c9a3',
    fontFamily: "'ZCOOL KuaiLe', cursive",
    lineHeight: 1.5
  },
  verdictReason: {
    fontSize: 13,
    color: '#f0e6c8',
    fontFamily: "'ZCOOL KuaiLe', cursive",
    lineHeight: 1.6
  },
  basisLine: {
    fontSize: 12,
    color: '#a89880',
    fontFamily: "'ZCOOL KuaiLe', cursive",
    lineHeight: 1.6
  },
  logBox: {
    maxHeight: 160,
    overflowY: 'auto'
  },
  logLine: {
    fontSize: 12,
    color: '#b8a888',
    fontFamily: "'ZCOOL KuaiLe', cursive",
    lineHeight: 1.6
  },
  logSeq: {
    color: '#6b5c43',
    marginRight: 6
  }
};

export default App;
