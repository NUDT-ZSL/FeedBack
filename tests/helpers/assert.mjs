function fmt(value) {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

export function assert(condition, message) {
  if (!condition) throw new Error(`断言失败: ${message}`);
}

export function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`断言失败: ${message} — 期望 ${fmt(expected)}, 实际 ${fmt(actual)}`);
  }
}

export function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`断言失败: ${message} — 期望 ${b}, 实际 ${a}`);
  }
}
