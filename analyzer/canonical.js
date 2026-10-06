/**
 * 规范化序列化：对象键排序、数值按 1e-6 精度取整。
 * 用于跨导入顺序 / 增量 vs 全量 的结果一致性比较。
 */

export function canonicalize(value) {
  if (typeof value === 'number') {
    return Math.round(value * 1e6) / 1e6;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

export function canonicalString(value) {
  return JSON.stringify(canonicalize(value));
}
