import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ColorCard from './components/ColorCard';
import {
  ColorInfo,
  PresetName,
  calculateContrast,
  generateHarmoniousPalette,
  getPresetPalette,
  presetNames,
} from './utils/colorUtils';

type SlideDirection = 'in' | 'out' | 'none';

interface PaletteSnapshot {
  palette: ColorInfo[];
  selectedIndex: number;
}

interface HistoryState {
  entries: PaletteSnapshot[];
  index: number;
}

const NO_SLIDE: SlideDirection[] = ['none', 'none', 'none', 'none', 'none'];
const SLIDE_IN: SlideDirection[] = ['in', 'in', 'in', 'in', 'in'];

function App() {
  const [history, setHistory] = useState<HistoryState>(() => ({
    entries: [{ palette: generateHarmoniousPalette(), selectedIndex: 0 }],
    index: 0,
  }));
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [animationKey, setAnimationKey] = useState<number>(0);
  const [slideDirections, setSlideDirections] = useState<SlideDirection[]>(NO_SLIDE);
  const [displayedContrastBlack, setDisplayedContrastBlack] = useState<number>(0);
  const [displayedContrastWhite, setDisplayedContrastWhite] = useState<number>(0);
  const slideResetTimeoutRef = useRef<number | null>(null);

  const present = history.entries[history.index];
  const palette = present?.palette ?? [];
  const selectedIndex = present?.selectedIndex ?? 0;
  const canUndo = history.index > 0;
  const canRedo = history.index < history.entries.length - 1;

  const commitSnapshot = useCallback((snapshot: PaletteSnapshot) => {
    setHistory((prev) => {
      const entries = [...prev.entries.slice(0, prev.index + 1), snapshot];
      return { entries, index: entries.length - 1 };
    });
  }, []);

  const replayCardAnimation = useCallback(() => {
    if (slideResetTimeoutRef.current !== null) {
      window.clearTimeout(slideResetTimeoutRef.current);
      slideResetTimeoutRef.current = null;
    }
    setSlideDirections(NO_SLIDE);
    setAnimationKey((prev) => prev + 1);
  }, []);

  const handleUndo = useCallback(() => {
    if (!canUndo) return;
    setHistory((prev) =>
      prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev
    );
    replayCardAnimation();
  }, [canUndo, replayCardAnimation]);

  const handleRedo = useCallback(() => {
    if (!canRedo) return;
    setHistory((prev) =>
      prev.index < prev.entries.length - 1
        ? { ...prev, index: prev.index + 1 }
        : prev
    );
    replayCardAnimation();
  }, [canRedo, replayCardAnimation]);

  const handleRefresh = useCallback(() => {
    commitSnapshot({ palette: generateHarmoniousPalette(), selectedIndex: 0 });
    replayCardAnimation();
  }, [commitSnapshot, replayCardAnimation]);

  const handlePresetClick = useCallback(
    (presetName: PresetName) => {
      commitSnapshot({ palette: getPresetPalette(presetName), selectedIndex: 0 });

      setAnimationKey((prev) => prev + 1);
      setSlideDirections(SLIDE_IN);
      if (slideResetTimeoutRef.current !== null) {
        window.clearTimeout(slideResetTimeoutRef.current);
      }
      slideResetTimeoutRef.current = window.setTimeout(() => {
        setSlideDirections(NO_SLIDE);
        slideResetTimeoutRef.current = null;
      }, 400);
    },
    [commitSnapshot]
  );

  const handleSelect = useCallback((index: number) => {
    setHistory((prev) => {
      const current = prev.entries[prev.index];
      if (!current || current.selectedIndex === index) return prev;
      const entries = [...prev.entries];
      entries[prev.index] = { ...current, selectedIndex: index };
      return { ...prev, entries };
    });
  }, []);

  const handleCopy = useCallback(
    async (index: number) => {
      const color = palette[index]?.hex;
      if (!color) return;

      try {
        await navigator.clipboard.writeText(color);
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 1500);
      } catch {
        const textArea = document.createElement('textarea');
        textArea.value = color;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 1500);
      }
    },
    [palette]
  );

  const handleColorChange = useCallback((index: number, newColor: string) => {
    setHistory((prev) => {
      const current = prev.entries[prev.index];
      const target = current?.palette[index];
      if (!current || !target) return prev;

      const normalizedColor = newColor.toUpperCase();
      if (target.hex.toUpperCase() === normalizedColor) return prev;

      const newPalette = [...current.palette];
      newPalette[index] = { ...target, hex: normalizedColor };
      const entries = [
        ...prev.entries.slice(0, prev.index + 1),
        { palette: newPalette, selectedIndex: current.selectedIndex },
      ];
      return { entries, index: entries.length - 1 };
    });
  }, []);

  const mainColor = palette[selectedIndex]?.hex || '#000000';

  const contrastWithBlack = useMemo(() => {
    if (!mainColor) return { ratio: 0, level: 'Fail' as const };
    return calculateContrast(mainColor, '#000000');
  }, [mainColor]);

  const contrastWithWhite = useMemo(() => {
    if (!mainColor) return { ratio: 0, level: 'Fail' as const };
    return calculateContrast(mainColor, '#ffffff');
  }, [mainColor]);

  useEffect(() => {
    let animationFrame: number;
    const startTime = performance.now();
    const duration = 500;
    const startBlack = displayedContrastBlack;
    const startWhite = displayedContrastWhite;
    const endBlack = contrastWithBlack.ratio;
    const endWhite = contrastWithWhite.ratio;

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);

      setDisplayedContrastBlack(
        Math.round((startBlack + (endBlack - startBlack) * easeOut) * 100) / 100
      );
      setDisplayedContrastWhite(
        Math.round((startWhite + (endWhite - startWhite) * easeOut) * 100) / 100
      );

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [contrastWithBlack.ratio, contrastWithWhite.ratio]);

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'AAA':
        return '#22c55e';
      case 'AA':
        return '#eab308';
      default:
        return '#ef4444';
    }
  };

  if (palette.length === 0) {
    return (
      <div className="app-container">
        <div className="loading">加载中...</div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <h1 className="app-title">配色探索面板</h1>
      <p className="app-subtitle">快速生成和谐色板，提升配色效率</p>

      <div className="palette-container">
        {palette.map((colorInfo, index) => (
          <ColorCard
            key={`${index}-${animationKey}`}
            color={colorInfo.hex}
            index={index}
            isSelected={index === selectedIndex}
            isCopied={index === copiedIndex}
            animationKey={animationKey}
            slideDirection={slideDirections[index]}
            onSelect={handleSelect}
            onCopy={handleCopy}
            onChange={handleColorChange}
          />
        ))}
      </div>

      <div className="toolbar">
        <div className="history-group">
          <button
            className="btn history-btn"
            onClick={handleUndo}
            disabled={!canUndo}
            aria-label="撤销"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7v6h6" />
              <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
            </svg>
            撤销
          </button>
          <button
            className="btn history-btn"
            onClick={handleRedo}
            disabled={!canRedo}
            aria-label="重做"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 7v6h-6" />
              <path d="M3 17a9 9 0 0 1 15-6.7L21 13" />
            </svg>
            重做
          </button>
        </div>

        <button className="btn refresh-btn" onClick={handleRefresh}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
          </svg>
          刷新
        </button>

        <div className="preset-group">
          {(Object.keys(presetNames) as PresetName[]).map((preset) => (
            <button
              key={preset}
              className="btn preset-btn"
              onClick={() => handlePresetClick(preset)}
            >
              {presetNames[preset]}
            </button>
          ))}
        </div>

        <div className="contrast-preview">
          <span className="contrast-label">对比度预览</span>
          <div className="contrast-items">
            <div
              className="contrast-item"
              style={{ backgroundColor: mainColor, color: '#000000' }}
            >
              <span className="contrast-text">Aa</span>
              <div className="contrast-info">
                <span className="contrast-value">{displayedContrastBlack.toFixed(2)}</span>
                <span
                  className="contrast-level"
                  style={{ color: getLevelColor(contrastWithBlack.level) }}
                >
                  {contrastWithBlack.level}
                </span>
              </div>
            </div>
            <div
              className="contrast-item"
              style={{ backgroundColor: mainColor, color: '#ffffff' }}
            >
              <span className="contrast-text">Aa</span>
              <div className="contrast-info">
                <span className="contrast-value">{displayedContrastWhite.toFixed(2)}</span>
                <span
                  className="contrast-level"
                  style={{ color: getLevelColor(contrastWithWhite.level) }}
                >
                  {contrastWithWhite.level}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="tips">
        <span>提示：点击色块设为主色，双击修改颜色，悬停复制代码；支持撤销 / 重做色板历史</span>
      </div>
    </div>
  );
}

export default App;
