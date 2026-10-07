/**
 * 统一批量运行入口（离线）：对多场次编排结果做一致性与冲突归属验证。
 *
 * 运行：npm run orchestrate:batch
 * 产物：reports/batch-orchestrate-report.json；任一检查失败时退出码为 1。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDemoStore,
  orchestrateSession,
  OrchestrationStore,
  stableStringify,
  type SessionResult,
} from '../src/orchestration';

interface CheckRecord {
  name: string;
  passed: boolean;
  details: string[];
}

const checks: CheckRecord[] = [];

function check(name: string, fn: (detail: (line: string) => void) => boolean): void {
  const details: string[] = [];
  let passed = false;
  try {
    passed = fn((line) => details.push(line));
  } catch (error) {
    details.push(`抛出异常: ${error instanceof Error ? error.message : String(error)}`);
  }
  checks.push({ name, passed, details });
  console.log(`${passed ? '✔' : '✘'} ${name}`);
  for (const line of details) console.log(`    ${line}`);
}

/** 校验：多场次 Store 中每场次的结果，与同输入下单场单独编排完全一致 */
function expectAllConsistent(store: OrchestrationStore, detail: (line: string) => void): boolean {
  let ok = true;
  for (const summary of store.listSessions()) {
    const state = store.getSessionState(summary.session.id)!;
    const standalone = orchestrateSession({
      session: state.session,
      slots: state.slots,
      requests: state.requests,
      participants: store.getParticipants(),
      resources: store.getResources(),
    });
    const same = stableStringify(standalone) === stableStringify(summary.result);
    detail(`场次 ${summary.session.id} digest=${summary.result.digest} ${same ? '一致' : '不一致'}`);
    if (!same) ok = false;
  }
  return ok;
}

function noStaleRefs(result: SessionResult, entityId: string): boolean {
  return (
    result.assignments.every((a) => a.participantId !== entityId && a.resourceId !== entityId) &&
    result.conflicts.every((c) => c.entityId !== entityId)
  );
}

// ---------- 场景 1：基线一致性 ----------
const store = buildDemoStore();
check('基线：多场次各自结果与单场单独编排一致', (detail) => expectAllConsistent(store, detail));

// ---------- 场景 2：边界场次（空场次 / 单资源场次） ----------
check('边界：空场次与仅含单一资源项的场次不报错', (detail) => {
  const empty = store.getResult('s4')!;
  const single = store.getResult('s3')!;
  detail(`空场次 s4: assignments=${empty.assignments.length} conflicts=${empty.conflicts.length}`);
  detail(`单资源场次 s3: assignments=${single.assignments.length} digest=${single.digest}`);
  return (
    empty.assignments.length === 0 &&
    empty.conflicts.length === 0 &&
    empty.rejections.length === 0 &&
    single.assignments.length === 1 &&
    single.conflicts.length === 0
  );
});

// ---------- 场景 3：切换场次不触发重排 ----------
check('切换场次：不触发任何场次的重推', (detail) => {
  const before = new Map(store.listSessions().map((s) => [s.session.id, s]));
  const sequence = ['s2', 's3', 's4', 's1', 's2', 's1'];
  for (const id of sequence) {
    if (!store.switchSession(id)) {
      detail(`switchSession(${id}) 返回 false`);
      return false;
    }
  }
  for (const [id, prev] of before) {
    const after = store.getSessionState(id)!;
    if (after.result !== prev.result || after.runVersion !== prev.runVersion) {
      detail(`场次 ${id} 在切换中被重推 (runVersion ${prev.runVersion} -> ${after.runVersion})`);
      return false;
    }
  }
  detail(`依次切换 ${sequence.join(' -> ')}，全部场次结果对象与 runVersion 保持不变`);
  return store.getActiveSessionId() === 's1';
});

// ---------- 场景 4：共享池移除参与者，只重推引用它的场次 ----------
check('共享池：移除参与者后受影响场次正确重推、无失效引用', (detail) => {
  const untouchedBefore = new Map(
    (['s3', 's4'] as const).map((id) => [id, store.getSessionState(id)!]),
  );
  const versionsBefore = new Map(store.listSessions().map((s) => [s.session.id, s.runVersion]));

  const affected = store.removeParticipant('p-shen');
  detail(`removeParticipant(p-shen) 重推场次: [${affected.join(', ')}]`);
  if (affected.join(',') !== 's1,s2') return false;

  for (const id of affected) {
    const result = store.getResult(id)!;
    if (!noStaleRefs(result, 'p-shen')) {
      detail(`场次 ${id} 仍保留 p-shen 的失效引用`);
      return false;
    }
    const rejections = result.rejections.filter((r) => r.reason === 'unknown-participant');
    detail(`场次 ${id}: runVersion ${versionsBefore.get(id)} -> ${store.getRunVersion(id)}, 拒绝 ${rejections.length} 条失效请求`);
    if (store.getRunVersion(id) !== versionsBefore.get(id)! + 1) return false;
  }
  for (const [id, before] of untouchedBefore) {
    const after = store.getSessionState(id)!;
    if (after.result !== before.result || after.runVersion !== before.runVersion) {
      detail(`未引用 p-shen 的场次 ${id} 被误重推`);
      return false;
    }
  }
  detail('未引用场次 s3/s4 结果对象保持不变');
  return true;
});

// ---------- 场景 5：共享池回补参与者，结果恢复且仍与单场一致 ----------
check('共享池：回补参与者后受影响场次恢复一致', (detail) => {
  const affected = store.upsertParticipant({ id: 'p-shen', name: '沈括', roles: ['主宾'] });
  detail(`upsertParticipant(p-shen) 重推场次: [${affected.join(', ')}]`);
  if (affected.join(',') !== 's1,s2') return false;
  return expectAllConsistent(store, detail);
});

// ---------- 场景 6：资源属性变更（容量），只重推引用它的场次 ----------
check('共享池：资源容量变更后受影响场次重推并暴露新冲突', (detail) => {
  const before = store.getSessionState('s3')!;
  const affected = store.upsertResource({ id: 'r-qipan', name: '漆盘', kind: 'tray', capacity: 1 });
  detail(`upsertResource(r-qipan capacity=1) 重推场次: [${affected.join(', ')}]`);
  if (affected.join(',') !== 's1,s2') return false;
  const s1 = store.getResult('s1')!;
  const conflict = s1.conflicts.find((c) => c.type === 'resource-overlap' && c.entityId === 'r-qipan');
  if (!conflict) {
    detail('场次 s1 未出现预期的 r-qipan 资源冲突');
    return false;
  }
  detail(`场次 s1 新冲突: ${conflict.id} 涉及分配 [${conflict.assignmentIds.join(', ')}]`);
  if (store.getSessionState('s3')!.result !== before.result) {
    detail('未引用 r-qipan 的场次 s3 被误重推');
    return false;
  }
  return true;
});

// ---------- 场景 7：资源属性变更（类型），属性约束失效的请求被拒 ----------
check('共享池：资源类型变更后属性约束不满足的请求被拒', (detail) => {
  const affected = store.upsertResource({ id: 'r-yubei', name: '玉杯', kind: 'ritual', capacity: 1 });
  detail(`upsertResource(r-yubei kind=ritual) 重推场次: [${affected.join(', ')}]`);
  if (affected.join(',') !== 's1,s2') return false;
  const s1 = store.getResult('s1')!;
  const s2 = store.getResult('s2')!;
  const m1 = s1.rejections.filter((r) => r.reason === 'kind-mismatch').map((r) => r.requestId);
  const m2 = s2.rejections.filter((r) => r.reason === 'kind-mismatch').map((r) => r.requestId);
  detail(`kind-mismatch 拒绝: s1=[${m1.join(', ')}] s2=[${m2.join(', ')}]`);
  return m1.join(',') === 'q1' && m2.join(',') === 'q7';
});

// ---------- 场景 8：跨场次冲突按场次归属分别呈现 ----------
check('跨场次冲突：按场次归属分别呈现且互不复写', (detail) => {
  const attributed = store.getCrossSessionConflicts();
  const s1List = attributed.get('s1') ?? [];
  const s2List = attributed.get('s2') ?? [];
  const s3List = attributed.get('s3') ?? [];
  detail(`归属记录数: s1=${s1List.length} s2=${s2List.length} s3=${s3List.length}`);

  // r-qipan 在 s1(辰时一刻 30-90) 与 s2(巳时 60-150) 之间跨场次重叠
  const inS1 = s1List.find((c) => c.resourceId === 'r-qipan');
  const inS2 = s2List.find((c) => c.resourceId === 'r-qipan');
  if (!inS1 || !inS2) {
    detail('r-qipan 跨场次冲突未同时归属到 s1 与 s2');
    return false;
  }
  if (inS1 === inS2) {
    detail('s1 与 s2 的归属记录是同一对象，存在复写风险');
    return false;
  }
  if (inS1.attributedTo !== 's1' || inS2.attributedTo !== 's2') return false;
  if (inS1.sessionIds.join(',') !== 's1,s2' || inS2.sessionIds.join(',') !== 's1,s2') return false;
  if (s3List.some((c) => c.resourceId === 'r-qipan')) {
    detail('未占用 r-qipan 的场次 s3 出现了归属记录');
    return false;
  }
  detail(`r-qipan 冲突归属: s1 记录 ${inS1.id}@${inS1.attributedTo}, s2 记录 ${inS2.id}@${inS2.attributedTo}, 区间 [${inS1.interval.start}, ${inS1.interval.end}]`);
  return true;
});

// ---------- 场景 9：场次增删与切换边界 ----------
check('边界：场次增删与非法切换保持稳定', (detail) => {
  if (store.switchSession('ghost') !== false) return false;
  if (store.removeSession('ghost') !== false) return false;

  // 新增仅含单一时段、单一请求的场次
  store.addSession(
    { id: 's5', name: '临时场' },
    [{ id: 'x1', sessionId: 's5', start: 0, end: 30 }],
    [
      {
        id: 'q11',
        sessionId: 's5',
        participantId: 'p-su',
        resourceId: 'r-yinzhu',
        slotId: 'x1',
        priority: 0,
      },
    ],
  );
  const s5 = store.getResult('s5')!;
  if (s5.assignments.length !== 1 || s5.conflicts.length !== 0) {
    detail('单时段单请求场次编排结果异常');
    return false;
  }

  // 删除当前激活场次，激活指针应顺延
  store.switchSession('s5');
  if (!store.removeSession('s5')) return false;
  const active = store.getActiveSessionId();
  detail(`删除激活场次 s5 后，激活场次顺延为 ${active}`);
  if (active === 's5' || active === null) return false;

  // 删除全部场次后仍稳定
  const empty = new OrchestrationStore();
  empty.addSession({ id: 'only', name: '唯一场' }, [], []);
  empty.removeSession('only');
  if (empty.getActiveSessionId() !== null || empty.switchSession('only') !== false) return false;
  detail('空 Store 增删场次后状态稳定');
  return true;
});

// ---------- 场景 10：全部变更后的最终一致性 ----------
check('终态：全部共享池变更后仍与单场单独编排一致', (detail) => expectAllConsistent(store, detail));

// ---------- 汇总与报告 ----------
const passedCount = checks.filter((c) => c.passed).length;
const report = {
  generatedAt: new Date().toISOString(),
  total: checks.length,
  passed: passedCount,
  failed: checks.length - passedCount,
  checks,
  sessions: store.listSessions().map((s) => ({
    sessionId: s.session.id,
    name: s.session.name,
    runVersion: s.runVersion,
    digest: s.result.digest,
    assignments: s.result.assignments.length,
    rejections: s.result.rejections.length,
    conflicts: s.result.conflicts.length,
  })),
};

const here = dirname(fileURLToPath(import.meta.url));
const reportPath = join(here, '..', 'reports', 'batch-orchestrate-report.json');
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(`\n${passedCount}/${checks.length} 项检查通过，报告已写入 ${reportPath}`);
if (passedCount !== checks.length) {
  process.exitCode = 1;
}
