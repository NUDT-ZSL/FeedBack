#!/usr/bin/env node
/**
 * 离线验证入口：一次性跑完 verification/cases 下的全部用例，
 * 输出每个用例的通过/失败与差异说明，并把可追溯证据写入 verification/evidence/。
 *
 * 用法：node verification/runner.js [--case <name>] [--evidence-dir <dir>]
 * 退出码：0 全部通过；1 存在失败或用例加载错误。
 */

import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyze } from '../analyzer/index.js';
import { checks } from './lib/checks.js';

const here = dirname(fileURLToPath(import.meta.url));
const casesDir = join(here, 'cases');
const defaultEvidenceDir = join(here, 'evidence');

function parseArgs(argv) {
  const options = { caseFilter: null, evidenceDir: defaultEvidenceDir };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--case') {
      options.caseFilter = argv[++i];
    } else if (argv[i] === '--evidence-dir') {
      options.evidenceDir = argv[++i];
    }
  }
  return options;
}

function loadCases(caseFilter) {
  const files = readdirSync(casesDir)
    .filter((f) => f.endsWith('.json'))
    .filter((f) => !caseFilter || f === `${caseFilter}.json`)
    .sort();
  return files.map((file) => ({
    file,
    testCase: JSON.parse(readFileSync(join(casesDir, file), 'utf8')),
  }));
}

function runCase(testCase) {
  const failures = [];
  const artifacts = {};
  let analysis;
  try {
    analysis = analyze(testCase.samples ?? []);
  } catch (error) {
    return { failures: [`case setup failed: ${error.message}`], artifacts };
  }
  artifacts.analysis = analysis;

  for (const check of testCase.checks ?? []) {
    const executor = checks[check.type];
    if (!executor) {
      failures.push(`unknown check type: '${check.type}'`);
      continue;
    }
    let outcome;
    try {
      outcome = executor({ testCase, analysis }, check);
    } catch (error) {
      failures.push(`check '${check.type}' threw: ${error.message}`);
      continue;
    }
    for (const failure of outcome.failures) failures.push(`[${check.type}] ${failure}`);
    Object.assign(artifacts, outcome.artifacts);
  }
  return { failures, artifacts };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  let loaded;
  try {
    loaded = loadCases(options.caseFilter);
  } catch (error) {
    console.error(`failed to load cases: ${error.message}`);
    process.exit(1);
  }
  if (loaded.length === 0) {
    console.error('no verification cases found');
    process.exit(1);
  }

  mkdirSync(options.evidenceDir, { recursive: true });

  let passed = 0;
  let failed = 0;
  for (const { file, testCase } of loaded) {
    const name = testCase.name ?? file;
    const { failures, artifacts } = runCase(testCase);
    const evidencePath = join(options.evidenceDir, file);
    writeFileSync(
      evidencePath,
      JSON.stringify(
        {
          case: name,
          description: testCase.description ?? null,
          status: failures.length === 0 ? 'PASS' : 'FAIL',
          generatedAt: new Date().toISOString(),
          ...artifacts,
        },
        null,
        2,
      ),
    );
    if (failures.length === 0) {
      passed += 1;
      console.log(`PASS ${name}`);
    } else {
      failed += 1;
      console.log(`FAIL ${name}`);
      for (const failure of failures) console.log(`  ${failure}`);
    }
  }

  console.log('');
  console.log(`Summary: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`Evidence written to ${options.evidenceDir}`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
