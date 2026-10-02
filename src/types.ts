export interface CopperCoin {
  id: number;
  isFlipping: boolean;
  face: 'zheng' | 'bei';
  rotation: number;
  jumpOffset: number;
}

export interface Yao {
  position: 1 | 2 | 3 | 4 | 5 | 6;
  type: 'lao-yang' | 'lao-yin' | 'shao-yang' | 'shao-yin';
  isMoving: boolean;
  coinResult: ['zheng' | 'bei', 'zheng' | 'bei', 'zheng' | 'bei'];
}

export interface Hexagram {
  id: string;
  name: string;
  yaoArray: Yao[];
  guaCi: string;
  xiangCi: string;
  movingYaoIndices: number[];
  fortuneLevel: '大吉' | '吉' | '中' | '凶' | '大凶';
  upperTrigram: string;
  lowerTrigram: string;
  timestamp: number;
}

export interface TrigramDirection {
  name: string;
  angle: number;
  color: string;
  element: '金' | '木' | '水' | '火' | '土';
  unicodeSymbol: string;
}

export type { CopperCoin, Yao, Hexagram, TrigramDirection };
