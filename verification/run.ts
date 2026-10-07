/**
 * 陶器碎片拼合链路离线批量验证器。
 *
 * 运行入口: npm run verify（等价于 node verification/run.ts）
 * 不依赖浏览器、three.js 或任何 npm 包，仅使用 Node 内置能力，可离线运行。
 *
 * 每组用例（verification/cases/*.json）描述一份碎片集合 + 一个拼合操作
 * 序列 + 期望结论。验证器对每组用例执行五类检查：
 * 1. 结论符合期望（状态 / 进度 / 轨迹 / 拒绝事件 / 失真原因）
 * 2. 进度与完成态相互印证（checkSnapshotConsistency 全程 invariant）
 * 3. 确定性复现：同一操作序列重放两次，结论必须逐字节一致
 * 4. 入口一致性：place 入口自动展开为 drag+submit 交互入口，结论必须一致
 * 5. 变体一致性：用例自带的等价操作序列（如顺序颠倒）结论必须一致
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkSnapshotConsistency, createPuzzleSession } from '../src/puzzleLogic.ts';
import type {
  DistortionReason,
  FragmentSpec,
  PuzzleOperation,
  RejectionReason,
  SessionSnapshot,
} from '../src/types.ts';

interface CaseExpectation {
  status?: SessionSnapshot['status'];
  placedCount?: number;
  placed?: string[];
  trajectory?: number[];
  rejections?: Array<{ fragmentId: string; reason: RejectionReason }>;
  distortions?: DistortionReason[];
}

interface VerificationCase {
  name: string;
  description?: string;
  fragments: FragmentSpec[];
  operations: PuzzleOperation[];
  variants?: Array<{ name: string; operations: PuzzleOperation[] }>;
  expect: CaseExpectation;
}

interface CaseResult {
  name: string;
  passed: boolean;
  failures: string[];
}

function replay(fragments: FragmentSpec[], operations: PuzzleOperation[]): SessionSnapshot {
  const session = createPuzzleSession(fragments);
  for (const operation of operations) session.apply(operation);
  return session.snapshot();
}

/** 把 place 组合入口展开为 drag+submit 交互入口，模拟不同入口路径。 */
function expandToDragSubmit(operations: PuzzleOperation[]): PuzzleOperation[] {
  const expanded: PuzzleOperation[] = [];
  for (const operation of operations) {
    if (operation.type === 'place') {
      expanded.push(
        { type: 'drag', fragmentId: operation.fragmentId, position: operation.position, rotation: operation.rotation },
        { type: 'submit', fragmentId: operation.fragmentId },
      );
    } else {
      expanded.push(operation);
    }
  }
  return expanded;
}

/** 严格一致：同一操作序列重放必须逐字节相同（含事件顺序）。 */
function sameDeterministicOutcome(a: SessionSnapshot, b: SessionSnapshot): boolean {
  return (
    a.status === b.status &&
    a.placedCount === b.placedCount &&
    JSON.stringify(a.placed) === JSON.stringify(b.placed) &&
    JSON.stringify(a.progressTrajectory) === JSON.stringify(b.progressTrajectory) &&
    JSON.stringify(a.events) === JSON.stringify(b.events) &&
    JSON.stringify(a.distortions) === JSON.stringify(b.distortions)
  );
}

/**
 * 结论一致：不同操作顺序/不同入口走出的最终拼合结论必须一致。
 * 事件发生的先后顺序允许不同，但结论状态、已拼合集合、进度轨迹、
 * 失真记录与拒绝事件（作为多重集合）必须相同。
 */
function sameFinalConclusion(a: SessionSnapshot, b: SessionSnapshot): boolean {
  const rejectionsOf = (snapshot: SessionSnapshot) =>
    snapshot.events
      .filter((event) => event.type === 'rejected')
      .map((event) => `${event.fragmentId}:${event.reason}`)
      .sort();
  const snappedCountOf = (snapshot: SessionSnapshot) =>
    snapshot.events.filter((event) => event.type === 'snapped').length;
  return (
    a.status === b.status &&
    a.placedCount === b.placedCount &&
    JSON.stringify(a.placed) === JSON.stringify(b.placed) &&
    JSON.stringify(a.progressTrajectory) === JSON.stringify(b.progressTrajectory) &&
    JSON.stringify(a.distortions) === JSON.stringify(b.distortions) &&
    snappedCountOf(a) === snappedCountOf(b) &&
    JSON.stringify(rejectionsOf(a)) === JSON.stringify(rejectionsOf(b))
  );
}

function checkExpectations(snapshot: SessionSnapshot, expect: CaseExpectation): string[] {
  const failures: string[] = [];
  if (expect.status !== undefined && snapshot.status !== expect.status) {
    failures.push(`结论状态不符: 期望 ${expect.status}，实际 ${snapshot.status}`);
  }
  if (expect.placedCount !== undefined && snapshot.placedCount !== expect.placedCount) {
    failures.push(`进度计数不符: 期望 ${expect.placedCount}，实际 ${snapshot.placedCount}`);
  }
  if (expect.placed !== undefined && JSON.stringify(snapshot.placed) !== JSON.stringify([...expect.placed].sort())) {
    failures.push(`已拼合集合不符: 期望 [${expect.placed}]，实际 [${snapshot.placed}]`);
  }
  if (expect.trajectory !== undefined && JSON.stringify(snapshot.progressTrajectory) !== JSON.stringify(expect.trajectory)) {
    failures.push(`进度轨迹不符: 期望 [${expect.trajectory}]，实际 [${snapshot.progressTrajectory}]`);
  }
  if (expect.rejections !== undefined) {
    const actual = snapshot.events
      .filter((event) => event.type === 'rejected')
      .map((event) => ({ fragmentId: event.fragmentId, reason: event.reason }));
    if (JSON.stringify(actual) !== JSON.stringify(expect.rejections)) {
      failures.push(`拒绝事件不符: 期望 ${JSON.stringify(expect.rejections)}，实际 ${JSON.stringify(actual)}`);
    }
  }
  if (expect.distortions !== undefined) {
    const actual = snapshot.distortions.map((finding) => finding.reason).sort();
    const wanted = [...expect.distortions].sort();
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
      failures.push(`失真原因不符: 期望 [${wanted}]，实际 [${actual}]`);
    }
  }
  return failures;
}

function validateCaseShape(raw: unknown): raw is VerificationCase {
  if (typeof raw !== 'object' || raw === null) return false;
  const candidate = raw as Record<string, unknown>;
  return (
    typeof candidate.name === 'string' &&
    Array.isArray(candidate.fragments) &&
    Array.isArray(candidate.operations) &&
    typeof candidate.expect === 'object' &&
    candidate.expect !== null
  );
}

function runCase(testCase: VerificationCase): CaseResult {
  const failures: string[] = [];

  const baseline = replay(testCase.fragments, testCase.operations);

  for (const violation of checkSnapshotConsistency(baseline)) {
    failures.push(`进度/完成态印证失败: ${violation}`);
  }

  failures.push(...checkExpectations(baseline, testCase.expect));

  const replayed = replay(testCase.fragments, testCase.operations);
  if (!sameDeterministicOutcome(baseline, replayed)) {
    failures.push('确定性复现失败: 同一操作序列两次重放结论不一致');
  }

  const viaDragSubmit = replay(testCase.fragments, expandToDragSubmit(testCase.operations));
  if (!sameFinalConclusion(baseline, viaDragSubmit)) {
    failures.push('入口一致性失败: place 入口与 drag+submit 入口走出了不同结论');
  }

  for (const variant of testCase.variants ?? []) {
    const variantSnapshot = replay(testCase.fragments, variant.operations);
    if (!sameFinalConclusion(baseline, variantSnapshot)) {
      failures.push(`变体一致性失败: 变体 "${variant.name}" 与基准序列结论不一致`);
    }
    for (const violation of checkSnapshotConsistency(variantSnapshot)) {
      failures.push(`变体 "${variant.name}" 进度/完成态印证失败: ${violation}`);
    }
  }

  return { name: testCase.name, passed: failures.length === 0, failures };
}

/**
 * 自检：向一致性校验器投喂被人为破坏的快照，确认“进度与完成态互相
 * 矛盾”这类失真一定会被暴露，而不是被当作正常结果放过。
 */
function runSelfChecks(): CaseResult {
  const failures: string[] = [];
  const healthy = replay(
    [
      { id: 's1', targetPosition: { x: 0, y: 0, z: 0 }, targetRotation: { x: 0, y: 0, z: 0 }, dependsOn: [] },
      { id: 's2', targetPosition: { x: 1, y: 0, z: 0 }, targetRotation: { x: 0, y: 0, z: 0 }, dependsOn: [] },
    ],
    [
      { type: 'place', fragmentId: 's1', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      { type: 'place', fragmentId: 's2', position: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    ],
  );
  if (healthy.status !== 'completed') {
    failures.push('自检基线异常: 健康碎片集合未能走到 completed');
  }
  if (checkSnapshotConsistency(healthy).length > 0) {
    failures.push('一致性校验器误报: 健康快照被判定为失真');
  }

  const corrupted: Array<{ label: string; mutate: (snapshot: SessionSnapshot) => void }> = [
    { label: '计数与列表不一致', mutate: (s) => { s.placedCount = 1; } },
    { label: '未完成却标记完成', mutate: (s) => { s.placed = ['s1']; s.placedCount = 1; s.progressTrajectory = [1]; s.status = 'completed'; } },
    { label: '全部拼合却未完成', mutate: (s) => { s.status = 'in-progress'; } },
    { label: '进度轨迹断裂', mutate: (s) => { s.progressTrajectory = [1, 1]; } },
    { label: '完成事件重复结算', mutate: (s) => { s.events.push({ type: 'completed', placedCount: 2, total: 2 }); } },
    { label: '已拼合列表被重复覆盖', mutate: (s) => { s.placed = ['s1', 's1']; } },
  ];
  for (const { label, mutate } of corrupted) {
    const snapshot = replay(
      [
        { id: 's1', targetPosition: { x: 0, y: 0, z: 0 }, targetRotation: { x: 0, y: 0, z: 0 }, dependsOn: [] },
        { id: 's2', targetPosition: { x: 1, y: 0, z: 0 }, targetRotation: { x: 0, y: 0, z: 0 }, dependsOn: [] },
      ],
      [
        { type: 'place', fragmentId: 's1', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
        { type: 'place', fragmentId: 's2', position: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      ],
    );
    mutate(snapshot);
    const violations = checkSnapshotConsistency(snapshot);
    if (violations.length === 0) {
      failures.push(`一致性校验器漏报: 人为破坏“${label}”未被暴露`);
    }
  }

  return { name: 'selfcheck:consistency-detector', passed: failures.length === 0, failures };
}

function main(): void {
  const casesDir = join(dirname(fileURLToPath(import.meta.url)), 'cases');
  const caseFiles = readdirSync(casesDir)
    .filter((file) => file.endsWith('.json'))
    .sort();

  const results: CaseResult[] = [runSelfChecks()];

  for (const file of caseFiles) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(casesDir, file), 'utf8'));
    } catch (error) {
      results.push({ name: file, passed: false, failures: [`用例文件不是合法 JSON: ${String(error)}`] });
      continue;
    }
    if (!validateCaseShape(parsed)) {
      results.push({ name: file, passed: false, failures: ['用例文件结构不完整（需要 name/fragments/operations/expect）'] });
      continue;
    }
    results.push(runCase(parsed));
  }

  let passedCount = 0;
  for (const result of results) {
    if (result.passed) {
      passedCount += 1;
      console.log(`PASS  ${result.name}`);
    } else {
      console.log(`FAIL  ${result.name}`);
      for (const failure of result.failures) {
        console.log(`      - ${failure}`);
      }
    }
  }
  console.log(`\n${passedCount}/${results.length} 组通过`);
  if (passedCount !== results.length) {
    process.exitCode = 1;
  }
}

main();
