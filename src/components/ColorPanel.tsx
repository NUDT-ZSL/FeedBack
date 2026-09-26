import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useAppContext, ColorItem } from '../context/AppContext';
import { parseColor, isLightColor, getSuggestedPair } from '../utils/contrastCalculator';

const NODE_SIZE = 48;

const ColorPanel: React.FC = () => {
  const { state, addColor, removeColor, updateColorPosition, selectColor, handleCollisions, addHistory } =
    useAppContext();
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState('');
  const [isDragging, setIsDragging] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAddColor = useCallback(() => {
    const hex = parseColor(inputValue);
    if (!hex) {
      setInputError('无效的颜色值，请输入 HEX/RGB/HSL 格式');
      return;
    }
    if (state.colors.length >= 5) {
      setInputError('最多只能添加 5 种颜色');
      return;
    }
    addColor(hex);
    setInputValue('');
    setInputError('');
    addHistory(0);
  }, [inputValue, state.colors.length, addColor, addHistory]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleAddColor();
      }
    },
    [handleAddColor]
  );

  const handleImageUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(img, 0, 0);
          try {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            const colorMap = new Map<string, number>();
            const step = Math.max(1, Math.floor((canvas.width * canvas.height) / 1000));
            for (let i = 0; i < imageData.length; i += 4 * step) {
              const r = Math.round(imageData[i] / 32) * 32;
              const g = Math.round(imageData[i + 1] / 32) * 32;
              const b = Math.round(imageData[i + 2] / 32) * 32;
              const key = `${r},${g},${b}`;
              colorMap.set(key, (colorMap.get(key) || 0) + 1);
            }
            const sorted = Array.from(colorMap.entries()).sort((a, b) => b[1] - a[1]);
            let added = 0;
            for (const [key] of sorted) {
              if (added >= 3 || state.colors.length + added >= 5) break;
              const [r, g, b] = key.split(',').map(Number);
              const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
              addColor(hex);
              added++;
            }
            addHistory(0);
          } catch (err) {
            setInputError('图片解析失败');
          }
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    },
    [addColor, state.colors.length, addHistory]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, color: ColorItem) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return;
      setIsDragging(color.id);
      selectColor(color.id);
      setDragOffset({
        x: e.clientX - rect.left - color.position.x - NODE_SIZE / 2,
        y: e.clientY - rect.top - color.position.y - NODE_SIZE / 2,
      });
    },
    [selectColor]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return;
      let newX = e.clientX - rect.left - dragOffset.x - NODE_SIZE / 2;
      let newY = e.clientY - rect.top - dragOffset.y - NODE_SIZE / 2;
      const maxX = rect.width - NODE_SIZE - 8;
      const maxY = rect.height - NODE_SIZE - 8;
      newX = Math.max(8, Math.min(maxX, newX));
      newY = Math.max(8, Math.min(maxY, newY));
      updateColorPosition(isDragging, newX, newY);
    };

    const handleMouseUp = () => {
      if (isDragging) {
        handleCollisions(isDragging);
        addHistory(0);
      }
      setIsDragging(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset, updateColorPosition, handleCollisions, addHistory]);

  const handleNodeClick = useCallback(
    (e: React.MouseEvent, color: ColorItem) => {
      e.stopPropagation();
      if (!isDragging) {
        selectColor(state.selectedColorId === color.id ? null : color.id);
      }
    },
    [isDragging, selectColor, state.selectedColorId]
  );

  const renderConnections = () => {
    const colors = state.colors;
    if (colors.length < 2) return null;
    const lines: JSX.Element[] = [];
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) {
        const c1 = colors[i];
        const c2 = colors[j];
        lines.push(
          <line
            key={`${c1.id}-${c2.id}`}
            x1={c1.position.x + NODE_SIZE / 2}
            y1={c1.position.y + NODE_SIZE / 2}
            x2={c2.position.x + NODE_SIZE / 2}
            y2={c2.position.y + NODE_SIZE / 2}
            stroke="#E0E0E080"
            strokeWidth="2"
            strokeLinecap="round"
          />
        );
      }
    }
    return (
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      >
        {lines}
      </svg>
    );
  };

  return (
    <div
      style={{
        width: 260,
        minWidth: 260,
        background: '#FFFFFF',
        borderRight: '1px solid #E8E8E8',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          padding: '20px 16px 12px',
          borderBottom: '1px solid #F0F0F0',
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 600,
            color: '#212121',
            marginBottom: 16,
            letterSpacing: 0.3,
          }}
        >
          颜色面板
        </h2>

        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              setInputError('');
            }}
            onKeyDown={handleKeyDown}
            placeholder="#FFFFFF / rgb() / hsl()"
            style={{
              flex: 1,
              padding: '8px 12px',
              border: '1px solid #E0E0E0',
              borderRadius: 8,
              fontSize: 13,
              outline: 'none',
              transition: 'all 0.3s ease',
              fontFamily: 'monospace',
              color: '#424242',
            }}
            onFocus={(e) => {
              e.target.style.borderColor = '#64B5F6';
              e.target.style.boxShadow = '0 0 0 3px rgba(100, 181, 246, 0.15)';
            }}
            onBlur={(e) => {
              e.target.style.borderColor = '#E0E0E0';
              e.target.style.boxShadow = 'none';
            }}
          />
          <button
            onClick={handleAddColor}
            style={{
              padding: '8px 16px',
              background: '#1976D2',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.3s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#1565C0')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#1976D2')}
            onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.96)')}
            onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            添加
          </button>
        </div>

        <div>
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: '#F5F5F5',
              color: '#616161',
              border: '1px dashed #BDBDBD',
              borderRadius: 8,
              fontSize: 12,
              cursor: 'pointer',
              transition: 'all 0.3s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#ECEFF1';
              e.currentTarget.style.borderColor = '#90A4AE';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#F5F5F5';
              e.currentTarget.style.borderColor = '#BDBDBD';
            }}
          >
            📷 从图片提取主色调
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            style={{ display: 'none' }}
          />
        </div>

        {inputError && (
          <div
            style={{
              marginTop: 8,
              padding: '6px 10px',
              background: '#FFEBEE',
              color: '#E53935',
              fontSize: 11,
              borderRadius: 6,
              animation: 'fadeIn 0.3s ease',
            }}
          >
            {inputError}
          </div>
        )}

        <div
          style={{
            marginTop: 12,
            fontSize: 11,
            color: '#9E9E9E',
          }}
        >
          {state.colors.length} / 5 种颜色
        </div>
      </div>

      <div
        ref={panelRef}
        onClick={() => selectColor(null)}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          background:
            'linear-gradient(180deg, #FAFAFA 0%, #F5F5F5 100%)',
          backgroundSize: '20px 20px',
          backgroundImage:
            'radial-gradient(circle, #E8E8E8 1px, transparent 1px)',
        }}
      >
        {renderConnections()}

        {state.colors.map((color) => {
          const isSelected = state.selectedColorId === color.id;
          const suggested = getSuggestedPair(color.hex);
          const borderColor = isLightColor(color.hex) ? '#E0E0E0' : 'transparent';
          return (
            <div
              key={color.id}
              onMouseDown={(e) => handleMouseDown(e, color)}
              onClick={(e) => handleNodeClick(e, color)}
              onDoubleClick={() => {
                if (state.colors.length > 1) {
                  removeColor(color.id);
                  addHistory(0);
                }
              }}
              style={{
                position: 'absolute',
                left: color.position.x,
                top: color.position.y,
                width: NODE_SIZE,
                height: NODE_SIZE,
                borderRadius: '50%',
                background: color.hex,
                cursor: isDragging === color.id ? 'grabbing' : 'grab',
                boxShadow: isSelected
                  ? '0 4px 20px rgba(100, 181, 246, 0.4)'
                  : '0 2px 10px rgba(0,0,0,0.12)',
                border: `2px solid ${borderColor}`,
                transition: isDragging === color.id ? 'none' : 'box-shadow 0.3s ease',
                zIndex: isSelected || isDragging === color.id ? 10 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                userSelect: 'none',
              }}
              title={`${color.hex} - 双击删除`}
            >
              {isSelected && (
                <div
                  style={{
                    position: 'absolute',
                    top: -6,
                    left: -6,
                    right: -6,
                    bottom: -6,
                    borderRadius: '50%',
                    border: '3px solid #64B5F6',
                    animation: 'pulse 1.2s ease-in-out infinite',
                  }}
                />
              )}
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: suggested,
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                  fontFamily: 'monospace',
                  opacity: 0.9,
                }}
              >
                {color.hex.slice(1, 4)}
              </span>
            </div>
          );
        })}

        {state.colors.length === 0 && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              textAlign: 'center',
              color: '#BDBDBD',
              fontSize: 12,
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 8 }}>🎨</div>
            添加颜色开始评估
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.15); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default ColorPanel;
