import React, { useState, useRef, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Menu, X, Music2 } from 'lucide-react';
import Canvas from './Canvas';
import ToolPanel from './ToolPanel';
import ExportButton from './ExportButton';
import {
  BandTheme,
  ElementConfig,
  PosterConfig,
  BAND_THEMES,
  FONT_OPTIONS,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  LoadResponse,
} from './types';

const createInitialElements = (theme: BandTheme): ElementConfig[] => {
  return [
    {
      id: uuidv4(),
      type: 'title',
      content: `${theme.name}\nLIVE TOUR 2026`,
      x: CANVAS_WIDTH * 0.1,
      y: CANVAS_HEIGHT * 0.2,
      width: CANVAS_WIDTH * 0.8,
      height: 220,
      fontSize: 110,
      fontFamily: FONT_OPTIONS[0].value,
      color: theme.primaryColor,
      fontWeight: 900,
      textAlign: 'center',
      zIndex: 10,
    },
    {
      id: uuidv4(),
      type: 'date',
      content: '2026.08.15  SAT  19:30',
      x: CANVAS_WIDTH * 0.2,
      y: CANVAS_HEIGHT * 0.55,
      width: CANVAS_WIDTH * 0.6,
      height: 50,
      fontSize: 36,
      fontFamily: FONT_OPTIONS[4].value,
      color: theme.accentColor,
      fontWeight: 700,
      textAlign: 'center',
      zIndex: 5,
    },
    {
      id: uuidv4(),
      type: 'venue',
      content: '📍 上海·梅赛德斯奔驰文化中心',
      x: CANVAS_WIDTH * 0.15,
      y: CANVAS_HEIGHT * 0.68,
      width: CANVAS_WIDTH * 0.7,
      height: 45,
      fontSize: 28,
      fontFamily: FONT_OPTIONS[1].value,
      color: '#ffffff',
      fontWeight: 500,
      textAlign: 'center',
      zIndex: 5,
    },
    {
      id: uuidv4(),
      type: 'price',
      content: '¥280 起 · VIP ¥1280',
      x: CANVAS_WIDTH * 0.3,
      y: CANVAS_HEIGHT * 0.78,
      width: CANVAS_WIDTH * 0.4,
      height: 40,
      fontSize: 24,
      fontFamily: FONT_OPTIONS[4].value,
      color: theme.primaryColor,
      fontWeight: 700,
      textAlign: 'center',
      zIndex: 5,
    },
  ];
};

const App: React.FC = () => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [currentBandId, setCurrentBandId] = useState<string>(BAND_THEMES[0].id);
  const [elements, setElements] = useState<ElementConfig[]>(() =>
    createInitialElements(BAND_THEMES[0]),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customCss, setCustomCss] = useState<string>('');
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);

  const currentTheme = BAND_THEMES.find((b) => b.id === currentBandId) || BAND_THEMES[0];

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const posterId = params.get('poster');
    if (posterId) {
      setLoadingConfig(true);
      fetch(`/api/load/${posterId}`)
        .then((r) => r.json())
        .then((data: LoadResponse) => {
          if (data.success && data.data) {
            const theme = BAND_THEMES.find((b) => b.id === data.data!.bandId);
            if (theme) {
              setCurrentBandId(theme.id);
            }
            setElements(data.data.elements);
            setCustomCss(data.data.customCss);
          }
        })
        .catch(() => {})
        .finally(() => setLoadingConfig(false));
    }
  }, []);

  const handleSelectBand = useCallback((id: string) => {
    const theme = BAND_THEMES.find((b) => b.id === id);
    if (!theme) return;
    setCurrentBandId(id);
    setElements((prev) =>
      prev.map((el, idx) => ({
        ...el,
        color:
          idx === 0
            ? theme.primaryColor
            : idx === 1
            ? theme.accentColor
            : el.type === 'price'
            ? theme.primaryColor
            : '#ffffff',
      })),
    );
  }, []);

  const handleSelectElement = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);

  const handleUpdateElement = useCallback((id: string, updates: Partial<ElementConfig>) => {
    setElements((prev) =>
      prev.map((el) => (el.id === id ? { ...el, ...updates } : el)),
    );
  }, []);

  const handleAddElement = useCallback(
    (type: ElementConfig['type']) => {
      const contents: Record<ElementConfig['type'], string> = {
        title: '新标题',
        date: '2026.XX.XX',
        venue: '📍 演出地点',
        price: '¥XXX 起',
        custom: '自定义文本',
      };
      const newEl: ElementConfig = {
        id: uuidv4(),
        type,
        content: contents[type],
        x: 200 + Math.random() * 200,
        y: 200 + Math.random() * 200,
        width: type === 'title' ? 800 : 400,
        height: type === 'title' ? 140 : 50,
        fontSize: type === 'title' ? 72 : 28,
        fontFamily: FONT_OPTIONS[0].value,
        color: currentTheme.primaryColor,
        fontWeight: 700,
        textAlign: 'center',
        zIndex: elements.length + 1,
      };
      setElements((prev) => [...prev, newEl]);
      setSelectedId(newEl.id);
    },
    [currentTheme.primaryColor, elements.length],
  );

  const handleDeleteElement = useCallback(
    (id: string) => {
      setElements((prev) => prev.filter((el) => el.id !== id));
      if (selectedId === id) setSelectedId(null);
    },
    [selectedId],
  );

  const config: PosterConfig = {
    bandId: currentBandId,
    elements,
    customCss,
  };

  return (
    <div className="w-screen h-screen flex flex-col bg-[#0d0d1a] text-white overflow-hidden">
      <header className="h-14 flex items-center justify-between px-4 border-b border-[#2a2a4a] bg-gradient-to-r from-[#16162a] via-[#1a1a3e] to-[#16162a] shrink-0 z-50">
        <div className="flex items-center gap-3">
          <button
            className="lg:hidden p-2 rounded-md hover:bg-[#2a2a4a] text-gray-300"
            onClick={() => setLeftOpen((o) => !o)}
          >
            {leftOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-pink-500 flex items-center justify-center shadow-lg shadow-cyan-400/30">
              <Music2 size={16} className="text-white" />
            </div>
            <div>
              <div className="text-sm font-bold tracking-wider bg-gradient-to-r from-cyan-400 to-pink-400 bg-clip-text text-transparent">
                POSTER GENERATOR
              </div>
              <div className="text-[10px] text-gray-500 tracking-widest -mt-0.5">
                虚拟乐队音乐会海报
              </div>
            </div>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-2">
          <span
            className="px-3 py-1 rounded-full text-[10px] font-bold tracking-widest border"
            style={{
              borderColor: currentTheme.primaryColor,
              color: currentTheme.primaryColor,
              backgroundColor: `${currentTheme.primaryColor}15`,
            }}
          >
            {currentTheme.emoji} {currentTheme.name}
          </span>
          <span className="text-[10px] text-gray-500 font-mono">
            {CANVAS_WIDTH} × {CANVAS_HEIGHT}
          </span>
        </div>
        <button
          className="lg:hidden p-2 rounded-md hover:bg-[#2a2a4a] text-gray-300"
          onClick={() => setRightOpen((o) => !o)}
        >
          {rightOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        <aside
          className={`
            absolute lg:relative z-40 h-full w-72 shrink-0
            transform transition-transform duration-300 ease-out
            lg:translate-x-0
            ${leftOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          `}
        >
          <ToolPanel
            currentBandId={currentBandId}
            elements={elements}
            selectedId={selectedId}
            customCss={customCss}
            onSelectBand={handleSelectBand}
            onSelectElement={handleSelectElement}
            onUpdateElement={handleUpdateElement}
            onAddElement={handleAddElement}
            onDeleteElement={handleDeleteElement}
            onCustomCssChange={setCustomCss}
          />
        </aside>

        {leftOpen && (
          <div
            className="lg:hidden absolute inset-0 bg-black/60 z-30 backdrop-blur-sm"
            onClick={() => setLeftOpen(false)}
          />
        )}

        <main className="flex-1 relative bg-gradient-to-br from-[#0a0a18] via-[#0d0d20] to-[#0a0a18] overflow-hidden">
          <div
            className="absolute inset-0 opacity-30 pointer-events-none"
            style={{
              backgroundImage:
                'radial-gradient(circle at 20% 80%, rgba(0, 212, 255, 0.08), transparent 40%), radial-gradient(circle at 80% 20%, rgba(255, 0, 110, 0.08), transparent 40%)',
            }}
          />
          {loadingConfig ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center space-y-3">
                <div className="w-12 h-12 border-4 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin mx-auto" />
                <p className="text-sm text-gray-400">正在加载海报配置...</p>
              </div>
            </div>
          ) : (
            <Canvas
              theme={currentTheme}
              elements={elements}
              selectedId={selectedId}
              customCss={customCss}
              onSelectElement={handleSelectElement}
              onUpdateElement={handleUpdateElement}
              canvasRef={canvasRef}
            />
          )}
        </main>

        {rightOpen && (
          <div
            className="lg:hidden absolute inset-0 bg-black/60 z-30 backdrop-blur-sm"
            onClick={() => setRightOpen(false)}
          />
        )}

        <aside
          className={`
            absolute lg:relative right-0 top-0 z-40 h-full w-64 shrink-0
            transform transition-transform duration-300 ease-out
            lg:translate-x-0
            ${rightOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}
          `}
        >
          <ExportButton canvasRef={canvasRef} config={config} />
        </aside>
      </div>
    </div>
  );
};

export default App;
