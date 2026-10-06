export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const item = source[key];
      if (item !== undefined) {
        sorted[key] = sortValue(item);
      }
    }
    return sorted;
  }
  return value;
}

export function digest(value: unknown): string {
  const text = canonicalize(value);
  let high = 0x811c9dc5;
  let low = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    low = Math.imul(low ^ (code & 0xff), 0x01000193);
    high = Math.imul(high ^ (code >> 8), 0x01000193);
  }
  return (
    (high >>> 0).toString(16).padStart(8, "0") +
    (low >>> 0).toString(16).padStart(8, "0")
  );
}

export function diffPaths(a: unknown, b: unknown, prefix = "", limit = 20): string[] {
  const paths: string[] = [];
  const walk = (left: unknown, right: unknown, path: string): void => {
    if (paths.length >= limit) {
      return;
    }
    if (JSON.stringify(sortValue(left)) === JSON.stringify(sortValue(right))) {
      return;
    }
    const leftIsObject = left !== null && typeof left === "object";
    const rightIsObject = right !== null && typeof right === "object";
    if (!leftIsObject || !rightIsObject) {
      paths.push(path || "(root)");
      return;
    }
    if (Array.isArray(left) !== Array.isArray(right)) {
      paths.push(path || "(root)");
      return;
    }
    if (Array.isArray(left) && Array.isArray(right)) {
      const length = Math.max(left.length, right.length);
      for (let index = 0; index < length; index += 1) {
        walk(left[index], right[index], `${path}[${index}]`);
      }
      return;
    }
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);
    for (const key of [...keys].sort()) {
      walk(leftRecord[key], rightRecord[key], path ? `${path}.${key}` : key);
    }
  };
  walk(a, b, prefix);
  return paths;
}
