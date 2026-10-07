export enum CloisonneProcess {
  FILIGREE = 'filigree',
  ENAMEL = 'enamel',
  FIRING = 'firing',
  POLISHING = 'polishing',
  GILDING = 'gilding',
  FINISHED = 'finished'
}

export interface CopperWire {
  id: string;
  diameter: number;
  color: string;
  spoolPosition: [number, number, number];
}

export interface EnamelColor {
  id: string;
  name: string;
  color: string;
  wetColor: string;
  position: [number, number, number];
}

export interface FiligreeWire {
  id: string;
  wireId: string;
  points: [number, number, number][];
  confirmed: boolean;
  highlighted: boolean;
}

export interface EnamelFill {
  regionId: string;
  colorId: string;
  fillProgress: number;
  isWet: boolean;
}

export interface Sandpaper {
  id: string;
  grit: 'coarse' | 'medium' | 'fine';
  color: string;
  position: [number, number, number];
}

export interface VesselState {
  baseColor: string;
  filigreeWires: FiligreeWire[];
  enamelFills: EnamelFill[];
  polishProgress: number;
  isFired: boolean;
  gildingProgress: number;
  mirrorReflection: number;
}

export interface SelectedMaterial {
  wireId: string | null;
  enamelId: string | null;
  sandpaperId: string | null;
  goldPaste: boolean;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}
