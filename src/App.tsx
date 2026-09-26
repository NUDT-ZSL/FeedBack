import React, { useState, useCallback, useEffect } from 'react';
import ColorPaletteDisplay from './colorPaletteDisplay';
import FavoritesPanel from './favoritesPanel';
import { generatePalette } from './colorGenerator';
import { store } from './store';
import type { ColorPalette } from './types';

const App: React.FC = () => {
  const [palette, setPalette] = useState<ColorPalette>(() => generatePalette());
  const [animKey, setAnimKey] = useState(0);
  const [favExpanded, setFavExpanded] = useState(false);
  const [favCount, setFavCount] = useState(store.getFavorites().length);
  const [genBtnHover, setGenBtnHover] = useState(false);
  const [exportBtnHover, setExportBtnHover] = useState(false);
  const [toggleBtnHover, setToggleBtnHover] = useState(false);

  const regenerate = useCallback(() => {
    setPalette(generatePalette());
    setAnimKey((k) => k + 1);
  }, []);

  useEffect(() => {
    const unsub = store.subscribe(() => {
      setFavCount(store.getFavorites().length);
    });
    return unsub;
  }, []);

  const handleReload = useCallback((p: ColorPalette) => {
    setPalette({ ...p, id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36) });
    setAnimKey((k) => k + 1);
  }, []);

  const handleFavoritesChange = useCallback(() => {
    setFavCount(store.getFavorites().length);
  }, []);

  const handleExport = useCallback(() => {
    store.exportToJSON();
  }, []);

  const toggleFav = useCallback(() => {
    setFavExpanded((v) => !v);
  }, []);

  const btnBase: React.CSSProperties = {
    padding: '10px 22px',
    borderRadius: 24,
    border: 'none',
    cursor: 'pointer',
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: 0.3,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    transition: 'background-color 0.2s ease-out, transform 0.2s ease-out, box-shadow 0.2s ease-out',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    userSelect: 'none',
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#212121',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        padding: '40px 16px',
        color: '#FFFFFF',
      }}
    >
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 20,
            paddingBottom: 24,
            borderBottom: '1px solid #333333',
            marginBottom: 24,
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: 0.5,
                background: 'linear-gradient(90deg, #42A5F5, #AB47BC, #EF5350)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              配色方案灵感生成器
            </h1>
            <p style={{ margin: '6px 0 0', color: '#9E9E9E', fontSize: 13 }}>
              随机生成和谐5色调色板 · 收藏管理 · 微调对比
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={regenerate}
              onMouseEnter={() => setGenBtnHover(true)}
              onMouseLeave={() => setGenBtnHover(false)}
              style={{
                ...btnBase,
                backgroundColor: genBtnHover ? '#42A5F5' : '#1E88E5',
                transform: genBtnHover ? 'translateY(-2px)' : 'translateY(0)',
                boxShadow: genBtnHover
                  ? '0 6px 16px rgba(66,165,245,0.4)'
                  : '0 2px 8px rgba(0,0,0,0.3)',
              }}
            >
              🎲 随机生成
            </button>
            <button
              onClick={handleExport}
              onMouseEnter={() => setExportBtnHover(true)}
              onMouseLeave={() => setExportBtnHover(false)}
              disabled={favCount === 0}
              style={{
                ...btnBase,
                backgroundColor: favCount === 0
                  ? '#555555'
                  : exportBtnHover
                  ? '#42A5F5'
                  : '#1E88E5',
                transform: exportBtnHover && favCount > 0 ? 'translateY(-2px)' : 'translateY(0)',
                boxShadow: exportBtnHover && favCount > 0
                  ? '0 6px 16px rgba(66,165,245,0.4)'
                  : '0 2px 8px rgba(0,0,0,0.3)',
                cursor: favCount === 0 ? 'not-allowed' : 'pointer',
                opacity: favCount === 0 ? 0.6 : 1,
              }}
            >
              📤 导出收藏{favCount > 0 ? ` (${favCount})` : ''}
            </button>
            <button
              onClick={toggleFav}
              onMouseEnter={() => setToggleBtnHover(true)}
              onMouseLeave={() => setToggleBtnHover(false)}
              style={{
                ...btnBase,
                backgroundColor: favExpanded
                  ? '#E53935'
                  : toggleBtnHover
                  ? '#42A5F5'
                  : '#1E88E5',
                transform: toggleBtnHover ? 'translateY(-2px)' : 'translateY(0)',
                boxShadow: favExpanded
                  ? '0 6px 16px rgba(229,57,53,0.4)'
                  : toggleBtnHover
                  ? '0 6px 16px rgba(66,165,245,0.4)'
                  : '0 2px 8px rgba(0,0,0,0.3)',
              }}
            >
              {favExpanded ? '收起收藏夹' : '📂 收藏夹'}
            </button>
          </div>
        </header>

        <div
          style={{
            backgroundColor: '#2A2A2A',
            borderRadius: 16,
            border: '1px solid #333333',
            overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          }}
        >
          <ColorPaletteDisplay
            palette={palette}
            animationKey={animKey}
            onFavoriteChange={handleFavoritesChange}
          />
        </div>

        <FavoritesPanel
          expanded={favExpanded}
          onReload={handleReload}
          onFavoritesChange={handleFavoritesChange}
        />

        <footer
          style={{
            marginTop: 40,
            textAlign: 'center',
            color: '#616161',
            fontSize: 12,
            padding: '16px 0',
          }}
        >
          提示：点击色块查看色值详情，点击右下角心形收藏方案，展开收藏夹可微调颜色
        </footer>
      </div>
    </div>
  );
};

export default App;
