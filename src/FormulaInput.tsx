import React, { useState, useMemo } from 'react';

interface Preset {
  label: string;
  value: string;
  icon: string;
}

const PRESETS: Preset[] = [
  {
    label: '牛顿-莱布尼茨',
    icon: '∫',
    value: '积分 f(x) dx 从 a 到 b = F(b) - F(a)',
  },
  {
    label: '欧拉公式',
    icon: 'π',
    value: 'e^(i * pi) + 1 = 0',
  },
  {
    label: '方差公式',
    icon: 'σ',
    value: 'sigma^2 = 分数 1 n 累加 i 从 1 到 n (x_i - mu)^2',
  },
  {
    label: '勾股定理',
    icon: '⊿',
    value: 'a^2 + b^2 = c^2',
  },
  {
    label: '二次方程求根',
    icon: '√',
    value: 'x = 分数 -b +- 根号 (b^2 - 4ac) 2a',
  },
  {
    label: '三角函数积分',
    icon: '∫',
    value: '积分 sin(x) dx 从 0 到 pi',
  },
];

const HIGHLIGHT_COLORS = {
  operator: '#e74c3c',
  function: '#3498db',
  variable: '#2c3e50',
  number: '#27ae60',
  keyword: '#9b59b6',
  subSuper: '#f39c12',
};

interface FormulaInputProps {
  value: string;
  onChange: (value: string) => void;
  isValid: boolean;
  isLoading: boolean;
  parseTimeMs: number;
}

const FormulaInput: React.FC<FormulaInputProps> = ({
  value,
  onChange,
  isValid,
  isLoading,
  parseTimeMs,
}) => {
  const [isFocused, setIsFocused] = useState(false);

  const validationText = useMemo(() => {
    if (isLoading) return '解析中...';
    if (!value.trim()) return '输入公式开始转换';
    if (isValid) {
      return parseTimeMs > 0
        ? `解析完成 · ${parseTimeMs}ms`
        : '等待解析...';
    }
    return '解析异常，请检查输入';
  }, [isLoading, value, isValid, parseTimeMs]);

  const validationClass = useMemo(() => {
    if (isLoading) return 'info';
    if (!value.trim()) return 'info';
    return isValid ? 'valid' : 'invalid';
  }, [isLoading, value, isValid]);

  return (
    <div className="card" style={{ animationDelay: '0.1s' }}>
      <div className="card-header">
        <h2 className="card-title">
          <span className="icon">ƒ</span>
          公式输入
        </h2>
        <span className="card-badge">自然语言 · 符号</span>
      </div>

      <div className="highlight-info">
        <span className="legend-item">
          <span
            className="legend-dot"
            style={{ background: HIGHLIGHT_COLORS.operator }}
          />
          运算符
        </span>
        <span className="legend-item">
          <span
            className="legend-dot"
            style={{ background: HIGHLIGHT_COLORS.function }}
          />
          函数
        </span>
        <span className="legend-item">
          <span
            className="legend-dot"
            style={{ background: HIGHLIGHT_COLORS.number }}
          />
          数字
        </span>
        <span className="legend-item">
          <span
            className="legend-dot"
            style={{ background: HIGHLIGHT_COLORS.keyword }}
          />
          关键字
        </span>
        <span className="legend-item">
          <span
            className="legend-dot"
            style={{ background: HIGHLIGHT_COLORS.subSuper }}
          />
          上/下标
        </span>
      </div>

      <div className="input-wrapper">
        <div
          className="input-glow"
          style={{ animationPlayState: isFocused ? 'running' : 'paused' }}
        />
        <textarea
          className="formula-textarea"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="例如：a^2 + b^2 = c^2 或 积分 sin(x) dx 从 0 到 pi"
          spellCheck={false}
        />
      </div>

      <div className={`validation-info ${validationClass}`}>
        <span>
          {isLoading ? (
            <span
              className="loading-spinner"
              style={{
                borderColor: 'rgba(52, 152, 219, 0.2)',
                borderTopColor: 'var(--accent)',
              }}
            />
          ) : !value.trim() ? (
            '✏️'
          ) : isValid ? (
            '✓'
          ) : (
            '✗'
          )}
        </span>
        <span>{validationText}</span>
      </div>

      <div>
        <div
          style={{
            fontSize: '12px',
            fontWeight: '700',
            color: 'var(--text-secondary)',
            marginBottom: '10px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          快速示例
        </div>
        <div className="presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="preset-btn"
              onClick={() => onChange(preset.value)}
              title={preset.value}
            >
              <span
                style={{
                  fontSize: '14px',
                  opacity: 0.8,
                  fontFamily: 'serif',
                }}
              >
                {preset.icon}
              </span>
              <span>{preset.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FormulaInput;
export { PRESETS, HIGHLIGHT_COLORS };
