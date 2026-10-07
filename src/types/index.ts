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

export type SealShape = 'gourd' | 'square' | 'circle' | 'oval' | 'rectangle';
export type SealCharacter = '永' | '赏' | '藏' | '鉴' | '玩';
export type SealColor = '#c0392b' | '#2c3e50' | '#2c2c2c';

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
