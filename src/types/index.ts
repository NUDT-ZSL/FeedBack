export type ScrollCategory = '山水' | '花鸟' | '人物' | '书法';

export interface Scroll {
  id: string;
  name: string;
  author: string;
  dynasty: string;
  thumbnailUrl: string;
  largeImageUrl: string;
  description: string;
  category: ScrollCategory;
}

export const SEAL_SHAPES = ['gourd', 'square', 'circle', 'oval', 'rectangle'] as const;
export type SealShape = (typeof SEAL_SHAPES)[number];

export const SEAL_CHARACTERS = ['永', '赏', '藏', '鉴', '玩'] as const;
export type SealCharacter = (typeof SEAL_CHARACTERS)[number];

/** 每种印章形状对应的固定篆字，形状是唯一合法取值来源 */
export const SEAL_CHARACTER_BY_SHAPE: Record<SealShape, SealCharacter> = {
  gourd: '永',
  square: '赏',
  circle: '藏',
  oval: '鉴',
  rectangle: '玩',
};

export const SEAL_COLORS = ['#c0392b', '#2c3e50', '#2c2c2c'] as const;
export type SealColor = (typeof SEAL_COLORS)[number];

/** 印章旋转范围（度）：0-15 */
export const SEAL_ROTATION_MIN = 0;
export const SEAL_ROTATION_MAX = 15;

/** 印章归一化位置范围：相对画作宽高的 0-1 */
export const SEAL_POSITION_MIN = 0;
export const SEAL_POSITION_MAX = 1;

/** 跋文最大字数 */
export const COLOPHON_MAX_LENGTH = 100;

export interface Seal {
  id: string;
  shape: SealShape;
  character: SealCharacter;
  color: SealColor;
  rotation: number;
  position: {
    x: number;
    y: number;
  };
}

export interface CollectedScroll extends Scroll {
  colophon: string;
  seal: Seal | null;
  collectedAt: number;
  order: number;
}
