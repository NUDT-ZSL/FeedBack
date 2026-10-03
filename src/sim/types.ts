import type { DecorationType } from './DecorationManager';

/** 模拟配置：同一份 config + inputs 必须产生完全一致的轨迹 */
export interface SimConfig {
  seed: number;
  width: number;
  height: number;
  initialFish: number;
}

/** 可被记录和重放的输入事件（不依赖真实鼠标/网络） */
export type InputEvent =
  | { type: 'addFood'; x: number; y: number }
  | { type: 'addDecoration'; decoration: DecorationType; x: number; y: number };

/** 带调度信息的输入：step 决定生效的时间步，seq 保证同一步内多个输入的顺序稳定 */
export interface ScheduledInput {
  step: number;
  seq: number;
  event: InputEvent;
}

/** 模拟过程中产生的可观测事件（按发生顺序记录） */
export type SimEvent =
  | { type: 'foodAdded'; foodIds: number[]; x: number; y: number }
  | { type: 'foodEaten'; foodId: number; fishId: number }
  | { type: 'foodRemoved'; foodId: number; reason: 'expired' | 'sank' }
  | { type: 'decorationPlaced'; id: number; decoration: DecorationType; x: number; y: number; clamped: boolean }
  | { type: 'breed'; babyId: number; parent1Id: number; parent2Id: number; x: number; y: number }
  | { type: 'breedBlocked'; parent1Id: number; parent2Id: number; reason: 'maxFishReached' | 'parentUnavailable' };

/** 单个时间步结束后的关键状态快照 */
export interface StepSnapshot {
  step: number;
  time: number;
  fishCount: number;
  foodCount: number;
  decorationCount: number;
  fishes: Array<{ id: number; x: number; y: number; state: string }>;
  foods: Array<{ id: number; x: number; y: number }>;
  /** 本步内发生的全部事件（输入事件 + 模拟事件），顺序即发生顺序 */
  events: SimEvent[];
}

/** 一条完整轨迹：配置 + 输入序列 + 每步快照，可离线回放与比较 */
export interface Trajectory {
  version: 1;
  config: SimConfig;
  stepDt: number;
  inputs: ScheduledInput[];
  steps: StepSnapshot[];
}
