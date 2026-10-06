import type { ReplayVerdict } from './types.ts';

/** 稳定序列化：对象键排序，保证同一结论得到字节一致的文本。 */
export function stableStringify(value: unknown, indent = 0): string {
  const pad = indent > 0 ? '  ' : '';
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number): string => {
    if (v === null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') {
      return JSON.stringify(v);
    }
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]';
      const items = v.map((item) => walk(item, depth + 1));
      if (indent === 0) return `[${items.join(',')}]`;
      const inner = items.map((s) => pad.repeat(depth + 1) + s).join(',\n');
      return `[\n${inner}\n${pad.repeat(depth)}]`;
    }
    if (typeof v === 'object') {
      if (seen.has(v)) throw new Error('stableStringify: cyclic value');
      seen.add(v);
      const entries = Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => {
          const key = indent === 0 ? JSON.stringify(k) : `${pad.repeat(depth + 1)}${JSON.stringify(k)}`;
          return `${key}: ${walk((v as Record<string, unknown>)[k], depth + 1)}`;
        });
      seen.delete(v);
      if (entries.length === 0) return '{}';
      return indent === 0 ? `{${entries.join(',')}}` : `{\n${entries.join(',\n')}\n${pad.repeat(depth)}}`;
    }
    throw new Error(`stableStringify: unsupported value ${String(v)}`);
  };
  return walk(value, 0);
}

/** 规范化判定结论：所有集合类字段排序，使结论可逐字节比较。 */
export function canonicalizeVerdict(verdict: ReplayVerdict): ReplayVerdict {
  const sortRecord = <T>(rec: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.keys(rec).sort().map((k) => [k, rec[k]]));
  return {
    objectStates: sortRecord(
      Object.fromEntries(
        Object.entries(verdict.objectStates).map(([obj, keys]) => [obj, sortRecord(keys)]),
      ),
    ),
    eventImpacts: sortRecord(
      Object.fromEntries(
        Object.entries(verdict.eventImpacts).map(([id, impact]) => [
          id,
          {
            ...impact,
            touchedKeys: [...impact.touchedKeys].sort(),
            reachableObjects: [...impact.reachableObjects].sort(),
          },
        ]),
      ),
    ),
    anomalies: [...verdict.anomalies].sort((a, b) => {
      const sa = stableStringify(a);
      const sb = stableStringify(b);
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    }),
  };
}
