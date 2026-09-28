import React from 'react';

interface ToolbarProps {
  color: string;
  brushSize: number;
  tool: 'freehand' | 'rectangle' | 'circle' | 'line' | 'text' | 'sticker';
  sticker: string;
  onColorChange: (color: string) => void;
  onBrushSizeChange: (size: number) => void;
  onToolChange: (tool: ToolbarProps['tool']) => void;
  onStickerSelect: (sticker: string) => void;
  onClear: () => void;
}

const tools: { id: ToolbarProps['tool']; emoji: string; label: string }[] = [
  { id: 'freehand', emoji: '✏️', label: '画笔' },
  { id: 'rectangle', emoji: '⬜', label: '矩形' },
  { id: 'circle', emoji: '⭕', label: '圆形' },
  { id: 'line', emoji: '📏', label: '直线' },
  { id: 'text', emoji: '🔤', label: '文字' },
  { id: 'sticker', emoji: '🎭', label: '贴纸' },
];

const stickers = ['😊', '⭐', '❤️', '⚡', '🎵'];

const Toolbar: React.FC<ToolbarProps> = ({
  color,
  brushSize,
  tool,
  sticker,
  onColorChange,
  onBrushSizeChange,
  onToolChange,
  onStickerSelect,
  onClear,
}) => {
  const baseButtonStyle: React.CSSProperties = {
    borderRadius: '8px',
    padding: '6px 12px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    cursor: 'pointer',
    transition: '0.2s ease',
    color: '#fff',
    fontSize: '14px',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    whiteSpace: 'nowrap',
  };

  const handleClear = () => {
    if (window.confirm('确定清除画布？')) {
      onClear();
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        background: 'rgba(255,255,255,0.1)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        padding: '8px 16px',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        overflowX: 'auto',
      }}
    >
      <style>{`
        @media (max-width: 768px) {
          .toolbar-btn { padding: 4px 8px !important; font-size: 12px !important; }
          .toolbar-btn .toolbar-label { display: none; }
          .toolbar-slider { width: 60px !important; }
          .toolbar-size-val { display: none; }
        }
      `}</style>

      {tools.map((t) => (
        <button
          key={t.id}
          className="toolbar-btn"
          style={{
            ...baseButtonStyle,
            border: tool === t.id ? `2px solid ${color}` : '1px solid rgba(255,255,255,0.1)',
            background: tool === t.id ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)',
          }}
          onMouseEnter={(e) => {
            if (tool !== t.id) {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.15)';
            }
          }}
          onMouseLeave={(e) => {
            if (tool !== t.id) {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)';
            }
          }}
          onClick={() => onToolChange(t.id)}
        >
          <span>{t.emoji}</span>
          <span className="toolbar-label">{t.label}</span>
        </button>
      ))}

      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <div
          style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            background: color,
            border: '2px solid rgba(255,255,255,0.3)',
            cursor: 'pointer',
            position: 'relative',
            overflow: 'hidden',
          }}
          onClick={(e) => {
            const input = (e.currentTarget as HTMLDivElement).querySelector('input');
            if (input) input.click();
          }}
        >
          <input
            type="color"
            value={color}
            onChange={(e) => onColorChange(e.target.value)}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              opacity: 0,
              cursor: 'pointer',
            }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <input
          className="toolbar-slider"
          type="range"
          min={1}
          max={20}
          value={brushSize}
          onChange={(e) => onBrushSizeChange(Number(e.target.value))}
          style={{ width: '80px', cursor: 'pointer' }}
        />
        <span className="toolbar-size-val" style={{ color: '#fff', fontSize: '12px', minWidth: '20px' }}>
          {brushSize}
        </span>
      </div>

      {tool === 'sticker' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {stickers.map((s) => (
            <button
              key={s}
              className="toolbar-btn"
              style={{
                ...baseButtonStyle,
                padding: '4px 8px',
                border: sticker === s ? `2px solid ${color}` : '1px solid rgba(255,255,255,0.1)',
                background: sticker === s ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)',
                fontSize: '18px',
              }}
              onMouseEnter={(e) => {
                if (sticker !== s) {
                  (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.15)';
                }
              }}
              onMouseLeave={(e) => {
                if (sticker !== s) {
                  (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)';
                }
              }}
              onClick={() => onStickerSelect(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <button
        className="toolbar-btn"
        style={{
          ...baseButtonStyle,
          color: '#ff4444',
          borderColor: 'rgba(255,68,68,0.3)',
          marginLeft: 'auto',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,68,68,0.15)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)';
        }}
        onClick={handleClear}
      >
        🗑️ <span className="toolbar-label">清除</span>
      </button>
    </div>
  );
};

export default Toolbar;
