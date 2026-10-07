import type { SealCharacter, SealColor, SealShape } from '../types/index.ts';

export const SEAL_SHAPES: readonly SealShape[] = ['gourd', 'square', 'circle', 'oval', 'rectangle'];

export const SEAL_COLORS: readonly SealColor[] = ['#c0392b', '#2c3e50', '#2c2c2c'];

export const SEAL_SHAPE_CHARACTERS: Readonly<Record<SealShape, SealCharacter>> = {
  gourd: '永',
  square: '赏',
  circle: '藏',
  oval: '鉴',
  rectangle: '玩',
};

export const SEAL_CHARACTERS: readonly SealCharacter[] = ['永', '赏', '藏', '鉴', '玩'];

export const SEAL_ROTATION_MIN = 0;
export const SEAL_ROTATION_MAX = 15;

export const SEAL_POSITION_MIN = 0;
export const SEAL_POSITION_MAX = 100;

export const DEFAULT_SEAL_POSITION = { x: 88, y: 88 } as const;

export const COLOPHON_MAX_LENGTH = 100;
