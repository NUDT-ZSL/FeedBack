export type LanternType = 'palace' | 'revolving' | 'silk';

export type SilkColor = 'moonWhite' | 'gooseYellow' | 'begoniaRed' | 'bambooGreen';

export const SILK_COLORS: Record<SilkColor, string> = {
  moonWhite: '#f5f0e8',
  gooseYellow: '#f0d9a0',
  begoniaRed: '#d94f4a',
  bambooGreen: '#7b9a6b',
};

export type CraftPhase = 'skeleton' | 'pasting' | 'assembly' | 'display' | 'hanging';

export interface Node {
  id: string;
  x: number;
  y: number;
  z: number;
  isDragging: boolean;
}

export interface BambooStrip {
  id: string;
  startNodeId: string;
  endNodeId: string;
  isConnected: boolean;
  highlighted: boolean;
}

export interface SilkPanel {
  id: string;
  nodeIds: string[];
  color: SilkColor;
  pastingProgress: number;
  tension: number;
  isDetached: boolean;
}

export interface SkeletonTemplate {
  type: LanternType;
  name: string;
  nodes: Node[];
  connections: BambooStrip[];
  silkPanels: SilkPanel[];
}

export interface Candle {
  isLit: boolean;
  brightness: number;
  flickerOffset: number;
  flameHeight: number;
}

export interface HangingState {
  isHanging: boolean;
  swingAngle: number;
  swingVelocity: number;
  hookId: string;
}

export const COLORS = {
  bambooGreen: '#7a8a7a',
  bambooDark: '#6b4e3a',
  bambooMedium: '#8b6f47',
  bambooLight: '#d4a76a',
  silkBase: '#c4a882',
  frameDark: '#5d3a1a',
  moonWhite: '#f5f0e8',
  gooseYellow: '#f0d9a0',
  begoniaRed: '#d94f4a',
  leafGreen: '#7b9a6b',
  woodBrown: '#8b4513',
  darkBrown: '#2a1a0e',
  gold: '#d4a017',
  flameOrange: '#ff8c00',
  nightBlue: '#0a1628',
  flameRed: '#c0392b',
  inkBlack: '#2c3e50',
  antiqueGold: '#c49a3c',
} as const;

export type color = SilkColor;
export type tension = number;
export type rotationSpeed = number;
