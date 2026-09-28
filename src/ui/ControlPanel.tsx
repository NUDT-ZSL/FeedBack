import React, { useRef, useState, useCallback, useEffect } from 'react';
import type { ColorStop, GradientConfig, GradientType } from '../core/GradientEngine';
import { GradientEngine } from '../core/GradientEngine';
import { CARD_TEMPLATES, type CardLayout, type TextStyle } from '../core/CardTemplate';
import './styles/ControlPanel.css';

interface ControlPanelProps {
  stops: ColorStop[];
  gradient: GradientConfig;
  layout: CardLayout;
  selectedStopId: string | null;
  onGradientChange: (g: Partial<GradientConfig>) => void;
  onAddStop: (color?: string, position?: number) => void;
  onRemoveStop: (id: string) => void;
  onUpdateStop: (id: string, patch: Partial<ColorStop>) => void;
  onSelectStop: (id: string | null) => void;
  onTemplateChange: (templateId: string) => void;
  onTitleChange: (patch: Partial<TextStyle>) => void;
  onSubtitleChange: (patch: Partial<TextStyle>) => void;
  onChangeGradientType: (type: GradientType) => void;
}

const LinearIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="3" y1="18" x2="21" y2="6" strokeDasharray="2 2" />
  </svg>
);
const RadialIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="12" cy="12" r="7" strokeDasharray="2 2" />
    <circle cx="12" cy="12" r="2" />
  </svg>
);
const ConicIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M12 12 L12 5 A7 7 0 1 1 5 12 Z" fill="currentColor" fillOpacity="0.2"/>
  </svg>
);
const PaletteIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="13.5" cy="6.5" r="0.8" fill="currentColor"/>
    <circle cx="17.5" cy="10.5" r="0.8" fill="currentColor"/>
    <circle cx="8.5" cy="7.5" r="0.8" fill="currentColor"/>
    <circle cx="6.5" cy="12.5" r="0.8" fill="currentColor"/>
    <path d="M12 22 C6.5 22 2 17.5 2 12 S6.5 2 12 2 C17.5 2 22 6.5 22 12 C22 14.2 20.2 16 18 16 H15 C14.45 16 14 16.45 14 17 C14 17.55 14.45 18 15 18 C16.1 18 17 18.9 17 20 C17 20.55 16.55 21 16 21 C15 21.5 13.5 22 12 22Z"/>
  </svg>
);
const LayersIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 2 7 12 12 22 7 12 2"/>
    <polyline points="2 17 12 22 22 17"/>
    <polyline points="2 12 12 17 22 12"/>
  </svg>
);
const TypeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 7 4 4 20 4 20 7"/>
    <line x1="9" y1="20" x2="15" y2="20"/>
    <line x1="12" y1="4" x2="12" y2="20"/>
  </svg>
);
const SlidersIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="21" x2="4" y2="14"/>
    <line x1="4" y1="10" x2="4" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="12"/>
    <line x1="12" y1="8" x2="12" y2="3"/>
    <line x1="20" y1="21" x2="20" y2="16"/>
    <line x1="20" y1="12" x2="20" y2="3"/>
    <line x1="1" y1="14" x2="7" y2="14"/>
    <line x1="9" y1="8" x2="15" y2="8"/>
    <line x1="17" y1="16" x2="23" y2="16"/>
  </svg>
);

const AngleKnob: React.FC<{
  value: number;
  onChange: (v: number) => void;
}> = ({ value, onChange }) => {
  const knobRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      setIsDragging(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    []
  );

  const calcAngle = useCallback(
    (clientX: number, clientY: number) => {
      if (!knobRef.current) return value;
      const rect = knobRef.current.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let angle = Math.atan2(clientY - cy, clientX - cx) * (180 / Math.PI) + 90;
      if (angle < 0) angle += 360;
      return Math.round(angle);
    },
    [value]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      onChange(calcAngle(e.clientX, e.clientY));
    },
    [isDragging, onChange, calcAngle]
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    setIsDragging(false);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (_err) { /* ignore */ }
  }, []);

  return (
    <div className="knob-container">
      <div
        ref={knobRef}
        className={`knob ${isDragging ? 'dragging' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div
          className="knob-indicator"
          style={{ transform: `translateX(-50%) rotate(${value}deg)`, transformOrigin: '50% 46px' }}
        />
        <div className="knob-inner">
          <div className="knob-value">{value}°</div>
        </div>
      </div>
    </div>
  );
};

const StyledSlider: React.FC<{
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}> = ({ value, min = 0, max = 100, step = 1, onChange }) => {
  const percent = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider-wrap" style={{ ['--val' as never]: `${percent}%` }}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
      />
    </div>
  );
};

const ControlPanel: React.FC<ControlPanelProps> = ({
  stops,
  gradient,
  layout,
  selectedStopId,
  onGradientChange,
  onAddStop,
  onRemoveStop,
  onUpdateStop,
  onSelectStop,
  onTemplateChange,
  onTitleChange,
  onSubtitleChange,
  onChangeGradientType,
}) => {
  const selectedStop = stops.find(s => s.id === selectedStopId) || null;
  const sortedStops = [...stops].sort((a, b) => a.position - b.position);

  useEffect(() => {
    if (!selectedStopId && stops.length > 0) {
      onSelectStop(stops[0].id);
    }
  }, [stops, selectedStopId, onSelectStop]);

  const handleStopColor = (id: string, rawColor: string) => {
    let color = rawColor;
    if (!color.startsWith('#')) {
      color = '#' + color;
    }
    if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
      onUpdateStop(id, { color });
    }
  };

  return (
    <aside className="right-panel" onClick={e => e.stopPropagation()}>
      <div className="panel-section">
        <div className="section-title">
          <SlidersIcon /> 渐变类型
        </div>
        <div className="type-switcher">
          <button
            className={gradient.type === 'linear' ? 'active' : ''}
            onClick={() => onChangeGradientType('linear')}
          >
            <LinearIcon />
            线性
          </button>
          <button
            className={gradient.type === 'radial' ? 'active' : ''}
            onClick={() => onChangeGradientType('radial')}
          >
            <RadialIcon />
            径向
          </button>
          <button
            className={gradient.type === 'conic' ? 'active' : ''}
            onClick={() => onChangeGradientType('conic')}
          >
            <ConicIcon />
            角向
          </button>
        </div>

        {gradient.type === 'linear' && (
          <>
            <div className="control-row">
              <span className="control-label">角度</span>
              <span className="control-value">{gradient.angle}°</span>
            </div>
            <AngleKnob value={gradient.angle} onChange={v => onGradientChange({ angle: v })} />
            <StyledSlider
              value={gradient.angle}
              min={0}
              max={360}
              step={1}
              onChange={v => onGradientChange({ angle: v })}
            />
          </>
        )}

        {(gradient.type === 'radial' || gradient.type === 'conic') && (
          <>
            {gradient.type === 'conic' && (
              <>
                <div className="control-row">
                  <span className="control-label">起始角</span>
                  <span className="control-value">{gradient.angle}°</span>
                </div>
                <AngleKnob value={gradient.angle} onChange={v => onGradientChange({ angle: v })} />
              </>
            )}
            <div className="control-row" style={{ marginTop: 16 }}>
              <span className="control-label">圆心 X</span>
              <span className="control-value">{gradient.centerX}%</span>
            </div>
            <StyledSlider
              value={gradient.centerX}
              onChange={v => onGradientChange({ centerX: v })}
            />
            <div className="control-row">
              <span className="control-label">圆心 Y</span>
              <span className="control-value">{gradient.centerY}%</span>
            </div>
            <StyledSlider
              value={gradient.centerY}
              onChange={v => onGradientChange({ centerY: v })}
            />
          </>
        )}
      </div>

      <div className="panel-section">
        <div className="section-title">
          <PaletteIcon /> 色彩锚点 ({stops.length})
        </div>
        <div className="stops-list">
          {sortedStops.map(stop => (
            <div
              key={stop.id}
              className={`stop-item ${stop.id === selectedStopId ? 'selected' : ''}`}
              onClick={() => onSelectStop(stop.id)}
            >
              <div className="color-swatch" style={{ background: stop.color }}>
                <input
                  type="color"
                  value={stop.color}
                  onChange={e => onUpdateStop(stop.id, { color: e.target.value })}
                  onClick={e => e.stopPropagation()}
                />
              </div>
              <div className="stop-info">
                <div className="stop-hex">
                  <input
                    type="text"
                    value={stop.color.replace('#', '')}
                    maxLength={6}
                    onClick={e => e.stopPropagation()}
                    onChange={e => handleStopColor(stop.id, e.target.value)}
                  />
                </div>
                <div className="stop-position">位置 {stop.position.toFixed(1)}%</div>
              </div>
              <div className="stop-actions">
                <div className="stop-mini-slider">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={0.5}
                    value={stop.position}
                    onClick={e => e.stopPropagation()}
                    onChange={e =>
                      onUpdateStop(stop.id, { position: Number(e.target.value) })
                    }
                  />
                </div>
                <button
                  className="icon-btn-small"
                  onClick={e => {
                    e.stopPropagation();
                    onRemoveStop(stop.id);
                  }}
                  disabled={stops.length <= 2}
                  title="删除锚点"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
        <button
          className="add-stop-btn"
          onClick={() => onAddStop()}
          disabled={stops.length >= 20}
        >
          + 添加色彩锚点
        </button>
        <p className="hint-text" style={{ marginTop: 8 }}>
          最少 2 个锚点，最多 20 个。点击颜色块可打开色轮，或直接输入 HEX 值。
        </p>
      </div>

      <div className="panel-section">
        <div className="section-title">
          <LayersIcon /> 卡片模板
        </div>
        <div className="templates-grid">
          {CARD_TEMPLATES.map(tpl => (
            <div
              key={tpl.id}
              className={`template-card ${layout.templateId === tpl.id ? 'active' : ''}`}
              onClick={() => onTemplateChange(tpl.id)}
            >
              <div
                className="template-preview"
                style={{ aspectRatio: tpl.previewRatio, maxWidth: `${100 * (tpl.width / tpl.height)}%` }}
              >
                {tpl.width}×{tpl.height}
              </div>
              <div className="template-name">{tpl.name}</div>
              <div className="template-size">{tpl.width}×{tpl.height}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel-section">
        <div className="section-title">
          <TypeIcon /> 文字编辑
        </div>
        <TextEditorBlock
          label="标题"
          style={layout.title}
          onChange={onTitleChange}
        />
        <TextEditorBlock
          label="副标题"
          style={layout.subtitle}
          onChange={onSubtitleChange}
        />
      </div>
    </aside>
  );
};

const TextEditorBlock: React.FC<{
  label: string;
  style: TextStyle;
  onChange: (patch: Partial<TextStyle>) => void;
}> = ({ label, style, onChange }) => {
  const Icon = label === '标题' ? TypeIcon : TypeIcon;
  return (
    <div className="text-input-group">
      <div className="text-input-label">
        <Icon /> {label}
      </div>
      <div className="text-input-wrap">
        <input
          type="text"
          value={style.content}
          placeholder={`输入${label}内容`}
          onChange={e => onChange({ content: e.target.value })}
        />
        <div className="mini-color-swatch" style={{ background: style.color }}>
          <input
            type="color"
            value={/#[0-9A-Fa-f]{6}/.test(style.color) ? style.color : '#ffffff'}
            onChange={e => onChange({ color: e.target.value })}
          />
        </div>
      </div>
      <div className="control-row" style={{ marginBottom: 0 }}>
        <span className="control-label" style={{ fontSize: 10 }}>字号</span>
        <input
          type="number"
          className="number-input"
          value={style.fontSize}
          min={8}
          max={200}
          onChange={e => onChange({ fontSize: Math.max(8, Math.min(200, Number(e.target.value) || 14)) })}
        />
      </div>
    </div>
  );
};

export default React.memo(ControlPanel);
