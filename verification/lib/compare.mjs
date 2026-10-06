/** 结构化比较：规范化（键排序）+ 带浮点容差的递归差异定位。 */

export const FLOAT_TOLERANCE = 1e-6;

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

/**
 * 递归比较 expected 与 actual，返回差异列表 [{path, expected, actual}]。
 * 数值比较使用容差，其余严格相等。
 */
export function diffValues(expected, actual, basePath = '$', diffs = []) {
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (Math.abs(expected - actual) > FLOAT_TOLERANCE) {
      diffs.push({ path: basePath, expected, actual });
    }
    return diffs;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) {
      diffs.push({ path: `${basePath}.length`, expected: expected.length, actual: actual.length });
    }
    for (let i = 0; i < Math.min(expected.length, actual.length); i += 1) {
      diffValues(expected[i], actual[i], `${basePath}[${i}]`, diffs);
    }
    return diffs;
  }
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of [...keys].sort()) {
      if (!(key in expected)) diffs.push({ path: `${basePath}.${key}`, expected: '<missing>', actual: actual[key] });
      else if (!(key in actual)) diffs.push({ path: `${basePath}.${key}`, expected: expected[key], actual: '<missing>' });
      else diffValues(expected[key], actual[key], `${basePath}.${key}`, diffs);
    }
    return diffs;
  }
  if (expected !== actual) diffs.push({ path: basePath, expected, actual });
  return diffs;
}

export function formatDiffs(diffs, limit = 20) {
  const lines = diffs.slice(0, limit).map((d) => {
    const fmt = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
    return `    ${d.path}: expected=${fmt(d.expected)} actual=${fmt(d.actual)}`;
  });
  if (diffs.length > limit) lines.push(`    ... and ${diffs.length - limit} more differences`);
  return lines;
}
