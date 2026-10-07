/**
 * 陶器碎片拼合链路的纯类型定义。
 *
 * 该文件不依赖 three.js / React / DOM，几何量全部使用可序列化的纯数值
 * 结构，使拼合判定、进度推进、完成态结算都能在 Node 离线环境中被复现
 * 和验证。scene.ts 等渲染层在边界处负责与 THREE.Vector3 / THREE.Euler
 * 互相转换，拼合结论只认本文件中的类型。
 */

/** 三维向量或欧拉角（分量均为弧度时表示角度）。 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 碎片在拼合链路中的状态。 */
export const FragmentState = {
  Floating: 'floating',
  Dragging: 'dragging',
  Placed: 'placed',
} as const;

export type FragmentState = (typeof FragmentState)[keyof typeof FragmentState];

/**
 * 碎片集合中单个碎片的静态定义（即“碎片几何 + 拼合依赖”）。
 * dependsOn 表示该碎片必须在哪些碎片拼合成功之后才允许吸附。
 */
export interface FragmentSpec {
  id: string;
  targetPosition: Vec3;
  targetRotation: Vec3;
  dependsOn: string[];
}

/**
 * 拼合操作序列中的单步操作：
 * - drag：把碎片拖到某个位姿（只更新暂存位姿，不产生拼合结论）
 * - submit：按当前暂存位姿发起一次拼合判定
 * - place：drag + submit 的组合入口（批量/非交互入口使用）
 */
export type PuzzleOperation =
  | { type: 'drag'; fragmentId: string; position: Vec3; rotation: Vec3 }
  | { type: 'submit'; fragmentId: string }
  | { type: 'place'; fragmentId: string; position: Vec3; rotation: Vec3 };

/** 单次拼合提交被拒绝的原因。 */
export type RejectionReason =
  | 'unknown-fragment'
  | 'not-dragging'
  | 'duplicate-placement'
  | 'dependency-unmet'
  | 'pose-out-of-tolerance'
  | 'session-distorted';

/** 碎片集合层面的结构性失真原因。 */
export type DistortionReason =
 | 'empty-fragment-set'
 | 'duplicate-fragment-id'
 | 'missing-dependency'
 | 'dependency-cycle';

/** 集合结构校验发现的一处失真。 */
export interface DistortionFinding {
  reason: DistortionReason;
  fragmentId?: string;
  detail: string;
}

/**
 * 操作序列推进过程中可观察到的事件。验证器只依赖这些事件与快照，
 * 不依赖任何渲染层状态。
 */
export type PuzzleEvent =
  | {
      type: 'snapped';
      fragmentId: string;
      placedCount: number;
      total: number;
      distance: number;
      angleDiff: number;
    }
  | {
      type: 'rejected';
      fragmentId: string;
      reason: RejectionReason;
      detail: string;
      pendingDependencies: string[];
      placedCount: number;
      total: number;
    }
  | { type: 'completed'; placedCount: number; total: number }
  | { type: 'distorted'; findings: DistortionFinding[] };

/** 某次复现结束后可观察的完整拼合结论与进度轨迹。 */
export interface SessionSnapshot {
  status: 'in-progress' | 'completed' | 'distorted';
  total: number;
  placedCount: number;
  placed: string[];
  /** 每次成功拼合后记录的已拼合数量，例如 [1, 2, 3]。 */
  progressTrajectory: number[];
  events: PuzzleEvent[];
  distortions: DistortionFinding[];
}

/** 一次吸附判定的可观察结果。 */
export interface SnapConditionResult {
  shouldSnap: boolean;
  distance: number;
  angleDiff: number;
}
