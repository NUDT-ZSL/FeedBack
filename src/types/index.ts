export type FlourType = 'fine' | 'medium' | 'bran';

export type Fineness = 'fine' | 'medium' | 'coarse';

export interface FlourOutput {
  fine: number;
  medium: number;
  bran: number;
}

export const FLOUR_TYPES: FlourType[] = ['fine', 'medium', 'bran'];

export interface FlourRatios {
  fine: number;
  medium: number;
  bran: number;
}

/** 某一时间段内磨盘的实际工况快照 */
export interface MillConditions {
  /** 磨盘间隙，mm */
  gap: number;
  /** 阀门开度，0-100 */
  valve: number;
  /** 水轮/磨盘转速，rpm */
  speed: number;
  /** 磨盘负载，0-100 */
  load: number;
  /** 该间隙下的面粉粗细档 */
  fineness: Fineness;
  /** 三种产出占比，之和恒为 1 */
  ratios: FlourRatios;
}

/** 未打包台账中的一个产出段落：工况不变期间连续产出归为一段 */
export interface ProductionSegment {
  id: string;
  /** 段落开始/结束的仿真时刻（秒） */
  startTime: number;
  endTime: number;
  conditions: MillConditions;
  output: FlourOutput;
  /** 打包后封账：后续产出另起新段，保证每段时长与贡献严格对应 */
  sealed?: boolean;
}

/** 打包时冻结进批次记录的历史依据 */
export interface SegmentEvidence extends MillConditions {
  segmentId: string;
  /** 该段持续时长，秒 */
  duration: number;
  /** 该段三种粉的实际产出 */
  output: FlourOutput;
  /** 该段对本袋品类的贡献重量，斤 */
  typeWeight: number;
}

export interface Batch {
  /** 确定性编号，连续打包不会互相覆盖 */
  id: string;
  /** 打包顺序号 */
  seq: number;
  type: FlourType;
  /** 袋重，斤（按 0.1 斤结算） */
  weight: number;
  /** 打包时刻（注入时钟，毫秒时间戳） */
  packedAt: number;
  /** 这一袋产出期间各工况段落的历史依据 */
  evidence: SegmentEvidence[];
}

export interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  life: number;
}

export interface AnimatingBag {
  /** 与 Batch.id 完全一致，保证动画袋与批次记录一一对应 */
  id: string;
  type: FlourType;
  weight: number;
}

export type MillAction =
  | { type: 'SET_VALVE'; payload: number }
  | { type: 'SET_GAP'; payload: number }
  | { type: 'TICK'; payload: number }
  | { type: 'PACK'; payload: FlourType }
  | { type: 'LOAD_BATCHES'; payload: Batch[] }
  | { type: 'REMOVE_BAG_ANIMATION'; payload: string };
