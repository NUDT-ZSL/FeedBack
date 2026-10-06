/**
 * 离线批量验证框架：零依赖、零网络。
 * 每个用例返回 { passed, checks[], details }，失败检查携带
 * category/code 级别的归因，runner 汇总并输出可判定结论。
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';

import { stableStringify, contentHash, deepEqual } from '../src/replay/canonical.js';

export function makeCaseContext(caseMeta) {
  const checks = [];
  const check = (name, fn) => {
    try {
      fn();
      checks.push({ name, passed: true });
    } catch (error) {
      checks.push({ name, passed: false, error: error.message });
    }
  };
  const assertEqual = (name, actual, expected) =>
    check(name, () => {
      if (!deepEqual(actual, expected)) {
        assert.fail(
          `\n  actual:   ${stableStringify(actual)}\n  expected: ${stableStringify(expected)}`,
        );
      }
    });
  const assertTrue = (name, value, extra = '') =>
    check(name, () => assert.ok(value, extra || 'expected truthy'));
  const assertFalse = (name, value, extra = '') =>
    check(name, () => assert.ok(!value, extra || 'expected falsy'));
  const expectThrow = (name, fn, messageIncludes) => {
    let thrown = null;
    try {
      fn();
    } catch (error) {
      thrown = error;
    }
    check(name, () => {
      assert.ok(thrown, 'expected function to throw');
      if (messageIncludes) assert.match(thrown.message, new RegExp(messageIncludes));
    });
  };
  return {
    meta: caseMeta,
    checks,
    check,
    assertEqual,
    assertTrue,
    assertFalse,
    expectThrow,
    canonical: (value) => stableStringify(value),
    fingerprint: (value) => contentHash(value),
    deepEqual,
  };
}

async function loadCases() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const casesDir = path.join(here, 'cases');
  const files = fs
    .readdirSync(casesDir)
    .filter((f) => f.endsWith('.mjs'))
    .sort();
  const cases = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(casesDir, file)).href);
    if (mod.default) cases.push({ ...mod.default, file });
  }
  return cases;
}

export async function runAll(options = {}) {
  const cases = await loadCases();
  const results = [];
  for (const testCase of cases) {
    const ctx = makeCaseContext(testCase);
    let fatal = null;
    try {
      await testCase.run(ctx);
    } catch (error) {
      fatal = error.stack || error.message;
    }
    const failed = ctx.checks.filter((c) => !c.passed);
    results.push({
      id: testCase.id,
      title: testCase.title,
      category: testCase.category,
      file: testCase.file,
      passed: !fatal && failed.length === 0,
      checks: ctx.checks,
      fatal,
    });
  }
  return summarize(results, options);
}

function summarize(results, options) {
  const byCategory = new Map();
  for (const result of results) {
    if (!byCategory.has(result.category)) byCategory.set(result.category, { total: 0, failed: 0 });
    const bucket = byCategory.get(result.category);
    bucket.total += 1;
    if (!result.passed) bucket.failed += 1;
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    categories: [...byCategory.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([category, stat]) => ({ category, ...stat, verdict: stat.failed ? 'FAIL' : 'PASS' })),
    results,
  };
  summary.verdict = summary.failed === 0 ? 'PASS' : 'FAIL';

  if (options.reportPath) {
    fs.writeFileSync(options.reportPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  }
  return summary;
}

export function printSummary(summary, reportPath) {
  const line = '-'.repeat(72);
  console.log(line);
  for (const result of summary.results) {
    console.log(`${result.passed ? 'PASS' : 'FAIL'}  [${result.category}] ${result.id} ${result.title}`);
    for (const check of result.checks) {
      if (!check.passed) console.log(`        x ${check.name}\n          ${check.error.replace(/\n/g, '\n          ')}`);
    }
    if (result.fatal) console.log(`        FATAL ${result.fatal.split('\n').slice(0, 4).join('\n          ')}`);
  }
  console.log(line);
  for (const category of summary.categories) {
    console.log(`${category.verdict.padEnd(4)} ${category.category}: ${category.total - category.failed}/${category.total} passed`);
  }
  console.log(line);
  console.log(`TOTAL ${summary.verdict}: ${summary.passed}/${summary.total} cases passed`);
  if (reportPath) console.log(`report: ${reportPath}`);
}
