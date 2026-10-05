/**
 * 浑仪拆装步骤状态机 —— 纯数据类型定义。
 * 本目录（src/assembly）不依赖 React / Three.js，可离线独立推演。
 */

export type PartId = string;

/** 部件在浑仪上的物理状态：在位（已装）或已拆下 */
export type PartStatus = 'installed' | 'detached';

export type OpKind = 'detach' | 'attach';

export interface Operation {
  kind: OpKind;
  part: PartId;
}

/** 部件静态配置：detachAfter 列出必须先于本部件拆下的外层部件 */
export interface PartConfig {
  id: PartId;
  name: string;
  layer: string;
  detachAfter: PartId[];
}

export interface AssemblyConfig {
  parts: PartConfig[];
}

/** 受阻原因：始终给出明确口径，绝不静默跳过 */
export type BlockedReason =
  | { kind: 'unmet-dependencies'; pending: PartId[] }
  | { kind: 'missing-dependency'; missing: PartId[] }
  | { kind: 'dependency-cycle'; cycle: PartId[] };

/** 单个部件当前可执行的下一步 */
export type StepState =
  | { status: 'detachable' }
  | { status: 'attachable' }
  | { status: 'blocked'; reason: BlockedReason };

export interface PartDerivation {
  part: PartId;
  installed: boolean;
  step: StepState;
}

export type ProgressPhase = 'assembled' | 'disassembling' | 'disassembled';

/** 进度结论：只由 (配置, 各部件在位状态) 决定，与操作历史无关 */
export interface ProgressConclusion {
  total: number;
  installedCount: number;
  detachedCount: number;
  /** 已拆下部件占比 0-100 */
  percent: number;
  phase: ProgressPhase;
  /** 因依赖成环 / 依赖缺失而不可达的部件及原因 */
  unreachable: { part: PartId; reason: BlockedReason }[];
}

export interface Derivation {
  parts: Record<PartId, PartDerivation>;
  conclusion: ProgressConclusion;
}

/** 操作结果：applied / invalid（重复或未知部件，不改变状态）/ blocked（依赖未满足） */
export type OpOutcome =
  | { result: 'applied'; affected: PartId[] }
  | { result: 'invalid'; reason: 'duplicate-detach' | 'duplicate-attach' | 'unknown-part' }
  | { result: 'blocked'; reason: BlockedReason };

/** 一次拆装会话：配置 + 各部件在位状态 + 缓存的推导结果 */
export interface Session {
  config: AssemblyConfig;
  installed: Record<PartId, boolean>;
  installedCount: number;
  derivation: Derivation;
}
