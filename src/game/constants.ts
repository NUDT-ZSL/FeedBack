import { CatapultConfig } from './types';

export const BATTLEFIELD_WIDTH = 1280;
export const BATTLEFIELD_HEIGHT = 720;

export const GROUND_Y = 600;
export const WALL_X = 900;
export const WALL_WIDTH = 300;
export const WALL_HEIGHT = 350;
export const WALL_SEGMENTS = 5;

export const SLOT_POSITIONS = [
  { x: 450, y: GROUND_Y - 50 },
  { x: 550, y: GROUND_Y - 50 },
  { x: 650, y: GROUND_Y - 50 },
];

export const CATAPULT_CONFIGS: Record<string, CatapultConfig> = {
  light: {
    name: '轻型抛石车',
    damage: 15,
    range: { min: 200, max: 400 },
    reloadTime: 1,
    maxHealth: 60,
    velocity: 85,
  },
  medium: {
    name: '中型配重式',
    damage: 25,
    range: { min: 300, max: 550 },
    reloadTime: 1,
    maxHealth: 80,
    velocity: 95,
  },
  heavy: {
    name: '重型回回炮',
    damage: 40,
    range: { min: 400, max: 700 },
    reloadTime: 1,
    maxHealth: 100,
    velocity: 110,
  },
};

export const AMMO_CONFIGS = {
  stone: {
    name: '石弹',
    damageMultiplier: 1.0,
    particleColor: '#b8a060',
    particleCount: 20,
  },
  fire: {
    name: '火油罐',
    damageMultiplier: 1.2,
    particleColor: '#ff6a00',
    particleCount: 25,
  },
};

export const GRAVITY = 0.5;
export const MAX_PARTICLES = 300;
export const MAX_ANGLE = 75;
export const MIN_ANGLE = 0;

export const COLORS = {
  sky: '#6b8e9a',
  mountain: '#5a7a6b',
  wall: '#7a7a7a',
  wallDark: '#5a5a5a',
  ground: '#9a7a5a',
  groundDark: '#7a5a3a',
  weaponRack: '#5a3a2a',
  flag: '#8b3a3a',
  flagDark: '#6a2a2a',
  wood: '#8b5a2b',
  woodDark: '#5a3a1a',
  metal: '#8a8a8a',
  metalDark: '#5a5a5a',
};
