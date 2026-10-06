import { canonicalize } from '../../analyzer/canonical.js';

const MAX_DIFF_LINES = 40;

function walk(expected, actual, path, lines) {
  if (lines.length >= MAX_DIFF_LINES) return;
  if (Object.is(expected, actual)) return;
  const eObj = expected !== null && typeof expected === 'object';
  const aObj = actual !== null && typeof actual === 'object';
  if (!eObj || !aObj) {
    lines.push(`${path || '<root>'}: expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`);
    return;
  }
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const key of [...keys].sort()) {
    if (!(key in expected)) {
      lines.push(`${path}.${key}: unexpected entry, actual ${JSON.stringify(actual[key])}`);
    } else if (!(key in actual)) {
      lines.push(`${path}.${key}: missing, expected ${JSON.stringify(expected[key])}`);
    } else {
      walk(expected[key], actual[key], path ? `${path}.${key}` : key, lines);
    }
    if (lines.length >= MAX_DIFF_LINES) return;
  }
}

/** 返回差异行数组；空数组表示一致。 */
export function diffValues(expected, actual) {
  const lines = [];
  walk(canonicalize(expected), canonicalize(actual), '', lines);
  if (lines.length >= MAX_DIFF_LINES) lines.push('... (diff truncated)');
  return lines;
}
