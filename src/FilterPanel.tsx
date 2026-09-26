import { useState, useCallback } from 'react';
import { FilterState, SpectralType } from './types';
import { SPECTRAL_MAP } from './StarData';
import { Menu, X } from 'lucide-react';
import './FilterPanel.css';

interface FilterPanelProps {
  filter: FilterState;
  onFilterChange: (filter: FilterState) => void;
  isMobileOpen: boolean;
  onMobileToggle: () => void;
}

const SPECTRAL_TYPES: SpectralType[] = ['O', 'B', 'A', 'F', 'G', 'K', 'M'];

export default function FilterPanel({ filter, onFilterChange, isMobileOpen, onMobileToggle }: FilterPanelProps) {
  const [minMag, setMinMag] = useState(filter.magnitudeRange[0]);
  const [maxMag, setMaxMag] = useState(filter.magnitudeRange[1]);

  const toggleSpectralType = useCallback((type: SpectralType) => {
    const newTypes = filter.spectralTypes.includes(type)
      ? filter.spectralTypes.filter(t => t !== type)
      : [...filter.spectralTypes, type];
    onFilterChange({ ...filter, spectralTypes: newTypes });
  }, [filter, onFilterChange]);

  const selectAll = useCallback(() => {
    onFilterChange({ ...filter, spectralTypes: [...SPECTRAL_TYPES] });
  }, [filter, onFilterChange]);

  const handleMinChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    const newMin = Math.min(value, maxMag - 0.5);
    setMinMag(newMin);
    onFilterChange({ ...filter, magnitudeRange: [newMin, maxMag] });
  }, [filter, maxMag, onFilterChange]);

  const handleMaxChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    const newMax = Math.max(value, minMag + 0.5);
    setMaxMag(newMax);
    onFilterChange({ ...filter, magnitudeRange: [minMag, newMax] });
  }, [filter, minMag, onFilterChange]);

  const panelContent = (
    <>
      <div className="filter-header">
        <h3 className="filter-title">筛选面板</h3>
        <button className="mobile-close-btn" onClick={onMobileToggle}>
          <X size={20} />
        </button>
      </div>

      <div className="filter-section">
        <p className="section-label">光谱类型</p>
        <div className="spectral-grid">
          <button
            className={`spectral-btn all-btn ${filter.spectralTypes.length === 7 ? 'active' : ''}`}
            onClick={selectAll}
            style={{ background: 'linear-gradient(135deg, #9bb0ff, #ffcc6f)' }}
          >
            全部
          </button>
          {SPECTRAL_TYPES.map((type) => {
            const info = SPECTRAL_MAP[type];
            const isActive = filter.spectralTypes.includes(type);
            return (
              <button
                key={type}
                className={`spectral-btn ${isActive ? 'active' : ''}`}
                onClick={() => toggleSpectralType(type)}
                style={{ backgroundColor: info.color + '4d' }}
                title={info.label}
              >
                <span className="spectral-dot" style={{ backgroundColor: info.color }} />
                <span className="spectral-letter">{type}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="filter-section">
        <p className="section-label">亮度范围</p>
        <div className="magnitude-display">
          亮度：{minMag.toFixed(1)} ～ {maxMag.toFixed(1)}
        </div>
        <div className="slider-container">
          <div className="slider-track">
            <div
              className="slider-fill"
              style={{
                left: `${((minMag + 1) / 11) * 100}%`,
                right: `${100 - ((maxMag + 1) / 11) * 100}%`,
              }}
            />
          </div>
          <input
            type="range"
            min="-1"
            max="10"
            step="0.1"
            value={minMag}
            onChange={handleMinChange}
            className="slider-input slider-min"
          />
          <input
            type="range"
            min="-1"
            max="10"
            step="0.1"
            value={maxMag}
            onChange={handleMaxChange}
            className="slider-input slider-max"
          />
        </div>
        <div className="slider-labels">
          <span>-1</span>
          <span>10</span>
        </div>
      </div>

      <div className="filter-section info-section">
        <p className="section-label">星图信息</p>
        <div className="info-row">
          <span>恒星数量</span>
          <span className="info-value">3000</span>
        </div>
        <div className="info-row">
          <span>银河区域</span>
          <span className="info-value">猎户座旋臂</span>
        </div>
      </div>
    </>
  );

  return (
    <>
      <button className="mobile-menu-btn" onClick={onMobileToggle}>
        <Menu size={24} />
      </button>

      {isMobileOpen && <div className="mobile-overlay" onClick={onMobileToggle} />}

      <div className={`filter-panel ${isMobileOpen ? 'mobile-open' : ''}`}>
        {panelContent}
      </div>
    </>
  );
}
