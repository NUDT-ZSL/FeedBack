/**
 * 司膳官宴席编排 —— 核心领域类型。
 * 本文件不依赖任何 DOM / React，可在 Node 中离线运行与自测。
 */

/** 宾客身份等级：1 最低，5 最高 */
export type Rank = 1 | 2 | 3 | 4 | 5;

export interface Guest {
  id: string;
  name: string;
  /** 忌口标签（与菜品标签对应，如「花生」「牛羊肉」） */
  dietary: string[];
  /** 身份等级 1-5 */
  rank: Rank;
  /** 随行人数（不含主宾本人），随行人员必须与主宾同桌 */
  entourage: number;
}

export interface Dish {
  id: string;
  name: string;
  /** 菜品标签，用于与宾客忌口比对 */
  tags: string[];
}

export interface BanquetTable {
  id: string;
  name: string;
  /** 桌容量上限（按人头计，含随行） */
  capacity: number;
  /** 是否主桌 */
  isMain: boolean;
  /** 主桌身份等级门槛：仅当 isMain 时生效 */
  minRank: Rank;
  /** 该桌安排的菜品 */
  dishIds: string[];
}

/** 不宜同桌约束（双向生效） */
export interface AvoidConstraint {
  id: string;
  a: string;
  b: string;
  /** 备注，便于追溯 */
  note?: string;
}

export interface SeatingAssignment {
  guestId: string;
  tableId: string;
}

export type ArrangementStatus = 'arranged' | 'unarrangeable' | 'empty';

/** 一条可追溯的编排说明 */
export interface TraceEntry {
  seq: number;
  kind:
    | 'change'
    | 'evict'
    | 'keep'
    | 'place'
    | 'unplaceable'
    | 'conflict'
    | 'parity'
    | 'status'
    | 'info';
  message: string;
}

/** 约束冲突报告（全部保留，不静默择一） */
export interface ConflictReport {
  /** 是否因约束相互矛盾而不可满足 */
  unsatisfiable: boolean;
  /** 构成不可满足的最小核心（人类可读，逐条可追溯） */
  core: string[];
  /** 检测到的不宜同桌约束环（如 甲-乙-丙-甲） */
  cycles: string[][];
  /** 补充说明 */
  notes: string[];
}

export interface Arrangement {
  status: ArrangementStatus;
  assignments: SeatingAssignment[];
  /** 座次是否已被司膳官确认（确认的座次不会被无关改动冲掉） */
  confirmed: boolean;
  /** 编排时间戳 */
  arrangedAt: number | null;
  /** 本次编排的可追溯说明 */
  trace: TraceEntry[];
  /** 约束冲突报告 */
  conflicts: ConflictReport | null;
  /** 本次编排涉及的桌次（增量重推时的受影响范围） */
  affectedTableIds: string[];
}

/** 不可编排时归档的上一次有效座次（不残留为当前座次） */
export interface ArchivedArrangement {
  archivedAt: number;
  assignments: SeatingAssignment[];
  confirmed: boolean;
}

export interface Banquet {
  id: string;
  name: string;
  createdAt: number;
  guests: Guest[];
  tables: BanquetTable[];
  dishes: Dish[];
  constraints: AvoidConstraint[];
  arrangement: Arrangement;
  /** 最近一次因不可编排/清空而归档的座次快照 */
  lastArchived: ArchivedArrangement | null;
}

export interface Workspace {
  version: 1;
  banquets: Banquet[];
  activeBanquetId: string | null;
}

/** 引起增量重推的变更描述 */
export type ChangeEvent =
  | { type: 'guest-added'; guestId: string }
  | { type: 'guest-removed'; guestId: string }
  | { type: 'guest-dietary-changed'; guestId: string }
  | { type: 'guest-rank-changed'; guestId: string }
  | { type: 'guest-entourage-changed'; guestId: string }
  | { type: 'constraint-added'; constraintId: string }
  | { type: 'constraint-removed'; constraintId: string }
  | { type: 'table-capacity-changed'; tableId: string }
  | { type: 'table-rank-changed'; tableId: string }
  | { type: 'table-dishes-changed'; tableId: string }
  | { type: 'table-added'; tableId: string }
  | { type: 'table-removed'; tableId: string }
  | { type: 'dish-tags-changed'; dishId: string };

/** 校验问题 */
export interface ValidationIssue {
  kind:
    | 'duplicate-seating'
    | 'capacity-exceeded'
    | 'rank-violation'
    | 'dietary-violation'
    | 'avoid-violation'
    | 'entourage-split'
    | 'unknown-guest'
    | 'unseated-guest';
  message: string;
}

export const emptyArrangement = (): Arrangement => ({
  status: 'empty',
  assignments: [],
  confirmed: false,
  arrangedAt: null,
  trace: [],
  conflicts: null,
  affectedTableIds: [],
});
