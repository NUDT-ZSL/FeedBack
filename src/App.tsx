import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ColorCard from './components/ColorCard';
import {
  ColorInfo,
  PresetName,
  calculateContrast,
  generateHarmoniousPalette,
  getPresetPalette,
  presetNames,
  adjustColorBrightness,
} from './utils/colorUtils';

type SlideDirection = 'in' | 'out' | 'none';

function App() {
  const [palette, setPalette] = useState<ColorInfo[]>([]);
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
  const isAnimatingRef = useRef(false);

  useEffect(() => {
    const initialPalette = generateHarmoniousPalette();
    setPalette(initialPalette);
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

  const handleRefresh = useCallback(() => {
    if (isAnimatingRef.current) return;
    isAnimatingRef.current = true;

    const newPalette = generateHarmoniousPalette();
    setPalette(newPalette);
    setAnimationKey((prev) => prev + 1);
    setSelectedIndex(0);

    setTimeout(() => {
      isAnimatingRef.current = false;
    }, 800);
  }, []);

  const handlePresetClick = useCallback(
    (presetName: PresetName) => {
      if (isAnimatingRef.current) return;
      isAnimatingRef.current = true;

      setSlideDirections(['out', 'out', 'out', 'out', 'out']);

      setTimeout(() => {
        const newPalette = getPresetPalette(presetName);
        setPalette(newPalette);
        setSelectedIndex(0);
        setSlideDirections(['in', 'in', 'in', 'in', 'in']);

        setTimeout(() => {
          setSlideDirections(['none', 'none', 'none', 'none', 'none']);
          isAnimatingRef.current = false;
        }, 400);
      }, 400);
    },
    []
  );

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
    setPalette((prev) => {
      const newPalette = [...prev];
      newPalette[index] = { ...newPalette[index], hex: newColor };
      return newPalette;
    });
  }, []);

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
            key={index}
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
        <span>提示：点击色块设为主色，双击修改颜色，悬停复制代码</span>
      </div>
    </div>
  );
}

export default App;
