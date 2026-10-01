import React from 'react';

interface ControlPanelProps {
  ballCount: number;
  setBallCount: (n: number) => void;
  masses: number[];
  setMass: (index: number, value: number) => void;
  damping: number;
  setDamping: (n: number) => void;
  paused: boolean;
  onTogglePause: () => void;
  onReset: () => void;
  exporting: boolean;
  exportProgress: number;
  onExport: () => void;
}

const ControlPanel: React.FC<ControlPanelProps> = ({
  ballCount,
  setBallCount,
  masses,
  setMass,
  damping,
  setDamping,
  paused,
  onTogglePause,
  onReset,
  exporting,
  exportProgress,
  onExport,
}) => {
  const sliderStyle: React.CSSProperties = {
    width: '100%',
    height: '4px',
    background: '#e0e0e0',
    borderRadius: '2px',
    outline: 'none',
    WebkitAppearance: 'none',
    cursor: 'pointer',
  };

  const buttonStyle: React.CSSProperties = {
    flex: 1,
    padding: '10px 16px',
    backgroundColor: '#26a69a',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 600,
    transition: 'all 0.1s ease',
    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.1)',
  };

  return (
    <div
      style={{
        width: '280px',
        backgroundColor: '#ffffff',
        border: '2px solid #e0e0e0',
        borderRadius: '8px',
        padding: '0px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        height: 'fit-content',
        maxHeight: 'calc(100vh - 40px)',
      }}
    >
      <div
        style={{
          height: '3px',
          background: 'linear-gradient(90deg, #4fc3f7 0%, #ff7043 100%)',
        }}
      />

      <div style={{ padding: '16px', overflowY: 'auto', flex: 1 }}>
        <div style={{ marginBottom: '20px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '8px',
              fontSize: '13px',
              color: '#37474f',
              fontWeight: 500,
            }}
          >
            <span>摆锤数量</span>
            <span style={{ fontFamily: 'monospace', color: '#26a69a' }}>{ballCount}</span>
          </div>
          <input
            type="range"
            min={3}
            max={10}
            step={1}
            value={ballCount}
            onChange={(e) => setBallCount(Number(e.target.value))}
            style={sliderStyle}
          />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '8px',
              fontSize: '13px',
              color: '#37474f',
              fontWeight: 500,
            }}
          >
            <span>阻力系数</span>
            <span style={{ fontFamily: 'monospace', color: '#26a69a' }}>{damping.toFixed(3)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={0.05}
            step={0.001}
            value={damping}
            onChange={(e) => setDamping(Number(e.target.value))}
            style={sliderStyle}
          />
          <div style={{ textAlign: 'center', fontSize: '11px', color: '#90a4ae', marginTop: '4px' }}>
            {damping.toFixed(3)}
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <div
            style={{
              fontSize: '13px',
              color: '#37474f',
              fontWeight: 500,
              marginBottom: '12px',
            }}
          >
            各摆锤质量 (kg)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {masses.map((mass, index) => (
              <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    fontSize: '11px',
                    color: '#78909c',
                    width: '24px',
                    flexShrink: 0,
                  }}
                >
                  #{index + 1}
                </span>
                <input
                  type="range"
                  min={0.5}
                  max={5}
                  step={0.1}
                  value={mass}
                  onChange={(e) => setMass(index, Number(e.target.value))}
                  style={{ ...sliderStyle, flex: 1 }}
                />
                <span
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    color: '#26a69a',
                    width: '32px',
                    textAlign: 'right',
                  }}
                >
                  {mass.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        style={{
          padding: '12px 16px 16px',
          borderTop: '1px solid #e0e0e0',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={onTogglePause}
            style={buttonStyle}
            onMouseEnter={(e) => {
              (e.target as HTMLButtonElement).style.backgroundColor = '#00897b';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.backgroundColor = '#26a69a';
            }}
            onMouseDown={(e) => {
              (e.target as HTMLButtonElement).style.transform = 'scale(0.95)';
            }}
            onMouseUp={(e) => {
              (e.target as HTMLButtonElement).style.transform = 'scale(1)';
            }}
          >
            {paused ? '▶ 继续' : '⏸ 暂停'}
          </button>
          <button
            onClick={onReset}
            style={buttonStyle}
            onMouseEnter={(e) => {
              (e.target as HTMLButtonElement).style.backgroundColor = '#00897b';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.backgroundColor = '#26a69a';
            }}
            onMouseDown={(e) => {
              (e.target as HTMLButtonElement).style.transform = 'scale(0.95)';
            }}
            onMouseUp={(e) => {
              (e.target as HTMLButtonElement).style.transform = 'scale(1)';
            }}
          >
            ↺ 重置
          </button>
        </div>

        <div style={{ position: 'relative' }}>
          <button
            onClick={onExport}
            disabled={exporting}
            style={{
              ...buttonStyle,
              width: '100%',
              opacity: exporting ? 0.7 : 1,
              cursor: exporting ? 'not-allowed' : 'pointer',
            }}
            onMouseEnter={(e) => {
              if (!exporting) (e.target as HTMLButtonElement).style.backgroundColor = '#00897b';
            }}
            onMouseLeave={(e) => {
              if (!exporting) (e.target as HTMLButtonElement).style.backgroundColor = '#26a69a';
            }}
            onMouseDown={(e) => {
              if (!exporting) (e.target as HTMLButtonElement).style.transform = 'scale(0.95)';
            }}
            onMouseUp={(e) => {
              if (!exporting) (e.target as HTMLButtonElement).style.transform = 'scale(1)';
            }}
          >
            {exporting ? `导出中 ${exportProgress.toFixed(0)}%` : '⬇ 导出 GIF'}
          </button>
          {exporting && (
            <svg
              style={{
                position: 'absolute',
                right: '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                width: '24px',
                height: '24px',
              }}
              viewBox="0 0 36 36"
            >
              <circle
                cx="18"
                cy="18"
                r="15"
                fill="none"
                stroke="#ffffff33"
                strokeWidth="3"
              />
              <circle
                cx="18"
                cy="18"
                r="15"
                fill="none"
                stroke="#ffffff"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${(exportProgress / 100) * 94.2} 94.2`}
                transform="rotate(-90 18 18)"
                style={{ transition: 'stroke-dasharray 0.1s linear' }}
              />
            </svg>
          )}
        </div>
      </div>

      <style>{`
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #26a69a;
          cursor: pointer;
          transition: background 0.15s;
        }
        input[type="range"]::-webkit-slider-thumb:hover {
          background: #00897b;
        }
        input[type="range"]::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #26a69a;
          cursor: pointer;
          border: none;
          transition: background 0.15s;
        }
        input[type="range"]::-moz-range-thumb:hover {
          background: #00897b;
        }
      `}</style>
    </div>
  );
};

export default ControlPanel;
