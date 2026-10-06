#!/usr/bin/env node
/**
 * 归因离线验证入口：一次性跑完 verification/fixtures 下的全部用例，
 * 输出每个用例/每项检查的通过或失败与差异说明，并写出可追溯的 JSON 报告。
 *
 * 用法：
 *   node verification/run.mjs [--fixture <id子串>] [--report <输出路径>] [--list]
 * 退出码：全部通过为 0，任一失败为 1。完全离线，无外部依赖。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runFullAttribution } from '../analyzer/attribution.mjs';
import { IncrementalAttributor } from '../analyzer/incremental.mjs';
import { ANALYZER_VERSION } from '../analyzer/model.mjs';
import {
  checkAttributionInvariants,
  checkExpectDiagnostics,
  checkExpectedPaths,
  checkIncrementalFix,
  checkNoSilentSkip,
  checkOrderInvariance,
  checkSharedNodes,
} from './lib/checks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(HERE, 'fixtures');
const DEFAULT_REPORT = path.join(HERE, 'reports', 'attribution-verification.report.json');

function parseArgs(argv) {
  const args = { fixture: null, report: DEFAULT_REPORT, list: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--fixture') args.fixture = argv[++i];
    else if (argv[i] === '--report') args.report = path.resolve(argv[++i]);
    else if (argv[i] === '--list') args.list = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('usage: node verification/run.mjs [--fixture <id>] [--report <path>] [--list]');
      process.exit(0);
    }
  }
  return args;
}

function loadFixtures() {
  return fs.readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.fixture.json'))
    .sort()
    .map((f) => ({ file: f, spec: JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), 'utf8')) }));
}

/** 确定性伪随机（LCG），用于生成可复现的导入顺序。 */
function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffled(items, rand) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function permutations(items) {
  if (items.length <= 1) return [items];
  const out = [];
  for (let i = 0; i < items.length; i += 1) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([items[i], ...tail]);
  }
  return out;
}

/** 展开用例的导入序列：显式 imports，或 samples + 顺序扰动声明。 */
function expandImports(spec) {
  if (Array.isArray(spec.imports)) return spec.imports;
  if (!Array.isArray(spec.samples)) throw new Error(`fixture ${spec.id}: needs "imports" or "samples"`);
  const base = spec.samples.map((sample, i) => ({ ...sample, sampleId: sample.sampleId ?? `s${i}` }));
  const orders = [{ name: 'original', samples: base }];
  if (spec.permute === 'all') {
    for (const [i, perm] of permutations(base).entries()) {
      if (i === 0) continue;
      orders.push({ name: `perm-${i}`, samples: perm });
    }
  } else if (typeof spec.permute === 'number' && spec.permute > 1) {
    const rand = lcg(0x9e3779b9);
    for (let i = 1; i < spec.permute; i += 1) orders.push({ name: `shuffle-${i}`, samples: shuffled(base, rand) });
  }
  return orders;
}

/** 把修正回放进样本，用于全量重算对照。 */
function applyFixesToSamples(samples, fixes) {
  const cloned = samples.map((s) => ({ ...s, spans: s.spans.map((sp) => ({ ...sp })) }));
  for (const fix of fixes) {
    for (const sample of cloned) {
      for (const span of sample.spans) {
        if (span.id !== fix.nodeId) continue;
        if (fix.type === 'set-duration') span.duration = fix.duration;
        if (fix.type === 'set-parent') span.parentId = fix.parentId ?? null;
      }
    }
  }
  return cloned;
}

function runCase(spec) {
  const checks = [];
  const imports = expandImports(spec);
  const importedReports = imports.map((imp) => ({ name: imp.name, report: runFullAttribution(imp.samples) }));

  for (const { name, report } of importedReports) {
    checks.push(checkAttributionInvariants(report, name));
    checks.push(checkNoSilentSkip(report, name));
  }
  if (importedReports.length > 1) checks.push(checkOrderInvariance(importedReports));

  if (spec.expectDiagnostics) {
    for (const { name, report } of importedReports) checks.push(checkExpectDiagnostics(report, spec.expectDiagnostics, name));
  }
  if (spec.shared) {
    for (const { name, report } of importedReports) checks.push(checkSharedNodes(report, spec.shared, name));
  }
  if (spec.expectPaths) {
    for (const { name, report } of importedReports) checks.push(checkExpectedPaths(report, spec.expectPaths, name));
  }

  let fixEvidence = null;
  if (Array.isArray(spec.fixes) && spec.fixes.length) {
    const attributor = new IncrementalAttributor(imports[0].samples);
    const preReport = attributor.report();
    const preCache = new Map(attributor.attributionCache);
    fixEvidence = attributor.applyFixes(spec.fixes);
    const postReport = attributor.report();
    const fullReport = runFullAttribution(applyFixesToSamples(imports[0].samples, spec.fixes));
    checks.push(checkIncrementalFix({
      label: spec.id,
      preReport,
      postReport,
      fullReport,
      evidence: fixEvidence,
      preCache,
      postCache: attributor.attributionCache,
    }));
  }

  const failed = checks.filter((c) => c.status === 'fail');
  return {
    id: spec.id,
    title: spec.title ?? '',
    status: failed.length ? 'fail' : 'pass',
    checks,
    evidence: fixEvidence,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let fixtures = loadFixtures();
  if (args.list) {
    for (const f of fixtures) console.log(`${f.spec.id}\t${f.spec.title ?? ''}`);
    return;
  }
  if (args.fixture) fixtures = fixtures.filter((f) => f.spec.id.includes(args.fixture));
  if (!fixtures.length) {
    console.error('no fixtures matched');
    process.exit(2);
  }

  const cases = [];
  for (const { spec } of fixtures) {
    const result = runCase(spec);
    cases.push(result);
    const passed = result.checks.filter((c) => c.status === 'pass').length;
    const failed = result.checks.filter((c) => c.status === 'fail');
    const mark = failed.length ? 'FAIL' : 'PASS';
    console.log(`${mark} ${result.id} — ${result.title} (${passed}/${result.checks.length} checks passed)`);
    for (const check of failed) {
      console.log(`  ✗ ${check.name}`);
      for (const detail of check.details) console.log(`    ${detail}`);
    }
  }

  const failedCases = cases.filter((c) => c.status === 'fail');
  console.log(`\n${cases.length - failedCases.length}/${cases.length} cases passed`);
  if (failedCases.length) console.log(`failed: ${failedCases.map((c) => c.id).join(', ')}`);

  const report = {
    generatedAt: new Date().toISOString(),
    analyzerVersion: ANALYZER_VERSION,
    fixtureDir: path.relative(process.cwd(), FIXTURE_DIR),
    summary: { total: cases.length, passed: cases.length - failedCases.length, failed: failedCases.length },
    cases,
  };
  fs.mkdirSync(path.dirname(args.report), { recursive: true });
  fs.writeFileSync(args.report, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`report written to ${path.relative(process.cwd(), args.report)}`);

  process.exit(failedCases.length ? 1 : 0);
}

main();
