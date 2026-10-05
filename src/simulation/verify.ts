/**
 * 结果等价性校验与稳定序列化。
 * 用于验证：增量重算 ≡ 整体重算；同一输入重复推演 ≡ 稳定输出。
 */
import type { ComparableResult, SimulationResult } from './types.ts';

/** 剔除溯源元信息后的可比较内容 */
export function comparableOf(result: SimulationResult): ComparableResult {
  const { meta: _meta, ...rest } = result;
  return rest;
}

/** 键序稳定的 JSON 序列化，保证同一结果得到同一字符串 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const body = keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',');
  return `{${body}}`;
}

/** FNV-1a 32 位哈希，纯本地计算，便于跨次运行比对 */
export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** 推演结果（可比较内容）的稳定指纹 */
export function resultFingerprint(result: SimulationResult): string {
  return hashString(stableStringify(comparableOf(result)));
}

/** 判断两次推演的可比较内容是否完全一致 */
export function resultsEqual(a: SimulationResult, b: SimulationResult): boolean {
  return stableStringify(comparableOf(a)) === stableStringify(comparableOf(b));
}
