export type CoinSide = 'zheng' | 'bei';

export type YaoType = 'lao-yang' | 'lao-yin' | 'shao-yang' | 'shao-yin';

export interface YaoResult {
  type: YaoType;
  isMoving: boolean;
  isYang: boolean;
}

/** 一爻的完整记录，position 1 为初爻（最下），6 为上爻（最上） */
export interface Yao extends YaoResult {
  position: 1 | 2 | 3 | 4 | 5 | 6;
  coins: [CoinSide, CoinSide, CoinSide];
}

/** 一条起卦归档记录 */
export interface DivinationRecord {
  /** 全局唯一 ID（时间戳 + 递增序号 + 随机后缀，同一毫秒连续起卦也不会冲突） */
  id: string;
  /** 起卦时刻（毫秒时间戳） */
  createdAt: number;
  /** 用户补充的所问之事 */
  question: string;
  /** 六爻，索引 0 为初爻 */
  yaos: Yao[];
  /** 本卦二进制爻序（初爻在前，阳 1 阴 0） */
  benBinary: string;
  /** 变卦二进制爻序（无动爻时与本卦一致） */
  bianBinary: string;
  /** 动爻位置（1-6，自下而上） */
  movingPositions: number[];
}

export interface AnimationParams {
  rotation: number;
  bounce: number;
  duration: number;
}
