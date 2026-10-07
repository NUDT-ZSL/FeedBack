// Tiny offline test harness: collects cases, runs sequentially, reports pass/fail.
const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

export function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

export function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'values differ'}: expected ${fmt(expected)}, got ${fmt(actual)}`);
  }
}

export function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`${message || 'values differ'}: expected ${b}, got ${a}`);
  }
}

export function assertFinite(value, message) {
  assert(typeof value === 'number' && Number.isFinite(value),
    `${message || 'expected finite number'}, got ${fmt(value)}`);
}

export function assertNotThrows(fn, message) {
  try {
    fn();
  } catch (err) {
    throw new Error(`${message || 'unexpected throw'}: ${err && err.message}`);
  }
}

function fmt(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.slice(0, 8).map(fmt).join(',')}${value.length > 8 ? ',…' : ''}]`;
  return String(value);
}

export async function run() {
  let passed = 0;
  const failures = [];
  for (const { name, fn } of tests) {
    try {
      await fn();
      passed += 1;
      console.log(`  PASS  ${name}`);
    } catch (err) {
      failures.push({ name, err });
      console.log(`  FAIL  ${name}`);
      console.log(`        ${err && err.message ? err.message : err}`);
    }
  }
  console.log('');
  console.log(`结果: ${passed}/${tests.length} 通过, ${failures.length} 失败`);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}
