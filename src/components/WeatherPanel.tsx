import React, { useState } from 'react';
import { WeatherFilters } from '@/data/weatherData';

interface WeatherPanelProps {
  currentHour: number;
  onHourChange: (hour: number) => void;
  filters: WeatherFilters;
  onFiltersChange: (filters: Partial<WeatherFilters>) => void;
  isRotating: boolean;
  onRotationToggle: (enabled: boolean) => void;
}

export const WeatherPanel: React.FC<WeatherPanelProps> = ({
  currentHour,
  onHourChange,
  filters,
  onFiltersChange,
  isRotating,
  onRotationToggle,
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onHourChange(Number(e.target.value));
  };

  const toggleFilter = (key: keyof WeatherFilters) => {
    onFiltersChange({ [key]: !filters[key] });
  };

  return (
    <>
      <button
        className="panel-toggle-btn"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle panel"
      >
        ⚙
      </button>

      <div className={`weather-panel ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="panel-section">
          <div className="time-display">第 {Math.round(currentHour)} 小时</div>
          <div className="panel-label">时间轴（0-72小时）</div>
          <input
            type="range"
            min="0"
            max="72"
            step="1"
            value={currentHour}
            onChange={handleSliderChange}
            className="time-slider"
          />
        </div>

        <div className="panel-section">
          <div className="panel-label">数据筛选</div>
          <div className="toggle-buttons">
            <button
              className={`toggle-btn ${filters.showTemperature ? 'active' : ''}`}
              onClick={() => toggleFilter('showTemperature')}
            >
              温度
            </button>
            <button
              className={`toggle-btn ${filters.showPressure ? 'active' : ''}`}
              onClick={() => toggleFilter('showPressure')}
            >
              气压
            </button>
            <button
              className={`toggle-btn ${filters.showHumidity ? 'active' : ''}`}
              onClick={() => toggleFilter('showHumidity')}
            >
              湿度
            </button>
          </div>
        </div>

        <div className="panel-section">
          <div
            className="rotation-toggle"
            onClick={() => onRotationToggle(!isRotating)}
          >
            <span className="rotation-label">地球自转</span>
            <div className={`switch ${isRotating ? 'active' : ''}`}>
              <div className="switch-handle" />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
