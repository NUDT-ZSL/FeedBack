import type { Scroll, Seal } from '../types/index.ts';

/** 用户侧提交的原始印章数据，任何字段都可能越界或缺失。 */
export interface RawSeal {
  shape?: unknown;
  character?: unknown;
  color?: unknown;
  rotation?: unknown;
  position?: { x?: unknown; y?: unknown } | unknown;
}

/** 单条收藏的原始记录：收藏域唯一的事实来源。 */
export interface RawCollectionRecord {
  scrollId: string;
  colophon?: unknown;
  seal?: RawSeal | null;
  /** 用户期望的顺序位，允许重复或越界，由推导层统一裁决。 */
  requestedOrder?: number;
  collectedAt: number;
}

export type AdjudicationKind =
  | 'scroll-not-found'
  | 'seal-shape-invalid'
  | 'seal-color-invalid'
  | 'seal-character-invalid'
  | 'seal-rotation-clamped'
  | 'seal-position-clamped'
  | 'seal-rejected'
  | 'colophon-truncated'
  | 'order-conflict'
  | 'order-normalized';

/** 每条越界/缺失取值都留下一条可追溯裁决，不静默吞掉。 */
export interface AdjudicationRecord {
  id: string;
  scrollId: string;
  kind: AdjudicationKind;
  field: string;
  input: unknown;
  decision: string;
  output: unknown;
  reason: string;
  at: number;
}

/** 单条收藏经推导后的结果（顺序为最终裁决值）。 */
export interface DerivedCollectionItem {
  scrollId: string;
  scroll: Scroll;
  colophon: string;
  seal: Seal | null;
  collectedAt: number;
  order: number;
}

export interface DerivedCollectionState {
  items: DerivedCollectionItem[];
  adjudications: AdjudicationRecord[];
}

export type CollectionChange =
  | { kind: 'collect'; record: RawCollectionRecord }
  | { kind: 'update'; scrollId: string; patch: Partial<RawCollectionRecord> }
  | { kind: 'remove'; scrollId: string }
  | { kind: 'move'; scrollId: string; requestedOrder: number };

export interface DerivationReport {
  affectedScrollIds: string[];
  adjudications: AdjudicationRecord[];
  state: DerivedCollectionState;
}
