import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ColorCard from './components/ColorCard';
import {
  PresetName,
  calculateContrast,
  generateHarmoniousPalette,
  getPresetPalette,
  presetNames,
} from './utils/colorUtils';
import {
  HistoryState,
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  commitHistory,
  createInitialHistory,
  editColorHistory,
  redoHistory,
  undoHistory,
} from './utils/paletteHistory';

type SlideDirection = 'in' | 'out' | 'none';

function App() {
  const [historyState, setHistoryState] = useState<HistoryState>(() =>
    createInitialHistory(generateHarmoniousPalette())
  );
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [animationKey, setAnimationKey] = useState<number>(0);
  const [slideDirections, setSlideDirections] = useState<SlideDirection[]>([
    'none',
    'none',
    'none',
    'none',
    'none',
  ]);
  const [displayedContrastBlack, setDisplayedContrastBlack] = useState<number>(0);
  const [displayedContrastWhite, setDisplayedContrastWhite] = useState<number>(0);
  const presetTimersRef = useRef<number[]>([]);
  const lastColorEditRef = useRef<{ index: number; time: number } | null>(null);
  const selectedIndexRef = useRef(0);
  selectedIndexRef.current = selectedIndex;

  const currentSnapshot = historyState.snapshots[historyState.index];
  const palette = currentSnapshot.palette;
  const canUndo = historyCanUndo(historyState);
  const canRedo = historyCanRedo(historyState);

  const clearPresetTimers = useCallback(() => {
    presetTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    presetTimersRef.current = [];
  }, []);

  useEffect(() => {
    return () => clearPresetTimers();
  }, [clearPresetTimers]);

  // 撤销/重做后同步快照里保存的选中态
  useEffect(() => {
    setSelectedIndex(currentSnapshot.selectedIndex);
  }, [currentSnapshot]);

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

  // 提交一条新历史：截断重做分支后入栈，并触发色块动画
  const commitSnapshot = useCallback(
    (
      palette: Parameters<typeof commitHistory>[1],
      nextSelectedIndex: number,
      kind: 'refresh' | 'preset'
    ) => {
      clearPresetTimers();
      lastColorEditRef.current = null;
      setHistoryState((prev) =>
        commitHistory(prev, palette, nextSelectedIndex, kind)
      );
      setSelectedIndex(nextSelectedIndex);
      setAnimationKey((prev) => prev + 1);
    },
    [clearPresetTimers]
  );

  const handleRefresh = useCallback(() => {
    commitSnapshot(generateHarmoniousPalette(), 0, 'refresh');
    setSlideDirections(['none', 'none', 'none', 'none', 'none']);
  }, [commitSnapshot]);

  const handlePresetClick = useCallback(
    (presetName: PresetName) => {
      const newPalette = getPresetPalette(presetName);
      commitSnapshot(newPalette, 0, 'preset');

      setSlideDirections(['out', 'out', 'out', 'out', 'out']);
      const inTimer = window.setTimeout(() => {
        setSlideDirections(['in', 'in', 'in', 'in', 'in']);
        const resetTimer = window.setTimeout(() => {
          setSlideDirections(['none', 'none', 'none', 'none', 'none']);
        }, 400);
        presetTimersRef.current.push(resetTimer);
      }, 400);
      presetTimersRef.current.push(inTimer);
    },
    [commitSnapshot]
  );

  const handleUndo = useCallback(() => {
    if (!canUndo) return;
    setHistoryState((prev) => undoHistory(prev));
    clearPresetTimers();
    lastColorEditRef.current = null;
    setSlideDirections(['none', 'none', 'none', 'none', 'none']);
    setAnimationKey((prev) => prev + 1);
  }, [canUndo, clearPresetTimers]);

  const handleRedo = useCallback(() => {
    if (!canRedo) return;
    setHistoryState((prev) => redoHistory(prev));
    clearPresetTimers();
    lastColorEditRef.current = null;
    setSlideDirections(['none', 'none', 'none', 'none', 'none']);
    setAnimationKey((prev) => prev + 1);
  }, [canRedo, clearPresetTimers]);

  const handleSelect = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  const handleCopy = useCallback(async (index: number) => {
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
  }, [palette]);

  const handleColorChange = useCallback((index: number, newColor: string) => {
    const now = Date.now();
    setHistoryState((prev) => {
      const result = editColorHistory(
        prev,
        index,
        newColor,
        selectedIndexRef.current,
        lastColorEditRef.current,
        now
      );
      if (result.changed) {
        lastColorEditRef.current = { index, time: now };
      }
      return result.state;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) {
        handleRedo();
      } else {
        handleUndo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

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

        <div className="history-group">
          <button
            className="btn history-btn"
            onClick={handleUndo}
            disabled={!canUndo}
            aria-label="撤销"
            title="撤销 (Ctrl+Z)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
            title="重做 (Ctrl+Shift+Z)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 7v6h-6" />
              <path d="M3 17a9 9 0 0 1 15-6.7L21 13" />
            </svg>
            重做
          </button>
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
        <span>提示：点击色块设为主色，双击修改颜色，悬停复制代码，Ctrl+Z 撤销 / Ctrl+Shift+Z 重做</span>
      </div>
    </div>
  );
}

export default App;
