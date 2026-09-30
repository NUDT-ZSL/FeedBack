import React, { useCallback, useMemo, useState } from 'react';
import { Scene } from './components/Scene';
import { WeatherPanel } from './components/WeatherPanel';
import { InfoPopup } from './components/InfoPopup';
import { weatherSystem, useWeatherSystem } from './engine/useWeatherSystem';
import { WeatherDataPoint, WeatherFilters } from './data/weatherData';

const App: React.FC = () => {
  const weatherState = useWeatherSystem();
  const [hoveredPointId, setHoveredPointId] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const hoveredPoint = useMemo<WeatherDataPoint | null>(() => {
    if (hoveredPointId === null) return null;
    return weatherSystem.getPointById(hoveredPointId) ?? null;
  }, [hoveredPointId, weatherState.data]);

  const handleHourChange = useCallback((hour: number) => {
    weatherSystem.setHour(hour);
  }, []);

  const handleFiltersChange = useCallback((newFilters: Partial<WeatherFilters>) => {
    weatherSystem.updateFilters(newFilters);
  }, []);

  const handleRotationToggle = useCallback((enabled: boolean) => {
    weatherSystem.toggleRotation(enabled);
  }, []);

  const handleParticleHover = useCallback(
    (point: WeatherDataPoint | null, x: number, y: number) => {
      setHoveredPointId(point?.id ?? null);
      setMousePos({ x, y });
    },
    []
  );

  return (
    <div className="app-container">
      <div className="app-title">全球气象可视化</div>

      <div className="canvas-container">
        <Scene
          data={weatherState.data}
          filters={weatherState.filters}
          currentHour={weatherState.currentHour}
          isRotating={weatherState.isRotating}
          earthRadius={weatherState.earthRadius}
          onParticleHover={handleParticleHover}
        />
      </div>

      <WeatherPanel
        currentHour={weatherState.currentHour}
        onHourChange={handleHourChange}
        filters={weatherState.filters}
        onFiltersChange={handleFiltersChange}
        isRotating={weatherState.isRotating}
        onRotationToggle={handleRotationToggle}
      />

      <InfoPopup
        visible={!!hoveredPoint}
        x={mousePos.x}
        y={mousePos.y}
        data={
          hoveredPoint
            ? {
                lat: hoveredPoint.lat,
                lon: hoveredPoint.lon,
                temperature: hoveredPoint.temperature,
                pressure: hoveredPoint.pressure,
                humidity: hoveredPoint.humidity,
              }
            : null
        }
      />
    </div>
  );
};

export default App;
