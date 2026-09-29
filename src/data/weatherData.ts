export interface WeatherDataPoint {
  id: number;
  lat: number;
  lon: number;
  temperature: number;
  pressure: number;
  humidity: number;
  baseTemperature: number;
  basePressure: number;
  baseHumidity: number;
  phase: number;
}

export interface WeatherFilters {
  showTemperature: boolean;
  showPressure: boolean;
  showHumidity: boolean;
}

const PARTICLE_COUNT = 400;
const HOURS_RANGE = 72;

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9999.1) * 10000;
  return x - Math.floor(x);
}

function generateRandomPoint(index: number): WeatherDataPoint {
  const seed = index * 137.5;
  const u = seededRandom(seed);
  const v = seededRandom(seed + 0.5);
  const lat = Math.acos(2 * u - 1) * (180 / Math.PI) - 90;
  const lon = v * 360 - 180;

  const latFactor = Math.cos((lat * Math.PI) / 180);
  const baseTemp = 15 + 25 * latFactor + (seededRandom(seed + 1) - 0.5) * 15;
  const basePressure = 1013 + (seededRandom(seed + 2) - 0.5) * 40;
  const baseHumidity = 40 + seededRandom(seed + 3) * 50;

  return {
    id: index,
    lat,
    lon,
    temperature: baseTemp,
    pressure: basePressure,
    humidity: baseHumidity,
    baseTemperature: baseTemp,
    basePressure: basePressure,
    baseHumidity: baseHumidity,
    phase: seededRandom(seed + 4) * Math.PI * 2,
  };
}

export function generateWeatherData(): WeatherDataPoint[] {
  const points: WeatherDataPoint[] = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    points.push(generateRandomPoint(i));
  }
  return points;
}

export function updateWeatherDataForHour(
  data: WeatherDataPoint[],
  hour: number
): WeatherDataPoint[] {
  const t = hour / HOURS_RANGE;
  return data.map((point) => {
    const tempVariation = Math.sin(t * Math.PI * 2 + point.phase) * 8;
    const pressureVariation = Math.sin(t * Math.PI * 1.5 + point.phase * 0.7) * 15;
    const humidityVariation = Math.sin(t * Math.PI * 1.2 + point.phase * 1.3) * 15;

    return {
      ...point,
      temperature: point.baseTemperature + tempVariation,
      pressure: point.basePressure + pressureVariation,
      humidity: Math.max(10, Math.min(100, point.baseHumidity + humidityVariation)),
    };
  });
}

export function latLonToVector3(
  lat: number,
  lon: number,
  radius: number
): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);

  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);

  return { x, y, z } as THREE.Vector3;
}

export function temperatureToColor(temp: number): string {
  const minTemp = -10;
  const maxTemp = 40;
  const t = Math.max(0, Math.min(1, (temp - minTemp) / (maxTemp - minTemp)));

  const r = Math.round(255 * t);
  const g = Math.round(180 * (1 - Math.abs(t - 0.5) * 2));
  const b = Math.round(255 * (1 - t));

  return `rgb(${r}, ${g}, ${b})`;
}

export function pressureToSize(pressure: number): number {
  const minPressure = 980;
  const maxPressure = 1050;
  const t = Math.max(0, Math.min(1, (pressure - minPressure) / (maxPressure - minPressure)));
  return 0.3 + t * 0.9;
}
