export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export interface SunPosition {
  elevation: number;
  azimuth: number;
  direction: { x: number; y: number; z: number };
}

export interface SunState {
  season: Season;
  timeOfDay: number;
  position: SunPosition;
}

export interface RoomLighting {
  windowIllumination: number;
  avgIlluminance: number;
  shadowRatio: number;
}
