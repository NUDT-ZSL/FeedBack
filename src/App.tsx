import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Scene } from './components/Scene';
import { WeatherPanel } from './components/WeatherPanel';
import { InfoPopup } from './components/InfoPopup';
import { WeatherSystem } from './engine/WeatherSystem';
import { WeatherDataPoint, WeatherFilters } from './data/weatherData';

const App: React.FC = () => {
  const weatherSystemRef = useRef<WeatherSystem>(new WeatherSystem());
  const [weatherData, setWeatherData] = useState<WeatherDataPoint[]>([]);
  const [currentHour, setCurrentHour] = useState(0);
  const [filters, setFilters] = useState<WeatherFilters>({
    showTemperature: true,
    showPressure: true,
    showHumidity: true,
  });
  const [isRotating, setIsRotating] = useState(false);
  const [hoveredPoint, setHoveredPoint] = useState<WeatherDataPoint | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const system = weatherSystemRef.current;
    setWeatherData(system.getData());
    setFilters(system.getFilters());
    setIsRotating(system.getIsRotating());
  }, []);

  const handleHourChange = useCallback((hour: number) => {
    setCurrentHour(hour);
    const system = weatherSystemRef.current;
    system.setHour(hour);
    setWeatherData(system.getData());
  }, []);

  const handleFiltersChange = useCallback((newFilters: Partial<WeatherFilters>) => {
    setFilters((prev) => {
      const updated = { ...prev, ...newFilters };
      weatherSystemRef.current.updateFilters(updated);
      return updated;
    });
  }, []);

  const handleRotationToggle = useCallback((enabled: boolean) => {
    setIsRotating(enabled);
    weatherSystemRef.current.toggleRotation(enabled);
  }, []);

  const handleParticleHover = useCallback(
    (point: WeatherDataPoint | null, x: number, y: number) => {
      setHoveredPoint(point);
      setMousePos({ x, y });
    },
    []
  );

  return (
    <div className="app-container">
      <div className="app-title">全球气象可视化</div>

      <div className="canvas-container">
        <Scene
          data={weatherData}
          filters={filters}
          currentHour={currentHour}
          isRotating={isRotating}
          onParticleHover={handleParticleHover}
        />
      </div>

      <WeatherPanel
        currentHour={currentHour}
        onHourChange={handleHourChange}
        filters={filters}
        onFiltersChange={handleFiltersChange}
        isRotating={isRotating}
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
