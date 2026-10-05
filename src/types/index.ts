export type FlourType = 'fine' | 'medium' | 'bran';

export interface Particle {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  life: number;
}

/** 三种面粉的瞬时产出量（斤）或配比 */
export interface FlourMix {
  fine: number;
  medium: number;
  bran: number;
}

/**
 * 产出分段：在 [startTime, endTime] 区间内，磨盘间隙与水轮转速保持不变，
 * 该区间内产出的面粉全部按此状态累计。分段是批次账目与磨盘状态联动的最小单位。
 */
export interface MillSegment {
  id: string;
  gap: number;
  speed: number;
  startTime: number;
  endTime: number;
  output: FlourMix;
}

/** 已打包批次中保存的单段历史依据 */
export interface BatchBasisSegment {
  gap: number;
  speed: number;
  durationMs: number;
  ratios: FlourMix;
  /** 该分段对本袋面粉贡献的重量（斤） */
  contribution: number;
}

export interface Batch {
  id: string;
  /** 全局打包序号，连续打包时互不覆盖 */
  seq: number;
  type: FlourType;
  weight: number;
  timestamp: string;
  /** 加权平均间隙（mm），便于列表概览，完整依据见 basis */
  avgGap: number;
  /** 加权平均转速 */
  avgSpeed: number;
  /** 本袋产出期间的完整分段依据，打包后永久保持不变 */
  basis: BatchBasisSegment[];
}

export interface AnimatingBag {
  id: string;
  type: FlourType;
  weight: number;
}

export interface MillState {
  valveOpening: number;
  wheelSpeed: number;
  gap: number;
  load: number;
  isOverloaded: boolean;
  isRunning: boolean;

  /** 已封存的产出分段（状态变更或打包时封存） */
  sealedSegments: MillSegment[];
  /** 当前进行中的分段，产出实时累计其中 */
  openSegment: MillSegment;
  /** 分段自增序号，保证同一序列重复运行时 id 一致 */
  segmentSeq: number;

  batches: Batch[];
  batchSeq: number;
  animatingBags: AnimatingBag[];

  /** 上一次记账时刻（ms），分段时长由此精确计算 */
  lastLedgerAt: number;
}

export type MillAction =
  | { type: 'SET_VALVE'; valve: number; now: number }
  | { type: 'SET_GAP'; gap: number; now: number }
  | { type: 'TICK'; now: number }
  | {
      type: 'PACK';
      flourType: FlourType;
      id: string;
      now: number;
      timestamp: string;
    }
  | { type: 'LOAD_BATCHES'; batches: Batch[] }
  | { type: 'REMOVE_BAG_ANIMATION'; id: string };
