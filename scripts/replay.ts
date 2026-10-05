/**
 * 离线批量推演入口（无需浏览器、无需安装依赖）：
 *   node --experimental-strip-types scripts/replay.ts [scenarios目录]
 *
 * 对 scenarios/ 下每组「部件依赖配置 + 操作序列」：
 *  1. 逐次施加操作，记录每步的 操作结论 / 各部件步骤状态 / 受阻原因 / 进度结论；
 *  2. 每步之后用 deriveFull 整体重推，与增量重推结果逐字段比对（必须完全一致）；
 *  3. 同一操作序列用全新会话重放一次，结论必须可复现；
 *  4. 若场景声明了 equivalentSequences，校验乱序序列到达同一终态时进度结论一致；
 *  5. 若场景声明了 expect，校验最终结论与操作统计。
 * 任一校验失败即以非零码退出。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyOperation,
  createSession,
  deriveFull,
} from '../src/assembly/machine.ts';
import { ARMILLARY_CONFIG } from '../src/assembly/armillary.ts';
import type {
  AssemblyConfig,
  Derivation,
  OpOutcome,
  Operation,
  Session,
} from '../src/assembly/types.ts';

interface ScenarioExpect {
  finalPhase?: string;
  finalPercent?: number;
  appliedCount?: number;
  invalidCount?: number;
  blockedCount?: number;
  unreachableParts?: string[];
}

interface Scenario {
  name: string;
  configRef?: string;
  config?: AssemblyConfig;
  operations: Operation[];
  equivalentSequences?: Operation[][];
  expect?: ScenarioExpect;
}

const here = dirname(fileURLToPath(import.meta.url));
const scenariosDir = process.argv[2] ?? join(here, '..', 'scenarios');

let failures = 0;
const fail = (msg: string) => {
  failures += 1;
  console.error(`  ✗ ${msg}`);
};

function normalizeDerivation(derivation: Derivation): string {
  const parts = Object.keys(derivation.parts)
    .sort()
    .map((id) => [id, derivation.parts[id]]);
  const conclusion = {
    ...derivation.conclusion,
    unreachable: [...derivation.conclusion.unreachable].sort((a, b) =>
      a.part.localeCompare(b.part),
    ),
  };
  return JSON.stringify({ parts, conclusion });
}

function runSequence(
  config: AssemblyConfig,
  operations: Operation[],
  label: string,
): { session: Session; outcomes: OpOutcome[] } {
  let session = createSession(config);
  const outcomes: OpOutcome[] = [];

  // 初始状态：增量（建会话时的全量推导）与整体重推必须一致
  if (normalizeDerivation(session.derivation) !== normalizeDerivation(deriveFull(session))) {
    fail(`${label}: 初始会话推导与整体重推不一致`);
  }

  operations.forEach((op, index) => {
    const step = `${label} 第${index + 1}步 ${op.kind} ${op.part}`;
    const { session: next, outcome } = applyOperation(session, op);
    outcomes.push(outcome);

    // 局部重推 vs 整体重推
    const full = deriveFull(next);
    if (normalizeDerivation(next.derivation) !== normalizeDerivation(full)) {
      fail(`${step}: 局部重推与整体重推不一致`);
    }

    // 无效 / 受阻操作不得改变状态与结论
    if (outcome.result !== 'applied') {
      if (normalizeDerivation(next.derivation) !== normalizeDerivation(session.derivation)) {
        fail(`${step}: ${outcome.result} 操作改变了推导结论`);
      }
      if (JSON.stringify(next.installed) !== JSON.stringify(session.installed)) {
        fail(`${step}: ${outcome.result} 操作改变了部件状态`);
      }
    }
    session = next;
  });

  return { session, outcomes };
}

function checkExpect(scenario: Scenario, session: Session, outcomes: OpOutcome[]) {
  const expect = scenario.expect;
  if (!expect) return;
  const conclusion = session.derivation.conclusion;
  const count = (result: OpOutcome['result']) =>
    outcomes.filter((o) => o.result === result).length;

  if (expect.finalPhase !== undefined && conclusion.phase !== expect.finalPhase) {
    fail(`期望阶段 ${expect.finalPhase}，实际 ${conclusion.phase}`);
  }
  if (expect.finalPercent !== undefined && conclusion.percent !== expect.finalPercent) {
    fail(`期望进度 ${expect.finalPercent}%，实际 ${conclusion.percent}%`);
  }
  if (expect.appliedCount !== undefined && count('applied') !== expect.appliedCount) {
    fail(`期望 applied=${expect.appliedCount}，实际 ${count('applied')}`);
  }
  if (expect.invalidCount !== undefined && count('invalid') !== expect.invalidCount) {
    fail(`期望 invalid=${expect.invalidCount}，实际 ${count('invalid')}`);
  }
  if (expect.blockedCount !== undefined && count('blocked') !== expect.blockedCount) {
    fail(`期望 blocked=${expect.blockedCount}，实际 ${count('blocked')}`);
  }
  if (expect.unreachableParts !== undefined) {
    const actual = conclusion.unreachable.map((u) => u.part).sort();
    const wanted = [...expect.unreachableParts].sort();
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
      fail(`期望不可达部件 [${wanted}]，实际 [${actual}]`);
    }
  }
}

const files = readdirSync(scenariosDir)
  .filter((f) => f.endsWith('.json'))
  .sort();

if (files.length === 0) {
  console.error(`未在 ${scenariosDir} 找到任何场景文件`);
  process.exit(1);
}

for (const file of files) {
  const scenario = JSON.parse(readFileSync(join(scenariosDir, file), 'utf8')) as Scenario;
  console.log(`\n■ ${scenario.name}（${file}）`);

  const config = scenario.config ?? (scenario.configRef === 'armillary' ? ARMILLARY_CONFIG : undefined);
  if (!config) {
    fail('场景缺少 config 或有效的 configRef');
    continue;
  }

  const { session, outcomes } = runSequence(config, scenario.operations, scenario.name);

  // 可复现性：同一操作序列重放，结论必须一致
  const replay = runSequence(config, scenario.operations, `${scenario.name}(重放)`);
  if (normalizeDerivation(replay.session.derivation) !== normalizeDerivation(session.derivation)) {
    fail('同一操作序列重放后结论不一致');
  }

  // 乱序等价序列：终态结论必须一致
  for (const [i, seq] of (scenario.equivalentSequences ?? []).entries()) {
    const alt = runSequence(config, seq, `${scenario.name}(等价序列${i + 1})`);
    if (
      normalizeDerivation(alt.session.derivation) !== normalizeDerivation(session.derivation)
    ) {
      fail(`等价序列 ${i + 1} 的终态结论与主序列不一致`);
    }
  }

  checkExpect(scenario, session, outcomes);

  const conclusion = session.derivation.conclusion;
  const stats = {
    applied: outcomes.filter((o) => o.result === 'applied').length,
    invalid: outcomes.filter((o) => o.result === 'invalid').length,
    blocked: outcomes.filter((o) => o.result === 'blocked').length,
  };
  console.log(
    `  操作统计 applied=${stats.applied} invalid=${stats.invalid} blocked=${stats.blocked}`,
  );
  console.log(
    `  进度结论 phase=${conclusion.phase} percent=${conclusion.percent}% ` +
      `已拆=${conclusion.detachedCount}/${conclusion.total}` +
      (conclusion.unreachable.length > 0
        ? ` 不可达=${conclusion.unreachable
            .map((u) => `${u.part}(${u.reason.kind})`)
            .join(',')}`
        : ''),
  );
}

console.log(
  failures === 0
    ? `\n全部 ${files.length} 组场景推演通过：局部重推 ≡ 整体重推，结论可复现。`
    : `\n共 ${failures} 处校验失败。`,
);
process.exit(failures === 0 ? 0 : 1);
