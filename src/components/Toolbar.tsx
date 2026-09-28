import React from 'react';
import type { ComponentType } from '../types';
import { useAppStore } from '../store';

interface ToolItem {
  type: ComponentType | null;
  icon: string;
  label: string;
  tooltip: string;
  action?: 'undo' | 'redo' | 'preview' | 'edit';
  isControl?: boolean;
}

const COMPONENT_TOOLS: ToolItem[] = [
  { type: 'button', icon: '🔲', label: '按钮', tooltip: '按钮组件 (B)' },
  { type: 'input', icon: '📝', label: '输入', tooltip: '输入框 (I)' },
  { type: 'list', icon: '📋', label: '列表', tooltip: '列表 (L)' },
  { type: 'navbar', icon: '📌', label: '导航', tooltip: '导航栏 (N)' },
  { type: 'image', icon: '🖼️', label: '图片', tooltip: '图片占位 (M)' },
  { type: 'text', icon: '📄', label: '文本', tooltip: '文本 (T)' },
  { type: 'card', icon: '🗂️', label: '卡片', tooltip: '卡片 (C)' },
  { type: 'checkbox', icon: '☑️', label: '勾选', tooltip: '复选框 (K)' },
  { type: 'dropdown', icon: '🔽', label: '下拉', tooltip: '下拉选择 (D)' },
];

const HISTORY_TOOLS: ToolItem[] = [
  { type: null, icon: '↩️', label: '撤销', tooltip: '撤销 (Ctrl+Z)', action: 'undo' },
  { type: null, icon: '↪️', label: '重做', tooltip: '重做 (Ctrl+Y)', action: 'redo' },
];

interface ToolbarProps {
  onDragStartComponent: (type: ComponentType) => void;
}

const Toolbar: React.FC<ToolbarProps> = ({ onDragStartComponent }) => {
  const { undo, redo, undoStack, redoStack, viewMode, setViewMode } = useAppStore();

  const handleComponentClick = (type: ComponentType) => {
    onDragStartComponent(type);
  };

  return (
    <div className="toolbar">
      <div className="toolbar-section">
        {COMPONENT_TOOLS.map((tool) => (
          <button
            key={tool.type}
            className="tool-btn"
            onClick={() => handleComponentClick(tool.type!)}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('componentType', tool.type!);
              e.dataTransfer.effectAllowed = 'copy';
              onDragStartComponent(tool.type!);
            }}
          >
            <span className="tool-icon">{tool.icon}</span>
            <span className="tool-label">{tool.label}</span>
            <span className="tooltip">{tool.tooltip}</span>
          </button>
        ))}
      </div>

      <div className="toolbar-section">
        {HISTORY_TOOLS.map((tool, i) => (
          <button
            key={i}
            className="tool-btn"
            onClick={() => (tool.action === 'undo' ? undo() : redo())}
            disabled={
              tool.action === 'undo' ? undoStack.length === 0 : redoStack.length === 0
            }
          >
            <span className="tool-icon">{tool.icon}</span>
            <span className="tool-label">{tool.label}</span>
            <span className="tooltip">{tool.tooltip}</span>
          </button>
        ))}
      </div>

      <div className="toolbar-section">
        <button
          className={`tool-btn ${viewMode === 'preview' ? 'active' : ''}`}
          onClick={() => setViewMode(viewMode === 'preview' ? 'edit' : 'preview')}
        >
          <span className="tool-icon">{viewMode === 'preview' ? '✏️' : '👁️'}</span>
          <span className="tool-label">{viewMode === 'preview' ? '编辑' : '预览'}</span>
          <span className="tooltip">
            {viewMode === 'preview' ? '切换到编辑模式' : '切换到预览模式 (P)'}
          </span>
        </button>
      </div>
    </div>
  );
};

export default Toolbar;
