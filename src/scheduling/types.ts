/**
 * 排产推演领域模型（纯数据，无 IO、无外部服务依赖）。
 *
 * 时间一律使用整数刻度；能耗代价 = 工序时长 × 设备能耗率，取整。
 */

export interface TimeWindow {
  start: number;
  end: number;
}

export interface Device {
  id: string;
  /** 设备可执行的工序能力集合 */
  capabilities: string[];
  /** 设备可用时段（并集，允许重叠，内部会规范化） */
  windows: TimeWindow[];
  /** 单位时间能耗率 */
  energyRate: number;
}

export interface Operation {
  id: string;
  /** 所需设备能力 */
  capability: string;
  /** 加工时长（整数刻度） */
  duration: number;
  /** 前置工序 id 列表 */
  deps: string[];
}

export interface SchedulingInput {
  devices: Device[];
  operations: Operation[];
}

export interface Assignment {
  opId: string;
  deviceId: string;
  start: number;
  end: number;
  /** 该工序的能耗代价 */
  cost: number;
}

export interface Plan {
  /** 按工序 id 排序的排布结论 */
  assignments: Assignment[];
  /** 整体能耗代价 */
  totalCost: number;
}

export type ScheduleErrorCode =
  | 'DEPENDENCY_MISSING'
  | 'DEPENDENCY_CYCLE'
  | 'CAPABILITY_UNCOVERED'
  | 'PIN_INVALID'
  | 'UNFEASIBLE';

export interface ScheduleError {
  code: ScheduleErrorCode;
  message: string;
  /** 相关工序/设备 id，便于定位 */
  refs: string[];
}

export type ScheduleResult =
  | { ok: true; plan: Plan }
  | { ok: false; error: ScheduleError };

/** 冲突来源保留裁决：显式钉住的工序排布，重推时不得改动 */
export interface Pin {
  opId: string;
  deviceId: string;
  start: number;
}

export type SchedulingChange =
  | { kind: 'device-windows'; deviceId: string; windows: TimeWindow[] }
  | { kind: 'device-energy-rate'; deviceId: string; energyRate: number }
  | { kind: 'device-capabilities'; deviceId: string; capabilities: string[] };

export interface PartialRescheduleOptions {
  /** 局部调整内容 */
  change: SchedulingChange;
  /** 冲突来源保留：这些工序的排布在重推中保持不动 */
  pins?: Pin[];
}

export type PartialRescheduleResult =
  | {
      ok: true;
      plan: Plan;
      /** 本次实际重推的工序集合（升序） */
      affected: string[];
    }
  | { ok: false; error: ScheduleError };
