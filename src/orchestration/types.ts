/**
 * 编排领域类型定义。
 *
 * 模型分层：
 * - 共享池（跨场次）：Participant / ResourceItem，全局唯一，改动会传播到引用它的场次。
 * - 场次私有：Session / TimeSlot / BookingRequest，场次之间互不共享、互不污染。
 * - 编排产物：Assignment / Rejection / SessionConflict / SessionResult，按场次各自持有。
 */

/** 共享池：参与者 */
export interface Participant {
  id: string;
  name: string;
  roles: string[];
}

/** 共享池：资源项 */
export interface ResourceItem {
  id: string;
  name: string;
  /** 资源类型，编排请求可用 requiredKind 施加属性约束 */
  kind: string;
  /** 同一时段轴上允许的最大并发占用数 */
  capacity: number;
}

/** 场次 */
export interface Session {
  id: string;
  name: string;
}

/** 场次内时段（数值化时间轴，仅用于重叠判定与排序） */
export interface TimeSlot {
  id: string;
  sessionId: string;
  start: number;
  end: number;
  label?: string;
}

/** 编排请求（输入）：把某参与者与某资源项分配到某时段 */
export interface BookingRequest {
  id: string;
  sessionId: string;
  participantId: string;
  resourceId: string;
  slotId: string;
  /** 排序权重，数值小者排前 */
  priority: number;
  /** 属性约束：要求资源项 kind 与之匹配，否则请求被拒 */
  requiredKind?: string;
}

export type RejectionReason =
  | 'unknown-slot'
  | 'unknown-participant'
  | 'unknown-resource'
  | 'kind-mismatch';

/** 被拒绝的请求（含失效引用），不会以失效形式保留在编排结果里 */
export interface Rejection {
  requestId: string;
  sessionId: string;
  reason: RejectionReason;
  detail: string;
}

/** 编排产物：一条已落位的分配 */
export interface Assignment {
  id: string;
  requestId: string;
  sessionId: string;
  participantId: string;
  resourceId: string;
  slotId: string;
  /** 场次内排序序号，从 0 开始 */
  order: number;
}

export type ConflictType = 'resource-overlap' | 'participant-overlap';

/** 场次内冲突 */
export interface SessionConflict {
  id: string;
  type: ConflictType;
  sessionId: string;
  /** 冲突实体：资源项 id（resource-overlap）或参与者 id（participant-overlap） */
  entityId: string;
  assignmentIds: string[];
  slotIds: string[];
}

/** 跨场次资源占用冲突，按场次归属分别呈现 */
export interface CrossSessionConflict {
  id: string;
  resourceId: string;
  /** 归属场次：该条记录呈现在哪个场次名下 */
  attributedTo: string;
  /** 共同参与占用的全部场次 */
  sessionIds: string[];
  /** 重叠区间 */
  interval: { start: number; end: number };
  assignments: Array<{ sessionId: string; assignmentId: string; slotId: string }>;
}

/** 单场编排结果 */
export interface SessionResult {
  sessionId: string;
  assignments: Assignment[];
  rejections: Rejection[];
  conflicts: SessionConflict[];
  /** 结果摘要哈希，用于一致性比对 */
  digest: string;
}
