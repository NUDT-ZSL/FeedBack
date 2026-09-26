import React, { useState, useEffect } from 'react';
import { AppContextProvider } from './context/AppContext';
import ColorPanel from './components/ColorPanel';
import CanvasPreview from './components/CanvasPreview';
import HistoryPanel from './components/HistoryPanel';

type TabType = 'colors' | 'history';

const AppContent: React.FC = () => {
  const [isCompact, setIsCompact] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('colors');

  useEffect(() => {
    const checkWidth = () => {
      setIsCompact(window.innerWidth < 1024);
    };
    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, []);

  if (isCompact) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          background: '#FAFAFA',
          minWidth: 320,
        }}
      >
        <div
          style={{
            display: 'flex',
            background: '#FFFFFF',
            borderBottom: '1px solid #E8E8E8',
          }}
        >
          <button
            onClick={() => setActiveTab('colors')}
            style={{
              flex: 1,
              padding: '14px 20px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'colors' ? '2px solid #1976D2' : '2px solid transparent',
              color: activeTab === 'colors' ? '#1976D2' : '#757575',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.3s ease',
            }}
          >
            🎨 颜色面板
          </button>
          <button
            onClick={() => setActiveTab('history')}
            style={{
              flex: 1,
              padding: '14px 20px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'history' ? '2px solid #1976D2' : '2px solid transparent',
              color: activeTab === 'history' ? '#1976D2' : '#757575',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.3s ease',
            }}
          >
            📋 历史记录
          </button>
        </div>

        {activeTab === 'colors' && (
          <div style={{ height: 280, flexShrink: 0 }}>
            <ColorPanel />
          </div>
        )}
        {activeTab === 'history' && (
          <div style={{ height: 280, flexShrink: 0 }}>
            <HistoryPanel />
          </div>
        )}

        <div style={{ flex: 1, overflow: 'hidden' }}>
          <CanvasPreview />
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        background: '#FAFAFA',
        minWidth: 1024,
        overflow: 'hidden',
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
      }}
    >
      <ColorPanel />
      <CanvasPreview />
      <HistoryPanel />
    </div>
  );
};

const App: React.FC = () => {
  return (
    <AppContextProvider>
      <AppContent />
    </AppContextProvider>
  );
};

export default App;
