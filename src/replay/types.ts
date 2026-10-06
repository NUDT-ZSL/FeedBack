/** 空间记录：某一时刻对某个对象状态的一次观测/写入。 */
export interface SpatialRecord {
  id: string;
  objectId: string;
  /** 逻辑时间戳（tick），回放按 (at, id) 规范化排序，与导入顺序无关。 */
  at: number;
  key: string;
  value: number | string;
  /** 记录修正：指向被本记录取代的旧记录 id。 */
  corrects?: string;
}

/** 关键事件：带有影响时间窗与事件间依赖。 */
export interface KeyEvent {
  id: string;
  objectId: string;
  at: number;
  /** 影响时间区间 [start, end]（闭区间）。 */
  window: [number, number];
  /** 依赖的其他事件 id。 */
  dependsOn: string[];
}

/** 裁决：对一组矛盾记录指定保留哪一条（双方都保留在输入中）。 */
export interface Adjudication {
  conflictId: string;
  winnerRecordId: string;
  reason: string;
}

export type Anomaly =
  | { type: 'missing-dependency'; eventId: string; missingEventId: string }
  | { type: 'dependency-cycle'; eventIds: string[] }
  | { type: 'unresolved-conflict'; conflictId: string; candidateRecordIds: string[]; fallbackRecordId: string }
  | { type: 'correction-target-missing'; recordId: string; missingRecordId: string };

/** 对象某状态键的最终生效值及其来源记录（判定依据可追溯）。 */
export interface ObjectStateEntry {
  value: number | string;
  recordId: string;
}

export interface EventImpact {
  objectId: string;
  window: [number, number];
  /** 时间窗内该对象实际发生变化的状态键。 */
  touchedKeys: string[];
  /** 沿事件依赖闭包可达的全部对象。 */
  reachableObjects: string[];
}

/** 回放判定结论：可规范化序列化、可哈希比较。 */
export interface ReplayVerdict {
  objectStates: Record<string, Record<string, ObjectStateEntry>>;
  eventImpacts: Record<string, EventImpact>;
  anomalies: Anomaly[];
}

export interface Dataset {
  records: SpatialRecord[];
  events: KeyEvent[];
  adjudications: Adjudication[];
}

/** 受影响范围：一组对象 + 一个时间区间。 */
export interface Scope {
  objectIds: string[];
  timeRange: [number, number];
}
