/**
 * 收藏原始记录：用户操作落库的唯一事实来源（source of truth）。
 * 这里刻意保留未经清洗的宽松类型——任何越界/缺失取值都会进入裁决器，
 * 而不是在写入时被静默吞掉。
 */
export interface RawSeal {
  id?: unknown;
  shape?: unknown;
  character?: unknown;
  color?: unknown;
  rotation?: unknown;
  position?: { x?: unknown; y?: unknown } | unknown;
}

export interface RawCollectionEntry {
  scrollId?: unknown;
  colophon?: unknown;
  seal?: RawSeal | null;
  collectedAt?: unknown;
  order?: unknown;
}

export interface RawCollectionState {
  entries: RawCollectionEntry[];
}

export type IssueCode =
  | 'entry.unknown-scroll'
  | 'entry.duplicate-scroll'
  | 'entry.colophon-not-string'
  | 'entry.colophon-too-long'
  | 'entry.collected-at-not-number'
  | 'entry.collected-at-negative'
  | 'entry.order-not-number'
  | 'entry.order-negative'
  | 'entry.order-not-integer'
  | 'entry.order-conflict'
  | 'seal.missing'
  | 'seal.shape-unknown'
  | 'seal.color-unknown'
  | 'seal.character-mismatch'
  | 'seal.rotation-not-number'
  | 'seal.rotation-below-range'
  | 'seal.rotation-above-range'
  | 'seal.position-x-missing'
  | 'seal.position-y-missing'
  | 'seal.position-x-not-number'
  | 'seal.position-y-not-number'
  | 'seal.position-x-below-range'
  | 'seal.position-x-above-range'
  | 'seal.position-y-below-range'
  | 'seal.position-y-above-range'
  | 'seal.id-not-string'
  | 'seal.unknown-field';

export type IssueSeverity = 'reject' | 'clamp' | 'fallback' | 'info';

/** 可追溯裁决依据：每个被发现的问题都记录取值、裁决动作与归一化结果 */
export interface AdjudicationIssue {
  code: IssueCode;
  severity: IssueSeverity;
  path: string;
  received: unknown;
  resolution: string;
}

/** 数值越界裁决：记录原值、边界与归一化后的值 */
export interface ClampNote {
  path: string;
  received: unknown;
  min: number;
  max: number;
  clamped: number;
}

export interface SealVerdict {
  accepted: boolean;
  seal: {
    id: string;
    shape: string;
    character: string;
    color: string;
    rotation: number;
    position: { x: number; y: number };
  } | null;
  issues: AdjudicationIssue[];
}

export interface EntryVerdict {
  index: number;
  scrollId: string | null;
  accepted: boolean;
  /** 归一化后的条目；accepted 为 false 时为 null */
  normalized: {
    scrollId: string;
    colophon: string;
    seal: SealVerdict;
    collectedAt: number;
    order: number | null;
  } | null;
  issues: AdjudicationIssue[];
}

export interface DerivationReport {
  issues: AdjudicationIssue[];
  /** 被重新归一化位置的 scrollId（顺序冲突解决后） */
  orderReassigned: string[];
}
