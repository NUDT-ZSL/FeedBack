/**
 * 确定性工具：规范化序列化、内容指纹、稳定比较。
 * 判定链路的所有结论对比都基于这些原语，保证与导入顺序、批次切分无关。
 */

/** 递归按键名排序后的稳定 JSON 序列化（undefined 会被剔除，与 JSON 语义一致）。 */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value === undefined ? null : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  const body = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',');
  return `{${body}}`;
}

/** FNV-1a 32 位内容指纹，输出 8 位十六进制，纯函数、无外部依赖。 */
export function contentHash(value) {
  const text = typeof value === 'string' ? value : stableStringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** 深度相等：基于规范化序列化，键序无关。 */
export function deepEqual(a, b) {
  return stableStringify(a) === stableStringify(b);
}

/** 深拷贝（仅支持 JSON 可表达的数据）。 */
export function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** 字典序比较器。 */
export function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 区间并集；end 允许为 null 表示开口区间。区间均为 [start, end] 闭区间。 */
export function mergeIntervals(intervals) {
  const sorted = intervals
    .filter((it) => it && it.start !== undefined && it.start !== null)
    .map((it) => ({ start: it.start, end: it.end === undefined ? null : it.end }))
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const it of sorted) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...it });
      continue;
    }
    const lastOpen = last.end === null;
    const overlaps = lastOpen || it.start <= last.end + 1 || it.start <= last.end;
    if (overlaps) {
      if (lastOpen || it.end === null) {
        last.end = null;
      } else if (it.end > last.end) {
        last.end = it.end;
      }
    } else {
      merged.push({ ...it });
    }
  }
  return merged;
}

/** 确定性伪随机（mulberry32），用于导入顺序打乱的可复现验证。 */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 使用给定种子对数组做确定性 Fisher-Yates 打乱，返回新数组。 */
export function seededShuffle(items, seed) {
  const rand = mulberry32(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
