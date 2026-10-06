/**
 * 统一裁决规则：所有入口共用同一套比较器与织机选择规则，
 * 裁决结果只取决于输入数据本身，与遍历顺序无关。
 */
import type { Loom, Operation, Order } from './types';

export interface AdjudicationContext {
  ordersById: Map<string, Order>;
  operationsById: Map<string, Operation>;
  /** 订单剩余工时缓存（含未排工序）。 */
  remainingWorkByOrder: Map<string, number>;
}

export const ADJUDICATION_RULES = [
  'R1 订单优先级数值小者优先',
  'R2 订单交期早者优先',
  'R3 订单剩余总工时大者优先',
  'R4 订单号、工序号字典序小者优先（确定性兜底）',
] as const;

export const LOOM_RULES = [
  'L1 可开工时刻最早的候选织机优先',
  'L2 织机号字典序小者优先（确定性兜底）',
] as const;

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 工序竞争比较器：返回负数表示 a 优先。
 * 规则全部打平（仅当双方为同一工序）时返回 0。
 */
export function compareOperations(
  a: Operation,
  b: Operation,
  ctx: AdjudicationContext,
): number {
  const orderA = ctx.ordersById.get(a.orderId);
  const orderB = ctx.ordersById.get(b.orderId);
  if (!orderA || !orderB) {
    return compareStrings(a.id, b.id);
  }
  if (orderA.priority !== orderB.priority) {
    return orderA.priority - orderB.priority;
  }
  const dueA = Date.parse(orderA.dueAt);
  const dueB = Date.parse(orderB.dueAt);
  if (dueA !== dueB) {
    return dueA - dueB;
  }
  const remainA = ctx.remainingWorkByOrder.get(a.orderId) ?? 0;
  const remainB = ctx.remainingWorkByOrder.get(b.orderId) ?? 0;
  if (remainA !== remainB) {
    return remainB - remainA;
  }
  const byOrder = compareStrings(a.orderId, b.orderId);
  if (byOrder !== 0) {
    return byOrder;
  }
  return compareStrings(a.id, b.id);
}

export interface LoomChoice {
  loom: Loom;
  startMinute: number;
}

/**
 * 在候选织机中选择承造机台：先比可开工时刻，再比机台号。
 * availability 为各织机当前空闲时刻（纪元分钟）。
 */
export function chooseLoom(
  operation: Operation,
  readyMinute: number,
  loomsById: Map<string, Loom>,
  availability: Map<string, number>,
  snap: (loom: Loom, minute: number) => number,
): LoomChoice | null {
  let best: LoomChoice | null = null;
  const candidates = [...operation.loomIds].sort();
  for (const loomId of candidates) {
    const loom = loomsById.get(loomId);
    if (!loom) {
      continue;
    }
    const freeAt = availability.get(loomId) ?? readyMinute;
    const startMinute = snap(loom, Math.max(readyMinute, freeAt));
    if (
      !best ||
      startMinute < best.startMinute - 1e-9 ||
      (Math.abs(startMinute - best.startMinute) <= 1e-9 && loom.id < best.loom.id)
    ) {
      best = { loom, startMinute };
    }
  }
  return best;
}
