/** FNV-1a 32 位字符串哈希：同一输入永远得到同一无符号整数。 */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 键序稳定的 JSON 序列化，保证同一逻辑对象得到同一字符串。 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) as string;
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const body = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',');
  return `{${body}}`;
}

/** 对任意可序列化对象计算确定性哈希（8 位十六进制字符串）。 */
export function hashObject(value: unknown): string {
  return hashString(stableStringify(value)).toString(16).padStart(8, '0');
}
