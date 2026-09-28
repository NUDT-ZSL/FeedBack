import React from 'react';

interface ToolbarProps {
  isConnectMode: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onToggleConnectMode: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onExport: () => void;
}

const Toolbar: React.FC<ToolbarProps> = ({
  isConnectMode,
  canUndo,
  canRedo,
  onToggleConnectMode,
  onUndo,
  onRedo,
  onExport,
}) => {
  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <h1 className="app-title">手绘流程图编辑器</h1>
      </div>
      <div className="toolbar-right">
        <button
          className={`toolbar-btn ${isConnectMode ? 'active' : ''}`}
          onClick={onToggleConnectMode}
          title="连线工具"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
          <span>连线</span>
        </button>
        <button
          className="toolbar-btn"
          onClick={onUndo}
          disabled={!canUndo}
          title="撤销 (Ctrl+Z)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 7" />
          </svg>
          <span>撤销</span>
        </button>
        <button
          className="toolbar-btn"
          onClick={onRedo}
          disabled={!canRedo}
          title="重做 (Ctrl+Shift+Z)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 7v6h-6M21 13a9 9 0 1 1-3-7.7L21 7" />
          </svg>
          <span>重做</span>
        </button>
        <button className="toolbar-btn export-btn" onClick={onExport} title="导出PNG">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
          <span>导出</span>
        </button>
      </div>
    </div>
  );
};

export default Toolbar;
