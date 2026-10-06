/**
 * 规范化（canonical）工具：把回放结论转成与导入顺序、批次切分、
 * 内存插入顺序无关的稳定 JSON，用于判定两份结论是否一致。
 */

function stableSortKey(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map(stableSortKey).join(',') + ']';
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return '{' + Object.keys(obj)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + stableSortKey(obj[key]))
      .join(',') + '}';
  }
  return JSON.stringify(value ?? null);
}

function stabilize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stabilize).sort((a, b) => stableSortKey(a) < stableSortKey(b) ? -1 : 1);
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = stabilize(obj[key]);
    }
    return out;
  }
  return value;
}

/** 规范化 JSON 字符串：键排序 + 数组按规范顺序排序。 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(stabilize(value));
}

/** 两份结论（或任意可 JSON 化结构）是否完全一致。 */
export function equalConclusions(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** 定位两份结论之间第一个不一致的类别（用于失败归因）。 */
export function diffConclusion(a: any, b: any): string | null {
  for (const section of ['anomalies', 'timelines', 'conflicts', 'eventImpacts']) {
    if (canonicalJson(a?.[section]) !== canonicalJson(b?.[section])) {
      return section;
    }
  }
  return null;
}
