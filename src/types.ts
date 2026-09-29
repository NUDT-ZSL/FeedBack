export type SpectralType = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M';

export interface Star {
  id: number;
  name: string;
  spectralType: SpectralType;
  apparentMagnitude: number;
  distance: number;
  temperature: number;
  position: { x: number; y: number; z: number };
}

export interface FilterState {
  spectralTypes: SpectralType[];
  magnitudeRange: [number, number];
}

export interface SpectralInfo {
  color: string;
  tempMin: number;
  tempMax: number;
  ratio: number;
  label: string;
}
