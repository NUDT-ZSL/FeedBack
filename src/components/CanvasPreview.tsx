import React, { useState, useMemo, useCallback } from 'react';
import { useAppContext, ColorBlindMode } from '../context/AppContext';
import {
  getContrastResult,
  generateColorSuggestions,
  calculateContrastRatio,
  isLightColor,
  ContrastResult,
} from '../utils/contrastCalculator';

interface UIComponentConfig {
  id: string;
  name: string;
  type: 'button' | 'heading' | 'body' | 'input' | 'link';
  isLargeText: boolean;
}

const UI_COMPONENTS: UIComponentConfig[] = [
  { id: 'btn', name: '按钮', type: 'button', isLargeText: true },
  { id: 'heading', name: '标题', type: 'heading', isLargeText: true },
  { id: 'body', name: '正文', type: 'body', isLargeText: false },
  { id: 'input', name: '输入框', type: 'input', isLargeText: false },
  { id: 'link', name: '链接', type: 'link', isLargeText: false },
];

const colorBlindFilters: Record<ColorBlindMode, string> = {
  none: 'none',
  achromatopsia: 'grayscale(100%)',
  protanopia: 'hue-rotate(-20deg) saturate(80%)',
  deuteranopia: 'hue-rotate(10deg) saturate(70%)',
  tritanopia: 'hue-rotate(180deg) saturate(85%)',
};

const colorBlindLabels: Record<ColorBlindMode, string> = {
  none: '正常视觉',
  achromatopsia: '全色盲',
  protanopia: '红色盲',
  deuteranopia: '绿色盲',
  tritanopia: '蓝色盲',
};

interface BubbleProps {
  result: ContrastResult;
  visible: boolean;
}

const Bubble: React.FC<BubbleProps> = ({ result, visible }) => {
  const bgColor = result.isPass ? '#81C784' : '#E57373';
  const label = result.isPass ? (result.level === 'AAA' ? '优秀' : '合格') : '不合格';
  return (
    <div
      style={{
        position: 'absolute',
        top: -36,
        left: '50%',
        transform: visible ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(8px)',
        opacity: visible ? 1 : 0,
        transition: 'all 0.5s ease',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        zIndex: 100,
      }}
    >
      <div
        style={{
          background: bgColor,
          color: '#FFFFFF',
          padding: '5px 10px',
          borderRadius: 8,
          fontSize: 11,
          fontWeight: 600,
          boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span style={{ fontSize: 10 }}>{result.ratio.toFixed(2)}:1</span>
        <span style={{ opacity: 0.85 }}>|</span>
        <span>WCAG {result.level}</span>
        <span style={{ opacity: 0.85 }}>|</span>
        <span>{label}</span>
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: -5,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '5px solid transparent',
          borderRight: '5px solid transparent',
          borderTop: `5px solid ${bgColor}`,
        }}
      />
    </div>
  );
};

interface SuggestionPanelProps {
  foreground: string;
  background: string;
  onClose: () => void;
  onApply: (newFg: string) => void;
}

const SuggestionPanel: React.FC<SuggestionPanelProps> = ({ foreground, background, onClose, onApply }) => {
  const suggestions = useMemo(
    () => generateColorSuggestions(foreground, background),
    [foreground, background]
  );

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: '100%',
        left: '50%',
        transform: 'translateX(-50%)',
        marginTop: 12,
        background: 'rgba(255, 255, 255, 0.75)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.5)',
        borderRadius: 12,
        padding: 16,
        boxShadow: '0 12px 40px rgba(0,0,0,0.12)',
        zIndex: 200,
        minWidth: 300,
        animation: 'fadeIn 0.3s ease',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#424242' }}>优化配色建议</span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 18,
            color: '#9E9E9E',
            lineHeight: 1,
            padding: '0 4px',
            transition: 'color 0.3s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#424242')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#9E9E9E')}
        >
          ×
        </button>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        {suggestions.map((suggestedFg, idx) => {
          const ratio = calculateContrastRatio(suggestedFg, background);
          const isPass = ratio >= 4.5;
          return (
            <div
              key={idx}
              onClick={() => onApply(suggestedFg)}
              style={{
                flex: 1,
                cursor: 'pointer',
                borderRadius: 10,
                overflow: 'hidden',
                border: '2px solid transparent',
                transition: 'all 0.3s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#64B5F6';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'transparent';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <div
                style={{
                  background,
                  padding: '20px 8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: suggestedFg,
                  }}
                >
                  Aa
                </span>
              </div>
              <div
                style={{
                  background: '#FFFFFF',
                  padding: '8px 6px',
                  textAlign: 'center',
                  borderTop: '1px solid #F0F0F0',
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontFamily: 'monospace',
                    color: '#616161',
                    marginBottom: 2,
                  }}
                >
                  {suggestedFg.toUpperCase()}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: isPass ? '#4CAF50' : '#F44336',
                  }}
                >
                  {ratio.toFixed(2)}:1 {isPass ? '✓' : '✗'}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

interface ComponentPreviewProps {
  config: UIComponentConfig;
  foreground: string;
  background: string;
  onClickFail: () => void;
  showSuggestions: boolean;
  onCloseSuggestions: () => void;
  onApplySuggestion: (newFg: string) => void;
  filter: string;
  bubbleVisible: boolean;
}

const ComponentPreview: React.FC<ComponentPreviewProps> = ({
  config,
  foreground,
  background,
  onClickFail,
  showSuggestions,
  onCloseSuggestions,
  onApplySuggestion,
  filter,
  bubbleVisible,
}) => {
  const result = getContrastResult(foreground, background, config.isLargeText);
  const [hovered, setHovered] = useState(false);

  const commonWrapperStyle: React.CSSProperties = {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 32px',
    borderRadius: 14,
    background: '#FFFFFF',
    border: `1px solid ${hovered ? '#E0E0E0' : '#F0F0F0'}`,
    boxShadow: hovered ? '0 6px 24px rgba(0,0,0,0.08)' : '0 2px 10px rgba(0,0,0,0.04)',
    cursor: !result.isPass ? 'pointer' : 'default',
    transition: 'all 0.3s ease',
    filter,
  };

  const handleClick = () => {
    if (!result.isPass) {
      onClickFail();
    }
  };

  let componentElement: React.ReactNode;

  switch (config.type) {
    case 'button':
      componentElement = (
        <button
          style={{
            padding: '12px 28px',
            background: foreground,
            color: background,
            border: 'none',
            borderRadius: 8,
            fontSize: 15,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            boxShadow: `0 2px 8px ${foreground}40`,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = `0 4px 14px ${foreground}55`;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = `0 2px 8px ${foreground}40`;
          }}
          onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
          onMouseUp={(e) => (e.currentTarget.style.transform = 'translateY(-1px)')}
        >
          主要按钮
        </button>
      );
      break;
    case 'heading':
      componentElement = (
        <h1
          style={{
            margin: 0,
            fontSize: 26,
            fontWeight: 700,
            color: foreground,
            letterSpacing: -0.3,
          }}
        >
          页面标题 Heading
        </h1>
      );
      break;
    case 'body':
      componentElement = (
        <p
          style={{
            margin: 0,
            fontSize: 14,
            lineHeight: 1.65,
            color: foreground,
            maxWidth: 280,
            textAlign: 'left',
          }}
        >
          这是一段正文示例文字。色彩对比度对于确保所有用户，包括视力障碍用户，能够清晰阅读内容至关重要。
        </p>
      );
      break;
    case 'input':
      componentElement = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span
            style={{
              fontSize: 11,
              color: '#9E9E9E',
              fontWeight: 500,
              letterSpacing: 0.3,
              textTransform: 'uppercase',
              alignSelf: 'flex-start',
            }}
          >
            Email
          </span>
          <input
            type="text"
            defaultValue="user@example.com"
            disabled
            style={{
              width: 220,
              padding: '11px 14px',
              border: `1.5px solid ${foreground}`,
              borderRadius: 8,
              fontSize: 14,
              color: foreground,
              background: '#FAFAFA',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        </div>
      );
      break;
    case 'link':
      componentElement = (
        <a
          href="#"
          onClick={(e) => e.preventDefault()}
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: foreground,
            textDecoration: 'underline',
            textUnderlineOffset: 3,
            cursor: 'pointer',
            transition: 'opacity 0.3s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.75')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
        >
          点击了解更多关于无障碍设计 →
        </a>
      );
      break;
  }

  return (
    <div
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={commonWrapperStyle}
    >
      <Bubble result={result} visible={bubbleVisible} />
      <div
        style={{
          position: 'absolute',
          top: 10,
          left: 14,
          fontSize: 10,
          fontWeight: 600,
          color: '#BDBDBD',
          letterSpacing: 0.5,
          textTransform: 'uppercase',
        }}
      >
        {config.name}
      </div>
      <div style={{ marginTop: 8 }}>{componentElement}</div>
      {showSuggestions && (
        <SuggestionPanel
          foreground={foreground}
          background={background}
          onClose={onCloseSuggestions}
          onApply={onApplySuggestion}
        />
      )}
    </div>
  );
};

const CanvasPreview: React.FC = () => {
  const { state, setColorBlindMode, addHistory } = useAppContext();
  const [expandedComponent, setExpandedComponent] = useState<string | null>(null);
  const [bubbleVisible, setBubbleVisible] = useState(true);

  const colors = state.colors;
  const bgColor = colors.length >= 1 ? colors[0].hex : '#FFFFFF';
  const fgColor = colors.length >= 2 ? colors[1].hex : isLightColor(bgColor) ? '#212121' : '#FFFFFF';

  const filter = colorBlindFilters[state.colorBlindMode];

  const handleComponentFailClick = useCallback((compId: string) => {
    setExpandedComponent((prev) => (prev === compId ? null : compId));
  }, []);

  const handleApplySuggestion = useCallback(
    (newFg: string) => {
      if (colors.length >= 2) {
        const colorToReplace = colors[1];
        const originalColors = state.colors;
        const updated = originalColors.map((c) =>
          c.id === colorToReplace.id ? { ...c, hex: newFg } : c
        );
        updated.forEach((c, idx) => {
          if (idx === 1) {
            state.colors[idx] = c;
          }
        });
        addHistory(0);
      }
      setExpandedComponent(null);
      setBubbleVisible(false);
      setTimeout(() => setBubbleVisible(true), 50);
    },
    [colors, state.colors, addHistory]
  );

  const formatTimestamp = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString('zh-CN', { hour12: false });
  };

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        minWidth: 0,
        background: '#FAFAFA',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '20px 28px',
          borderBottom: '1px solid #F0F0F0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 20,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 700,
              color: '#212121',
              letterSpacing: -0.2,
            }}
          >
            色彩无障碍评估工具
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#9E9E9E' }}>
            遵循 WCAG 2.1 AA/AAA 标准 · 实时对比度检测
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: '#616161',
            }}
          >
            色盲模拟:
          </label>
          <div style={{ position: 'relative' }}>
            <select
              value={state.colorBlindMode}
              onChange={(e) => {
                setColorBlindMode(e.target.value as ColorBlindMode);
                addHistory(0);
              }}
              style={{
                padding: '8px 36px 8px 14px',
                border: '1px solid #E0E0E0',
                borderRadius: 8,
                fontSize: 13,
                background: '#FFFFFF',
                color: '#424242',
                cursor: 'pointer',
                outline: 'none',
                appearance: 'none',
                WebkitAppearance: 'none',
                transition: 'all 0.3s ease',
              }}
              onFocus={(e) => {
                e.target.style.borderColor = '#64B5F6';
                e.target.style.boxShadow = '0 0 0 3px rgba(100, 181, 246, 0.15)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#E0E0E0';
                e.target.style.boxShadow = 'none';
              }}
            >
              {(Object.keys(colorBlindLabels) as ColorBlindMode[]).map((mode) => (
                <option key={mode} value={mode}>
                  {colorBlindLabels[mode]}
                </option>
              ))}
            </select>
            <div
              style={{
                position: 'absolute',
                right: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                pointerEvents: 'none',
                color: '#9E9E9E',
                fontSize: 10,
              }}
            >
              ▼
            </div>
          </div>
        </div>
      </div>

      {state.colorBlindMode !== 'none' && (
        <div
          style={{
            padding: '10px 28px',
            background: 'linear-gradient(90deg, #E3F2FD 0%, #FFF3E0 100%)',
            borderBottom: '1px solid #E3F2FD',
          }}
        >
          <div style={{ fontSize: 12, color: '#1565C0', fontWeight: 500 }}>
            当前模拟类型: <strong>{colorBlindLabels[state.colorBlindMode]}</strong> 下的视觉表现
          </div>
          <div
            style={{
              marginTop: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              overflow: 'hidden',
            }}
          >
            <span style={{ fontSize: 10, color: '#78909C', flexShrink: 0 }}>切换记录:</span>
            <div
              style={{
                display: 'flex',
                gap: 12,
                overflowX: 'auto',
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
              }}
            >
              {state.timestampLog.length === 0 ? (
                <span style={{ fontSize: 10, color: '#B0BEC5', fontStyle: 'italic' }}>暂无记录</span>
              ) : (
                state.timestampLog.map((ts, idx) => (
                  <span
                    key={idx}
                    style={{
                      fontSize: 10,
                      color: '#546E7A',
                      background: 'rgba(255,255,255,0.7)',
                      padding: '3px 8px',
                      borderRadius: 4,
                      flexShrink: 0,
                      fontFamily: 'monospace',
                    }}
                  >
                    {formatTimestamp(ts)}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '36px 36px 48px',
          filter,
          transition: 'filter 0.5s ease',
        }}
      >
        <div
          style={{
            maxWidth: 1100,
            margin: '0 auto',
          }}
        >
          <div
            style={{
              marginBottom: 28,
              padding: '16px 20px',
              background: '#FFFFFF',
              borderRadius: 12,
              border: '1px solid #F0F0F0',
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, color: '#9E9E9E' }}>当前配色:</span>
              {colors.length === 0 ? (
                <span style={{ fontSize: 12, color: '#BDBDBD', fontStyle: 'italic' }}>请添加颜色</span>
              ) : (
                colors.map((c, idx) => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        background: c.hex,
                        border: idx < 2 ? '2px solid #64B5F6' : '1px solid #E0E0E0',
                        boxShadow: idx < 2 ? '0 0 0 3px rgba(100, 181, 246, 0.15)' : 'none',
                      }}
                    />
                    <span
                      style={{
                        fontSize: 11,
                        fontFamily: 'monospace',
                        color: idx < 2 ? '#1976D2' : '#757575',
                        fontWeight: idx < 2 ? 600 : 400,
                      }}
                    >
                      {idx === 0 ? '背景' : idx === 1 ? '前景' : `颜色${idx + 1}`} {c.hex}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 24,
            }}
          >
            {UI_COMPONENTS.map((config) => (
              <ComponentPreview
                key={config.id}
                config={config}
                foreground={fgColor}
                background={bgColor}
                onClickFail={() => handleComponentFailClick(config.id)}
                showSuggestions={expandedComponent === config.id}
                onCloseSuggestions={() => setExpandedComponent(null)}
                onApplySuggestion={handleApplySuggestion}
                filter="none"
                bubbleVisible={bubbleVisible}
              />
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateX(-50%) translateY(-4px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default CanvasPreview;
