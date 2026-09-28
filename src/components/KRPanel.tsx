import React, { useState } from 'react';
import { KeyResult } from '@/utils/helpers';

interface KRPanelProps {
  keyResults: KeyResult[];
  onProgressChange?: (krId: string, progress: number) => void;
  editable?: boolean;
}

const ProgressRing: React.FC<{ progress: number; size?: number; strokeWidth?: number }> = ({
  progress,
  size = 100,
  strokeWidth = 8
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;

  const getColor = (p: number) => {
    if (p >= 80) return '#00b4d8';
    if (p >= 50) return '#48cae4';
    return '#e63946';
  };

  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <defs>
        <filter id={`ring-glow-${progress}`}>
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgba(255, 255, 255, 0.1)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={getColor(progress)}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{
          transition: 'stroke-dashoffset 0.5s ease, stroke 0.3s ease',
          filter: `url(#ring-glow-${progress})`
        }}
      />
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#fff"
        fontSize="20"
        fontWeight="700"
        fontFamily="'Inter', sans-serif"
        style={{ transform: 'rotate(90deg)', transformOrigin: `${size/2}px ${size/2}px` }}
      >
        {progress}%
      </text>
    </svg>
  );
};

export const KRPanel: React.FC<KRPanelProps> = ({ keyResults, onProgressChange, editable = false }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState(0);

  const handleEditStart = (kr: KeyResult) => {
    if (!editable) return;
    setEditingId(kr.id);
    setEditValue(kr.progress);
  };

  const handleEditSave = () => {
    if (editingId && onProgressChange) {
      onProgressChange(editingId, Math.max(0, Math.min(100, editValue)));
    }
    setEditingId(null);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        padding: '20px',
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        borderRadius: '16px',
        border: '1px solid rgba(255, 255, 255, 0.08)'
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: '18px',
          fontWeight: 600,
          color: '#fff',
          fontFamily: "'Inter', sans-serif"
        }}
      >
        关键结果 (KR)
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {keyResults.map((kr, index) => (
          <div
            key={kr.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              padding: '16px',
              backgroundColor: 'rgba(255, 255, 255, 0.04)',
              borderRadius: '12px',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255, 255, 255, 0.06)';
              (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0, 180, 216, 0.3)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255, 255, 255, 0.04)';
              (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255, 255, 255, 0.06)';
            }}
          >
            <div style={{ flexShrink: 0 }}>
              <ProgressRing progress={kr.progress} size={80} strokeWidth={7} />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    backgroundColor: 'rgba(0, 180, 216, 0.2)',
                    color: '#00b4d8',
                    fontSize: '11px',
                    fontWeight: 600,
                    borderRadius: '4px',
                    fontFamily: "'Inter', sans-serif"
                  }}
                >
                  权重 {kr.weight}%
                </span>
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: '14px',
                  color: 'rgba(255, 255, 255, 0.9)',
                  lineHeight: 1.5,
                  fontFamily: "'Inter', sans-serif"
                }}
              >
                {kr.title}
              </p>

              {editingId === kr.id ? (
                <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={editValue}
                    onChange={(e) => setEditValue(Number(e.target.value))}
                    style={{ flex: 1, cursor: 'pointer' }}
                  />
                  <span style={{ color: '#00b4d8', fontSize: '13px', fontWeight: 600, minWidth: '40px' }}>
                    {editValue}%
                  </span>
                  <button
                    onClick={handleEditSave}
                    style={{
                      padding: '4px 12px',
                      backgroundColor: '#00b4d8',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      transition: 'transform 0.15s ease',
                      fontFamily: "'Inter', sans-serif"
                    }}
                    onMouseDown={(e) => {
                      (e.currentTarget as HTMLElement).style.transform = 'scale(0.95)';
                    }}
                    onMouseUp={(e) => {
                      (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                    }}
                  >
                    确定
                  </button>
                </div>
              ) : editable && (
                <button
                  onClick={() => handleEditStart(kr)}
                  style={{
                    marginTop: '8px',
                    padding: '0',
                    background: 'none',
                    border: 'none',
                    color: '#00b4d8',
                    fontSize: '12px',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    fontFamily: "'Inter', sans-serif"
                  }}
                >
                  编辑进度
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
