import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { GradientEngine, type ColorStop, type GradientConfig, type GradientType } from '../core/GradientEngine';
import { CardTemplate, CARD_TEMPLATES, type CardLayout } from '../core/CardTemplate';
import { HistoryManager } from '../state/HistoryManager';
import CanvasView from './CanvasView';
import ControlPanel from './ControlPanel';
import './styles/App.css';

interface AppState {
  stops: ColorStop[];
  gradient: GradientConfig;
  layout: CardLayout;
}

const UndoIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7v6h6"/>
    <path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>
  </svg>
);
const RedoIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 7v6h-6"/>
    <path d="M3 17a9 9 0 0 1 15-6.7L21 13"/>
  </svg>
);
const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);
const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"/>
    <line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);
const LinearToolIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="20" x2="20" y2="4" strokeWidth="3"/>
    <circle cx="4" cy="20" r="2" fill="currentColor"/>
    <circle cx="20" cy="4" r="2" fill="currentColor"/>
  </svg>
);
const RadialToolIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="7"/>
    <circle cx="12" cy="12" r="2" fill="currentColor"/>
    <circle cx="12" cy="12" r="9" strokeDasharray="3 3"/>
  </svg>
);
const ConicToolIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="8"/>
    <path d="M12 12 L12 4 A8 8 0 0 1 20 12 Z" fill="currentColor" fillOpacity="0.3"/>
  </svg>
);

const DEFAULT_TEMPLATE_ID = CARD_TEMPLATES[0].id;

function createInitialState(): AppState {
  return {
    stops: GradientEngine.createDefaultStops(),
    gradient: GradientEngine.createDefaultConfig(),
    layout: CardTemplate.createLayoutFromTemplate(DEFAULT_TEMPLATE_ID),
  };
}

const App: React.FC = () => {
  const historyRef = useRef<HistoryManager<AppState>>(new HistoryManager<AppState>(20));
  const initializedRef = useRef(false);

  const [appState, setAppState] = useState<AppState>(() => createInitialState());
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [, forceRender] = useState(0);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStateRef = useRef<AppState | null>(null);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      historyRef.current.push(appState);
      setSelectedStopId(appState.stops[0]?.id ?? null);
    }
  }, []);

  const scheduleHistoryPush = useCallback((newState: AppState) => {
    pendingStateRef.current = newState;
    if (pushTimerRef.current) {
      clearTimeout(pushTimerRef.current);
    }
    pushTimerRef.current = setTimeout(() => {
      if (pendingStateRef.current) {
        historyRef.current.push(pendingStateRef.current);
        pendingStateRef.current = null;
        forceRender(n => n + 1);
      }
    }, 350);
  }, []);

  const updateState = useCallback((mutator: (prev: AppState) => AppState, pushHistory: boolean = true) => {
    setAppState(prev => {
      const next = mutator(prev);
      if (pushHistory) scheduleHistoryPush(next);
      return next;
    });
  }, [scheduleHistoryPush]);

  const handleGradientChange = useCallback((patch: Partial<GradientConfig>) => {
    updateState(prev => ({ ...prev, gradient: { ...prev.gradient, ...patch } }));
  }, [updateState]);

  const handleChangeGradientType = useCallback((type: GradientType) => {
    updateState(prev => ({ ...prev, gradient: { ...prev.gradient, type } }));
  }, [updateState]);

  const handleAddStop = useCallback((color?: string, position?: number) => {
    updateState(prev => {
      if (prev.stops.length >= 20) return prev;
      const sorted = [...prev.stops].sort((a, b) => a.position - b.position);
      let insertPos = position;
      let insertColor = color;
      if (insertPos === undefined) {
        const middleIdx = Math.floor(sorted.length / 2);
        const a = sorted[middleIdx - 1] ?? sorted[0];
        const b = sorted[middleIdx] ?? sorted[sorted.length - 1];
        insertPos = Math.round(((a.position + b.position) / 2) * 10) / 10;
        const engine = new GradientEngine(prev.stops, prev.gradient);
        insertColor = color ?? engine.interpolateColorAt(insertPos);
      }
      const newStop: ColorStop = {
        id: GradientEngine.generateId(),
        color: insertColor!,
        position: insertPos,
      };
      return { ...prev, stops: [...prev.stops, newStop] };
    });
  }, [updateState]);

  const handleRemoveStop = useCallback((id: string) => {
    updateState(prev => {
      if (prev.stops.length <= 2) return prev;
      const remaining = prev.stops.filter(s => s.id !== id);
      const nextSelId = selectedStopId === id ? remaining[0]?.id ?? null : selectedStopId;
      if (nextSelId !== selectedStopId) {
        setSelectedStopId(nextSelId);
      }
      return { ...prev, stops: remaining };
    });
  }, [updateState, selectedStopId]);

  const handleUpdateStop = useCallback((id: string, patch: Partial<ColorStop>) => {
    updateState(prev => ({
      ...prev,
      stops: prev.stops.map(s => (s.id === id ? { ...s, ...patch } : s)),
    }));
  }, [updateState]);

  const handleUpdateStopPosition = useCallback((id: string, position: number) => {
    handleUpdateStop(id, { position });
  }, [handleUpdateStop]);

  const handleTemplateChange = useCallback((templateId: string) => {
    updateState(prev => {
      const newLayout = CardTemplate.createLayoutFromTemplate(templateId);
      const tpl = CardTemplate.getTemplate(templateId);
      const oldTpl = CardTemplate.getTemplate(prev.layout.templateId);
      const scale = Math.sqrt((tpl.width * tpl.height) / (oldTpl.width * oldTpl.height));
      return {
        ...prev,
        layout: {
          ...newLayout,
          title: {
            ...newLayout.title,
            content: prev.layout.title.content,
            fontSize: Math.round(prev.layout.title.fontSize * scale),
            color: prev.layout.title.color,
          },
          subtitle: {
            ...newLayout.subtitle,
            content: prev.layout.subtitle.content,
            fontSize: Math.round(prev.layout.subtitle.fontSize * scale),
            color: prev.layout.subtitle.color,
          },
        },
      };
    });
  }, [updateState]);

  const handleTitleChange = useCallback((patch: Partial<CardLayout['title']>) => {
    updateState(prev => ({
      ...prev,
      layout: { ...prev.layout, title: { ...prev.layout.title, ...patch } },
    }));
  }, [updateState]);

  const handleSubtitleChange = useCallback((patch: Partial<CardLayout['subtitle']>) => {
    updateState(prev => ({
      ...prev,
      layout: { ...prev.layout, subtitle: { ...prev.layout.subtitle, ...patch } },
    }));
  }, [updateState]);

  const doUndo = useCallback(() => {
    const prev = historyRef.current.undo();
    if (prev) {
      pendingStateRef.current = null;
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
      setAppState(prev);
      setSelectedStopId(prev.stops[0]?.id ?? null);
      forceRender(n => n + 1);
    }
  }, []);

  const doRedo = useCallback(() => {
    const next = historyRef.current.redo();
    if (next) {
      pendingStateRef.current = null;
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
      setAppState(next);
      setSelectedStopId(next.stops[0]?.id ?? null);
      forceRender(n => n + 1);
    }
  }, []);

  const jumpToHistory = useCallback((index: number) => {
    const state = historyRef.current.jumpTo(index);
    if (state) {
      pendingStateRef.current = null;
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
      setAppState(state);
      setSelectedStopId(state.stops[0]?.id ?? null);
      forceRender(n => n + 1);
    }
  }, []);

  const handleExportSVG = useCallback(() => {
    const engine = new GradientEngine(appState.stops, appState.gradient);
    const fullSvg = CardTemplate.generateFullSVG(engine, appState.layout);
    const blob = new Blob([fullSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const tplName = CardTemplate.getTemplate(appState.layout.templateId).name;
    a.download = `gradient-${tplName}-${Date.now()}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }, [appState]);

  const canUndo = historyRef.current.canUndo();
  const canRedo = historyRef.current.canRedo();
  const historyList = historyRef.current.getHistory();
  const currentIdx = historyRef.current.getCurrentIndex();

  return (
    <div className="app-container" onClick={() => setSelectedStopId(null)}>
      <header className="top-bar">
        <div className="top-bar-logo">
          <div className="logo-icon">✦</div>
          渐变卡片设计工具
        </div>
        <div className="top-bar-actions">
          <button className="icon-button ghost" onClick={doUndo} disabled={!canUndo}>
            <UndoIcon /> 撤销
          </button>
          <button className="icon-button ghost" onClick={doRedo} disabled={!canRedo}>
            <RedoIcon /> 重做
          </button>
          <button className="icon-button primary" onClick={handleExportSVG}>
            <DownloadIcon /> 导出 SVG
          </button>
        </div>
      </header>

      <nav className="left-toolbar">
        <button
          className={`tool-button ${appState.gradient.type === 'linear' ? 'active' : ''}`}
          onClick={() => handleChangeGradientType('linear')}
          title="线性渐变"
        >
          <LinearToolIcon />
          <span className="tool-tooltip">线性渐变</span>
        </button>
        <button
          className={`tool-button ${appState.gradient.type === 'radial' ? 'active' : ''}`}
          onClick={() => handleChangeGradientType('radial')}
          title="径向渐变"
        >
          <RadialToolIcon />
          <span className="tool-tooltip">径向渐变</span>
        </button>
        <button
          className={`tool-button ${appState.gradient.type === 'conic' ? 'active' : ''}`}
          onClick={() => handleChangeGradientType('conic')}
          title="角向渐变"
        >
          <ConicToolIcon />
          <span className="tool-tooltip">角向渐变</span>
        </button>
        <div className="toolbar-divider" />
        <button
          className="tool-button"
          onClick={() => handleAddStop()}
          disabled={appState.stops.length >= 20}
          title="添加锚点"
        >
          <PlusIcon />
          <span className="tool-tooltip">添加色彩锚点</span>
        </button>
      </nav>

      <main className="canvas-wrapper">
        <CanvasView
          stops={appState.stops}
          gradient={appState.gradient}
          layout={appState.layout}
          selectedStopId={selectedStopId}
          onSelectStop={setSelectedStopId}
          onUpdateStopPosition={handleUpdateStopPosition}
        />
      </main>

      <ControlPanel
        stops={appState.stops}
        gradient={appState.gradient}
        layout={appState.layout}
        selectedStopId={selectedStopId}
        onGradientChange={handleGradientChange}
        onAddStop={handleAddStop}
        onRemoveStop={handleRemoveStop}
        onUpdateStop={handleUpdateStop}
        onSelectStop={setSelectedStopId}
        onTemplateChange={handleTemplateChange}
        onTitleChange={handleTitleChange}
        onSubtitleChange={handleSubtitleChange}
        onChangeGradientType={handleChangeGradientType}
      />

      <footer className="history-bar">
        <div className="history-label">
          历史记录 {historyList.length > 0 ? `(${currentIdx + 1}/${historyList.length})` : ''}
        </div>
        <div className="history-track">
          {historyList.length === 0 ? (
            <div className="history-empty">暂无操作历史</div>
          ) : (
            historyList.map((state, idx) => (
              <HistoryThumb
                key={idx}
                state={state}
                active={idx === currentIdx}
                onClick={() => jumpToHistory(idx)}
              />
            ))
          )}
        </div>
      </footer>
    </div>
  );
};

const HistoryThumb: React.FC<{
  state: AppState;
  active: boolean;
  onClick: () => void;
}> = React.memo(({ state, active, onClick }) => {
  const engine = useMemo(() => new GradientEngine(state.stops, state.gradient), [state]);
  const tpl = useMemo(() => CardTemplate.getTemplate(state.layout.templateId), [state]);
  const bg = useMemo(() => engine.generateCSS(), [engine]);

  return (
    <div
      className={`history-thumb ${active ? 'active' : ''}`}
      onClick={e => {
        e.stopPropagation();
        onClick();
      }}
      title={`步骤 ${tpl.name}`}
    >
      <svg viewBox={`0 0 ${tpl.width} ${tpl.height}`} preserveAspectRatio="xMidYMid slice">
        <defs>
          <foreignObject x="0" y="0" width="100%" height="100%">
            <div
              style={{ width: '100%', height: '100%', background: bg }}
            />
          </foreignObject>
        </defs>
      </svg>
    </div>
  );
});

export default App;
