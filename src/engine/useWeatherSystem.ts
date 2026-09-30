import { useSyncExternalStore } from 'react';
import { weatherSystem, type WeatherSystemSnapshot } from './WeatherSystem';

export function useWeatherSystem(): WeatherSystemSnapshot {
  return useSyncExternalStore(weatherSystem.subscribe, weatherSystem.getSnapshot);
}

export { weatherSystem };
