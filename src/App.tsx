import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DragState, Gourd, Herb } from './types';
import { HERBS, INITIAL_GOURDS } from './constants';
import HerbCabinet from './HerbCabinet';
import Furnace from './Furnace';
import PillResult, { TrayPill } from './PillResult';
import {
  AddResult,
  FurnaceRuntime,
  addIngredient,
  createFurnaceRuntime,
  getFurnacePills,
  setAirflow,
  tickAll,
  undoLastAdd
} from './core';

const FURNACE_SEED = [
  { id: 'furnace-1', name: '甲炉' },
  { id: 'furnace-2', name: '乙炉' },
  { id: 'furnace-3', name: '丙炉' }
];
const HERB_STOCK = 5;

const STATUS_DOT: Record<string, string> = {
  pending: '#7fb069',
  pill: '#d4ac0d',
  waste: '#95a5a6',
  explosion: '#e74c3c'
};

interface Notice {
  text: string;
  kind: 'pill' | 'explosion' | 'waste' | 'undo' | 'warn';
}

const App: React.FC = () => {
  const [furnaces] = useState<FurnaceRuntime[]>(() =>
    FURNACE_SEED.map(seed => createFurnaceRuntime(seed.id, seed.name))
  );
  const [selectedId, setSelectedId] = useState(furnaces[0].id);
  const [, setVersion] = useState(0);
  const [herbCounts, setHerbCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(HERBS.map(h => [h.id, HERB_STOCK]))
  );
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    herb: null,
    offsetX: 0,
    offsetY: 0,
    currentX: 0,
    currentY: 0
  });
  const [tray, setTray] = useState<TrayPill[]>([]);
  const [gourds, setGourds] = useState<Gourd[]>(INITIAL_GOURDS);
  const [notice, setNotice] = useState<Notice | null>(null);

  const furnacesRef = useRef(furnaces);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const bump = useCallback(() => setVersion(v => v + 1), []);

  const selected = furnaces.find(f => f.id === selectedId) ?? furnaces[0];

  // 所有炉（含未选中炉）均按各自火候在后台持续推进
  useEffect(() => {
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      tickAll(furnacesRef.current, now - last, now);
      last = now;
      bump();
    }, 100);
    return () => clearInterval(timer);
  }, [bump]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

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

  useEffect(() => {
    const move = (e: MouseEvent) => {
      setDragState(prev =>
        prev.isDragging
          ? { ...prev, currentX: e.clientX, currentY: e.clientY }
          : prev
      );
    };
    const up = () =>
      setDragState(prev => (prev.isDragging ? { ...prev, isDragging: false } : prev));
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, []);

  const handleIngredientDrop = useCallback((herb: Herb): AddResult => {
    const rt = furnacesRef.current.find(f => f.id === selectedIdRef.current) ?? furnacesRef.current[0];
    const result = addIngredient(rt, herb, performance.now());
    setHerbCounts(counts => ({
      ...counts,
      [herb.id]: Math.max(0, (counts[herb.id] ?? 0) - 1)
    }));

    const outcome = result.outcome;
    if (outcome) {
      if (outcome.kind === 'pill' && outcome.pill) {
        const pill = outcome.pill;
        setTray(items => [...items, { key: pill.id, pill, furnaceName: rt.name }]);
        setNotice({ text: `${rt.name}炼成「${pill.name}」，丹药已暂存丹盘，点击即可入葫芦`, kind: 'pill' });
      } else if (outcome.kind === 'explosion') {
        setNotice({
          text: `${rt.name}炸炉！${outcome.conflict?.reason ?? ''}——${outcome.conflict?.resolution ?? ''}`,
          kind: 'explosion'
        });
      } else if (outcome.kind === 'waste') {
        setNotice({
          text: `${rt.name}出废丹：${outcome.conflict?.reason ?? ''}——${outcome.conflict?.resolution ?? ''}`,
          kind: 'waste'
        });
      }
    }
    bump();
    return result;
  }, [bump]);

  const handleUndo = useCallback(() => {
    const rt = furnacesRef.current.find(f => f.id === selectedIdRef.current) ?? furnacesRef.current[0];
    const removed = undoLastAdd(rt);
    if (!removed) return;
    setHerbCounts(counts => ({
      ...counts,
      [removed.herb.id]: (counts[removed.herb.id] ?? 0) + 1
    }));
    const validPillIds = new Set(
      furnacesRef.current.flatMap(f => getFurnacePills(f).map(p => p.id))
    );
    setTray(items => items.filter(item => validPillIds.has(item.key)));
    setGourds(current =>
      current.map(g => ({
        ...g,
        pills: g.pills.filter(gp => validPillIds.has(gp.pill.id))
      }))
    );
    setNotice({ text: `${rt.name}撤回最近一手，${removed.herb.name}已退回药柜，炉内状态回到投料前`, kind: 'undo' });
    bump();
  }, [bump]);

  const handleAirflowChange = useCallback((value: number) => {
    const rt = furnacesRef.current.find(f => f.id === selectedIdRef.current) ?? furnacesRef.current[0];
    setAirflow(rt, value);
    bump();
  }, [bump]);

  const handleStorePill = useCallback((key: string) => {
    const item = tray.find(i => i.key === key);
    if (!item) return;
    const targetIndex = gourds.findIndex(g => g.pills.length < g.maxPills);
    if (targetIndex === -1) {
      setNotice({ text: '三个葫芦都已装满，先腾地方再收纳', kind: 'warn' });
      return;
    }
    setGourds(current =>
      current.map((g, i) =>
        i === targetIndex
          ? { ...g, pills: [...g.pills, { pill: item.pill, storedAt: Date.now() }] }
          : g
      )
    );
    setTray(items => items.filter(i => i.key !== key));
  }, [tray, gourds]);

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <div style={styles.title}>太上丹房 · 并行丹台</div>
        <div style={styles.tabs}>
          {furnaces.map(f => {
            const active = f.id === selectedId;
            const cooling = f.cooldownUntil > 0 && performance.now() < f.cooldownUntil;
            return (
              <button
                key={f.id}
                style={{
                  ...styles.tab,
                  ...(active ? styles.tabActive : null),
                  ...(cooling ? styles.tabCooling : null)
                }}
                onClick={() => setSelectedId(f.id)}
                title={`${f.name}｜${f.ingredients.length}味药材在炉｜炉温${Math.round(f.temperature)}°`}
              >
                <span style={{ ...styles.tabDot, backgroundColor: STATUS_DOT[f.status] }} />
                {f.name}
                <span style={styles.tabMeta}>
                  {f.ingredients.length}味 · {Math.round(f.temperature)}°
                </span>
              </button>
            );
          })}
          <button
            style={styles.undoButton}
            onClick={handleUndo}
            disabled={selected.operations.length === 0}
            title="撤销当前炉最近一次投料，药材退回药柜"
          >
            ↩ 撤回上一手
          </button>
        </div>
      </header>

      {notice && (
        <div
          style={{
            ...styles.notice,
            borderColor:
              notice.kind === 'explosion'
                ? '#e74c3c'
                : notice.kind === 'waste'
                ? '#95a5a6'
                : notice.kind === 'warn'
                ? '#e67e22'
                : '#d4ac0d'
          }}
        >
          {notice.text}
        </div>
      )}

      <HerbCabinet
        dragState={dragState}
        onDragStart={handleDragStart}
        onDragEnd={() => {}}
        onHerbUsed={() => {}}
        herbCounts={herbCounts}
      />

      <Furnace
        dragState={dragState}
        furnace={selected}
        onIngredientDrop={handleIngredientDrop}
        onAirflowChange={handleAirflowChange}
      />

      <PillResult
        tray={tray}
        gourds={gourds}
        furnaces={furnaces}
        selectedId={selectedId}
        onStorePill={handleStorePill}
      />
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  app: {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden'
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '64px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 360px 0 360px',
    zIndex: 20
  },
  title: {
    fontFamily: "'Ma Shan Zheng', cursive",
    fontSize: '24px',
    color: '#d4ac0d',
    textShadow: '0 2px 6px rgba(0,0,0,0.7)',
    whiteSpace: 'nowrap'
  },
  tabs: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center'
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    background: 'rgba(42, 26, 14, 0.9)',
    border: '2px solid #6b4c3a',
    borderRadius: '8px',
    color: '#c9a86a',
    fontFamily: "'ZCOOL KuaiLe', cursive",
    fontSize: '14px',
    cursor: 'pointer'
  },
  tabActive: {
    borderColor: '#d4ac0d',
    color: '#f5d76e',
    boxShadow: '0 0 10px rgba(212, 172, 13, 0.4)'
  },
  tabCooling: {
    animation: 'none',
    boxShadow: '0 0 12px rgba(231, 76, 60, 0.7)'
  },
  tabDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    display: 'inline-block'
  },
  tabMeta: {
    fontSize: '11px',
    color: '#8b7355'
  },
  undoButton: {
    marginLeft: '8px',
    padding: '6px 12px',
    background: 'rgba(42, 26, 14, 0.9)',
    border: '2px solid #8b7355',
    borderRadius: '8px',
    color: '#e8c170',
    fontFamily: "'ZCOOL KuaiLe', cursive",
    fontSize: '14px',
    cursor: 'pointer'
  },
  notice: {
    position: 'absolute',
    top: '72px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(42, 26, 14, 0.95)',
    border: '2px solid #d4ac0d',
    borderRadius: '8px',
    padding: '8px 18px',
    color: '#f0e0c0',
    fontFamily: "'ZCOOL KuaiLe', cursive",
    fontSize: '14px',
    maxWidth: '560px',
    zIndex: 30,
    boxShadow: '0 4px 16px rgba(0,0,0,0.6)'
  }
};

export default App;
