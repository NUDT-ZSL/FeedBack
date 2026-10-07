import React from 'react';
import { ToolType } from '../utils/pots';

interface ToolPanelProps {
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
  onReset: () => void;
  onScroll: () => void;
  isScrolling: boolean;
}

const tools: { type: ToolType; icon: string; label: string }[] = [
  { type: 'scissors', icon: '✂️', label: '剪刀' },
  { type: 'rock', icon: '🪨', label: '山石' },
  { type: 'water', icon: '💧', label: '水瓢' },
  { type: 'brush', icon: '🖌️', label: '毛笔' }
];

const ToolPanel: React.FC<ToolPanelProps> = ({
  activeTool,
  onToolChange,
  onReset,
  onScroll,
  isScrolling
}) => {
  return (
    <>
      <div className="tool-panel">
        {tools.map((tool) => (
          <div key={tool.type} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <button
              className={`tool-button ${activeTool === tool.type ? 'active' : ''} hoverable`}
              onClick={() => onToolChange(tool.type)}
              title={tool.label}
            >
              {tool.icon}
            </button>
            <span className="tool-label">{tool.label}</span>
          </div>
        ))}
      </div>
      
      <div className="instructions">
        <h3>使用说明</h3>
        <p>✂️ <strong>剪刀</strong>：点击选中枝叶，再点击修剪</p>
        <p>🪨 <strong>山石</strong>：点击放置山石，拖拽移动</p>
        <p>💧 <strong>水瓢</strong>：点击起点和终点绘制水流</p>
        <p>🖌️ <strong>毛笔</strong>：在空白处书写题字</p>
        <p style={{ marginTop: '10px', color: '#8d6e63' }}>滚轮缩放视图，拖拽调整布局</p>
      </div>
      
      <div className="action-buttons" style={{ marginTop: '15px' }}>
        <button className="action-button" onClick={onReset} disabled={isScrolling}>
          重置盆景
        </button>
        <button className="action-button primary" onClick={onScroll} disabled={isScrolling}>
          成卷
        </button>
      </div>
    </>
  );
};

export default ToolPanel;
