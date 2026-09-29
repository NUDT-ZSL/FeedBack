import * as THREE from 'three';
import {
  WeatherDataPoint,
  WeatherFilters,
  generateWeatherData,
  updateWeatherDataForHour,
  latLonToVector3,
  temperatureToColor,
  pressureToSize,
} from '@/data/weatherData';

export interface WeatherSystemState {
  data: WeatherDataPoint[];
  currentHour: number;
  filters: WeatherFilters;
  isRotating: boolean;
}

export class WeatherSystem {
  private data: WeatherDataPoint[];
  private currentHour: number = 0;
  private filters: WeatherFilters = {
    showTemperature: true,
    showPressure: true,
    showHumidity: true,
  };
  private isRotating: boolean = false;
  private earthRadius: number = 2;
  private particleBaseSize: number = 0.05;
  private time: number = 0;

  constructor() {
    this.data = generateWeatherData();
  }

  getData(): WeatherDataPoint[] {
    return this.data;
  }

  getCurrentHour(): number {
    return this.currentHour;
  }

  getFilters(): WeatherFilters {
    return { ...this.filters };
  }

  getIsRotating(): boolean {
    return this.isRotating;
  }

  getEarthRadius(): number {
    return this.earthRadius;
  }

  setHour(hour: number): void {
    this.currentHour = Math.max(0, Math.min(72, hour));
    this.data = updateWeatherDataForHour(
      generateWeatherData(),
      this.currentHour
    );
  }

  updateFilters(filters: Partial<WeatherFilters>): void {
    this.filters = { ...this.filters, ...filters };
  }

  toggleRotation(enabled: boolean): void {
    this.isRotating = enabled;
  }

  update(delta: number): void {
    this.time += delta;
  }

  getTime(): number {
    return this.time;
  }

  getParticlePosition(point: WeatherDataPoint): THREE.Vector3 {
    const basePos = latLonToVector3(point.lat, point.lon, this.earthRadius);
    const floatOffset = Math.sin(this.time * 0.3 * Math.PI * 2 + point.phase) * 0.05;
    const direction = basePos.clone().normalize();
    return basePos.add(direction.multiplyScalar(this.particleBaseSize + floatOffset));
  }

  getParticleColor(point: WeatherDataPoint): string {
    return temperatureToColor(point.temperature);
  }

  getParticleSize(point: WeatherDataPoint): number {
    return pressureToSize(point.pressure) * this.particleBaseSize;
  }

  getParticleOpacity(point: WeatherDataPoint): number {
    const tempVisible = this.filters.showTemperature;
    const pressureVisible = this.filters.showPressure;
    const humidityVisible = this.filters.showHumidity;

    const allOff = !tempVisible && !pressureVisible && !humidityVisible;
    if (allOff) return 0.1;

    let visibleCount = 0;
    let totalCount = 0;

    if (this.filters.showTemperature) {
      visibleCount++;
    }
    totalCount++;

    if (this.filters.showPressure) {
      visibleCount++;
    }
    totalCount++;

    if (this.filters.showHumidity) {
      visibleCount++;
    }
    totalCount++;

    return visibleCount / totalCount * 0.8 + 0.2;
  }

  getState(): WeatherSystemState {
    return {
      data: [...this.data],
      currentHour: this.currentHour,
      filters: { ...this.filters },
      isRotating: this.isRotating,
    };
  }

  getTimeArcAngle(): number {
    return (this.currentHour / 72) * Math.PI * 2;
  }
}
