import React, { useRef, useState } from 'react';
import { isDarkBackground } from '../utils/colorUtils';

interface ColorCardProps {
  color: string;
  index: number;
  isSelected: boolean;
  isCopied: boolean;
  animationKey: number;
  slideDirection: 'in' | 'out' | 'none';
  onSelect: (index: number) => void;
  onCopy: (index: number) => void;
  onChange: (index: number, newColor: string) => void;
}

const ColorCard: React.FC<ColorCardProps> = React.memo(function ColorCard({
  color,
  index,
  isSelected,
  isCopied,
  animationKey,
  slideDirection,
  onSelect,
  onCopy,
  onChange,
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const isDark = isDarkBackground(color);
  const textColor = isDark ? '#ffffff' : '#333333';

  const handleCopyClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onCopy(index);
  };

  const handleDoubleClick = () => {
    fileInputRef.current?.click();
  };

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(index, e.target.value.toUpperCase());
  };

  const getSlideClass = () => {
    if (slideDirection === 'out') return 'slide-out-left';
    if (slideDirection === 'in') return 'slide-in-right';
    return '';
  };

  return (
    <div
      className={`color-card ${getSlideClass()}`}
      style={{
        animationDelay: `${index * 100}ms`,
        '--animation-key': animationKey,
      } as React.CSSProperties}
      onClick={() => onSelect(index)}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={`color-swatch ${isSelected ? 'selected' : ''}`}
        style={{ backgroundColor: color }}
      >
        {isSelected && <div className="pulse-ring" />}
        {isHovered && (
          <button
            className="copy-btn"
            onClick={handleCopyClick}
            style={{ color: textColor }}
            aria-label="复制颜色代码"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        )}
        {isCopied && (
          <div className="copied-tooltip">
            已复制
          </div>
        )}
      </div>
      <div className="color-code" style={{ color: textColor }}>
        {color}
      </div>
      <input
        ref={fileInputRef}
        type="color"
        value={color}
        onChange={handleColorChange}
        style={{ display: 'none' }}
      />
    </div>
  );
});

export default ColorCard;
