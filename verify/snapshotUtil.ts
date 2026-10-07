import { TickSnapshot } from '../src/sim/types';

/** 快照规范化序列化：键顺序由引擎统一构造，可直接用于逐位一致性比对 */
export function digest(snapshot: TickSnapshot): string {
  return JSON.stringify(snapshot);
}

export function sortedIds(ids: string[]): string[] {
  return [...ids].sort();
}

export function setsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = sortedIds(a);
  const sb = sortedIds(b);
  return sa.every((id, i) => id === sb[i]);
}
