import React, { useState, useCallback } from 'react';
import { OceanRegion } from '../data/OceanDataService';

interface UserControlsProps {
  region: OceanRegion;
  depthRange: [number, number];
  particleDensity: number;
  isPlaying: boolean;
  onRegionChange: (region: OceanRegion) => void;
  onDepthRangeChange: (range: [number, number]) => void;
  onParticleDensityChange: (density: number) => void;
  onPlayPause: () => void;
}

const REGION_OPTIONS: { value: OceanRegion; label: string }[] = [
  { value: 'northAtlantic', label: '北大西洋' },
  { value: 'equatorialPacific', label: '赤道太平洋' },
  { value: 'antarcticCircumpolar', label: '南极绕极流' },
];

const UserControls: React.FC<UserControlsProps> = ({
  region,
  depthRange,
  particleDensity,
  isPlaying,
  onRegionChange,
  onDepthRangeChange,
  onParticleDensityChange,
  onPlayPause,
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const selectedRegion = REGION_OPTIONS.find(r => r.value === region)?.label || '';

  const handleRegionSelect = useCallback((value: OceanRegion) => {
    onRegionChange(value);
    setIsDropdownOpen(false);
  }, [onRegionChange]);

  const handleMinDepthChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const min = parseFloat(e.target.value);
    const max = depthRange[1];
    if (min < max) {
      onDepthRangeChange([min, max]);
    }
  }, [depthRange, onDepthRangeChange]);

  const handleMaxDepthChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const max = parseFloat(e.target.value);
    const min = depthRange[0];
    if (max > min) {
      onDepthRangeChange([min, max]);
    }
  }, [depthRange, onDepthRangeChange]);

  const handleDensityChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onParticleDensityChange(parseFloat(e.target.value));
  }, [onParticleDensityChange]);

  return (
    <div style={{
      position: 'absolute',
      top: '50%',
      right: '20px',
      transform: 'translateY(-50%)',
      width: '280px',
      background: 'rgba(255, 255, 255, 0.08)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderRadius: '16px',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      padding: '24px',
      zIndex: 100,
      userSelect: 'none',
    }}>
      <h2 style={{
        color: '#00b894',
        fontSize: '18px',
        fontWeight: 600,
        marginBottom: '20px',
        textAlign: 'center',
        letterSpacing: '0.5px',
      }}>
        🌊 海洋模拟控制
      </h2>

      <div style={{ marginBottom: '20px' }}>
        <label style={{
          display: 'block',
          color: '#8899aa',
          fontSize: '13px',
          marginBottom: '8px',
        }}>
          选择海域
        </label>
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            style={{
              width: '100%',
              padding: '12px 16px',
              background: 'rgba(13, 27, 42, 0.8)',
              border: '1px solid rgba(0, 184, 148, 0.3)',
              borderRadius: '10px',
              color: '#fff',
              fontSize: '14px',
              textAlign: 'left',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.02)';
              e.currentTarget.style.borderColor = 'rgba(0, 184, 148, 0.6)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.borderColor = 'rgba(0, 184, 148, 0.3)';
            }}
          >
            <span>{selectedRegion}</span>
            <span style={{
              transition: 'transform 0.2s',
              transform: isDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            }}>
              ▼
            </span>
          </button>
          {isDropdownOpen && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: '4px',
              background: 'rgba(13, 27, 42, 0.95)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '10px',
              overflow: 'hidden',
              zIndex: 10,
            }}>
              {REGION_OPTIONS.map((option) => (
                <div
                  key={option.value}
                  onClick={() => handleRegionSelect(option.value)}
                  style={{
                    padding: '12px 16px',
                    color: option.value === region ? '#00b894' : '#fff',
                    fontSize: '14px',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                    background: option.value === region ? 'rgba(0, 184, 148, 0.1)' : 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (option.value !== region) {
                      e.currentTarget.style.background = '#1b2838';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (option.value !== region) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  {option.label}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={{
          display: 'block',
          color: '#8899aa',
          fontSize: '13px',
          marginBottom: '8px',
        }}>
          水深层范围
        </label>
        <div style={{ marginBottom: '12px' }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '12px',
            color: '#00b894',
            fontFamily: 'monospace',
            marginBottom: '6px',
          }}>
            <span>{depthRange[0].toFixed(0)} m</span>
            <span>{depthRange[1].toFixed(0)} m</span>
          </div>
          <div style={{
            position: 'relative',
            height: '6px',
            background: 'linear-gradient(to right, #0a3d62, #00b894)',
            borderRadius: '3px',
            marginBottom: '10px',
          }} />
        </div>
        <div style={{ marginBottom: '10px' }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '11px',
            color: '#667788',
            marginBottom: '4px',
          }}>
            <span>最浅深度</span>
          </div>
          <input
            type="range"
            min="0"
            max="1000"
            step="10"
            value={depthRange[0]}
            onChange={handleMinDepthChange}
            style={{
              width: '100%',
              height: '6px',
              appearance: 'none',
              WebkitAppearance: 'none',
              background: 'linear-gradient(to right, #0a3d62, #00b894)',
              borderRadius: '3px',
              outline: 'none',
              cursor: 'pointer',
              transition: 'all 0.15s ease-out',
            }}
          />
        </div>
        <div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '11px',
            color: '#667788',
            marginBottom: '4px',
          }}>
            <span>最深深度</span>
          </div>
          <input
            type="range"
            min="0"
            max="1000"
            step="10"
            value={depthRange[1]}
            onChange={handleMaxDepthChange}
            style={{
              width: '100%',
              height: '6px',
              appearance: 'none',
              WebkitAppearance: 'none',
              background: 'linear-gradient(to right, #0a3d62, #00b894)',
              borderRadius: '3px',
              outline: 'none',
              cursor: 'pointer',
              transition: 'all 0.15s ease-out',
            }}
          />
        </div>
      </div>

      <div style={{ marginBottom: '24px' }}>
        <label style={{
          display: 'flex',
          justifyContent: 'space-between',
          color: '#8899aa',
          fontSize: '13px',
          marginBottom: '8px',
        }}>
          <span>粒子密度</span>
          <span style={{
            color: '#00b894',
            fontFamily: 'monospace',
          }}>
            {Math.round(particleDensity * 100)}%
          </span>
        </label>
        <input
          type="range"
          min="0.3"
          max="1"
          step="0.05"
          value={particleDensity}
          onChange={handleDensityChange}
          style={{
            width: '100%',
            height: '6px',
            appearance: 'none',
            WebkitAppearance: 'none',
            background: 'linear-gradient(to right, #0a3d62, #00b894)',
            borderRadius: '3px',
            outline: 'none',
            cursor: 'pointer',
            transition: 'all 0.15s ease-out',
          }}
        />
      </div>

      <button
        onClick={onPlayPause}
        style={{
          width: '100%',
          padding: '14px',
          background: isPlaying
            ? 'linear-gradient(135deg, #e17055, #d63031)'
            : 'linear-gradient(135deg, #00b894, #00cec9)',
          border: 'none',
          borderRadius: '10px',
          color: '#fff',
          fontSize: '15px',
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: isPlaying
            ? '0 4px 15px rgba(214, 48, 49, 0.3)'
            : '0 4px 15px rgba(0, 184, 148, 0.3)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.05)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)';
        }}
        onMouseDown={(e) => {
          e.currentTarget.style.transform = 'scale(0.98)';
        }}
        onMouseUp={(e) => {
          e.currentTarget.style.transform = 'scale(1.05)';
        }}
      >
        {isPlaying ? '⏸ 暂停' : '▶ 播放'}
      </button>

      <div style={{
        marginTop: '20px',
        paddingTop: '16px',
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
      }}>
        <div style={{
          fontSize: '11px',
          color: '#556677',
          textAlign: 'center',
          lineHeight: '1.5',
        }}>
          🌍 拖拽旋转视角 | 滚轮缩放
          <br />
          点击浮游生物查看详情
        </div>
      </div>

      <style>{`
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #00cec9;
          cursor: pointer;
          box-shadow: 0 0 10px rgba(0, 206, 201, 0.5);
          transition: all 0.15s ease-out;
        }
        input[type="range"]::-webkit-slider-thumb:hover {
          transform: scale(1.2);
          box-shadow: 0 0 15px rgba(0, 206, 201, 0.8);
        }
        input[type="range"]::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #00cec9;
          cursor: pointer;
          border: none;
          box-shadow: 0 0 10px rgba(0, 206, 201, 0.5);
          transition: all 0.15s ease-out;
        }
        input[type="range"]::-moz-range-thumb:hover {
          transform: scale(1.2);
          box-shadow: 0 0 15px rgba(0, 206, 201, 0.8);
        }
      `}</style>
    </div>
  );
};

export default UserControls;
