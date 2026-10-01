import React from 'react';

interface InkRollerProps {
  inkLevel: number;
  onInkLevelChange: (level: number) => void;
  disabled?: boolean;
}

const InkRoller: React.FC<InkRollerProps> = ({ inkLevel, onInkLevelChange, disabled }) => {
  const getInkColor = () => {
    const ratio = inkLevel / 100;
    const r = Math.round(170 - ratio * 136);
    const g = Math.round(170 - ratio * 136);
    const b = Math.round(170 - ratio * 136);
    return `rgb(${r}, ${g}, ${b})`;
  };

  const getRollerBackground = () => {
    const color = getInkColor();
    return `linear-gradient(180deg, 
      ${color} 0%, 
      ${adjustColor(color, -20)} 30%, 
      ${adjustColor(color, -40)} 50%, 
      ${adjustColor(color, -20)} 70%, 
      ${color} 100%)`;
  };

  const adjustColor = (color: string, amount: number) => {
    const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (!match) return color;
    const r = Math.max(0, Math.min(255, parseInt(match[1]) + amount));
    const g = Math.max(0, Math.min(255, parseInt(match[2]) + amount));
    const b = Math.max(0, Math.min(255, parseInt(match[3]) + amount));
    return `rgb(${r}, ${g}, ${b})`;
  };

  return (
    <div className="ink-roller-container">
      <h3 className="ink-roller-title">墨辊 - 调节墨量</h3>
      
      <div 
        className="ink-roller-visual"
        style={{ background: getRollerBackground() }}
      />
      
      <div className="ink-slider-container">
        <input
          type="range"
          min="0"
          max="100"
          value={inkLevel}
          onChange={(e) => onInkLevelChange(parseInt(e.target.value))}
          className="ink-slider"
          disabled={disabled}
        />
        <span className="ink-value">{inkLevel}%</span>
      </div>
      
      <p className="hint-text">
        {inkLevel < 20 
          ? '⚠️ 墨量过低，印刷可能出现断墨白点' 
          : inkLevel > 80 
            ? '墨量充足，印刷清晰' 
            : '墨量适中'}
      </p>
    </div>
  );
};

export default InkRoller;
