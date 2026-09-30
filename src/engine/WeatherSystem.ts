import * as THREE from 'three';
import {
  buildWeatherTimeline,
  generateWeatherData,
  latLonToVector3,
  MAX_HOUR,
  MIN_HOUR,
  pressureToSize,
  temperatureToColor,
  WeatherDataPoint,
  WeatherFilters,
} from '@/data/weatherData';

export interface ParticleAppearance {
  color: string;
  size: number;
  opacity: number;
}

export interface WeatherSystemSnapshot {
  data: WeatherDataPoint[];
  currentHour: number;
  filters: WeatherFilters;
  isRotating: boolean;
  earthRadius: number;
}

const DEFAULT_FILTERS: WeatherFilters = {
  showTemperature: true,
  showPressure: true,
  showHumidity: true,
};

const EARTH_RADIUS = 2;
const PARTICLE_BASE_SIZE = 0.05;
const FLOAT_AMPLITUDE = 0.025;
const FLOAT_FREQUENCY = 0.3;

export class WeatherSystem {
  private readonly timeline: WeatherDataPoint[][];
  private currentHour = MIN_HOUR;
  private filters: WeatherFilters = { ...DEFAULT_FILTERS };
  private isRotating = false;
  private time = 0;
  private readonly anchorPositions = new Map<number, THREE.Vector3>();
  private readonly anchorDirections = new Map<number, THREE.Vector3>();
  private readonly listeners = new Set<() => void>();
  private snapshot: WeatherSystemSnapshot;

  constructor() {
    const baseData = generateWeatherData();
    this.timeline = buildWeatherTimeline(baseData);
    this.snapshot = this.createSnapshot();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): WeatherSystemSnapshot => this.snapshot;

  getData(): WeatherDataPoint[] {
    return this.snapshot.data;
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
    return EARTH_RADIUS;
  }

  setHour(hour: number): void {
    const nextHour = Math.max(MIN_HOUR, Math.min(MAX_HOUR, Math.round(hour)));
    if (nextHour === this.currentHour) return;

    this.currentHour = nextHour;
    this.emit();
  }

  updateFilters(filters: Partial<WeatherFilters>): void {
    const nextFilters = { ...this.filters, ...filters };
    if (this.filtersEqual(nextFilters, this.filters)) return;

    this.filters = nextFilters;
    this.emit();
  }

  toggleRotation(enabled: boolean): void {
    if (enabled === this.isRotating) return;

    this.isRotating = enabled;
    this.emit();
  }

  update(delta: number): void {
    this.time += delta;
  }

  getTime(): number {
    return this.time;
  }

  getPointById(id: number): WeatherDataPoint | undefined {
    return this.snapshot.data.find((point) => point.id === id);
  }

  getParticlePosition(point: WeatherDataPoint, target: THREE.Vector3): THREE.Vector3 {
    const basePosition = this.getAnchorPosition(point.id, point.lat, point.lon);
    const direction = this.getAnchorDirection(point.id, basePosition);
    const floatOffset =
      Math.sin(this.time * FLOAT_FREQUENCY * Math.PI * 2 + point.phase) * FLOAT_AMPLITUDE;

    return target
      .copy(basePosition)
      .addScaledVector(direction, PARTICLE_BASE_SIZE * 0.8 + floatOffset);
  }

  getParticleAppearance(point: WeatherDataPoint): ParticleAppearance {
    return {
      color: temperatureToColor(point.temperature),
      size: pressureToSize(point.pressure) * PARTICLE_BASE_SIZE,
      opacity: this.getParticleOpacity(),
    };
  }

  getParticleColor(point: WeatherDataPoint): string {
    return this.getParticleAppearance(point).color;
  }

  getParticleSize(point: WeatherDataPoint): number {
    return this.getParticleAppearance(point).size;
  }

  getParticleOpacity(): number {
    const visibleCount = [
      this.filters.showTemperature,
      this.filters.showPressure,
      this.filters.showHumidity,
    ].filter(Boolean).length;

    if (visibleCount === 0) return 0.1;
    if (visibleCount === 3) return 0.85;
    return 0.2 + (visibleCount / 3) * 0.65;
  }

  getState(): WeatherSystemSnapshot {
    return {
      ...this.snapshot,
      data: [...this.snapshot.data],
      filters: { ...this.filters },
    };
  }

  getTimeArcAngle(): number {
    return (this.currentHour / MAX_HOUR) * Math.PI * 2;
  }

  private createSnapshot(): WeatherSystemSnapshot {
    return {
      data: this.timeline[this.currentHour],
      currentHour: this.currentHour,
      filters: { ...this.filters },
      isRotating: this.isRotating,
      earthRadius: EARTH_RADIUS,
    };
  }

  private emit(): void {
    this.snapshot = this.createSnapshot();
    this.listeners.forEach((listener) => listener());
  }

  private filtersEqual(left: WeatherFilters, right: WeatherFilters): boolean {
    return (
      left.showTemperature === right.showTemperature &&
      left.showPressure === right.showPressure &&
      left.showHumidity === right.showHumidity
    );
  }

  private getAnchorPosition(id: number, lat: number, lon: number): THREE.Vector3 {
    let position = this.anchorPositions.get(id);
    if (!position) {
      position = latLonToVector3(lat, lon, EARTH_RADIUS);
      this.anchorPositions.set(id, position);
    }
    return position;
  }

  private getAnchorDirection(id: number, position: THREE.Vector3): THREE.Vector3 {
    let direction = this.anchorDirections.get(id);
    if (!direction) {
      direction = position.clone().normalize();
      this.anchorDirections.set(id, direction);
    }
    return direction;
  }
}

export const weatherSystem = new WeatherSystem();
