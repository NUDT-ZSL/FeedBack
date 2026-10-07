import {
  triggerAfterOperationEdit,
  triggerFromLoomBoard,
  triggerFromOrders,
} from '../src/scheduling/entries.ts';
import type { EntryView } from '../src/scheduling/entries.ts';
import { applyChanges } from '../src/scheduling/incremental.ts';
import type { ChangeSet } from '../src/scheduling/incremental.ts';
import { scheduleAll } from '../src/scheduling/scheduler.ts';
import type { ScheduleResult, ScheduledOp } from '../src/scheduling/types.ts';
import { diffResults } from './diff.ts';
import {
  ambiguousCoverageDataset,
  boundaryDataset,
  cycleDataset,
  missingDependencyDataset,
  noCapableLoomDataset,
  normalDataset,
  unknownLoomDataset,
} from './fixtures.ts';

class TestFailure extends Error {}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new TestFailure(msg);
}

function assertEq<T>(actual: T, expected: T, what: string): void {
  if (actual !== expected) {
    throw new TestFailure(`${what}: 实际=${String(actual)} 期望=${String(expected)}`);
  }
}

function getOp(result: ScheduleResult, opId: string): ScheduledOp {
  const found = result.scheduled.find((s) => s.opId === opId);
  if (!found) throw new TestFailure(`结果中缺少工序${opId}的排布`);
  return found;
}

function viewToResult(view: EntryView): ScheduleResult {
  const scheduled = Object.values(view.byOrder)
    .flat()
    .sort((a, b) => (a.opId < b.opId ? -1 : 1));
  return {
    ok: view.ok,
    scheduled,
    adjudications: view.adjudications,
    failures: view.failures,
  };
}

function assertConsistent(
  actual: ScheduleResult,
  expected: ScheduleResult,
  labelA: string,
  labelB: string,
): void {
  const lines = diffResults(actual, expected, labelA, labelB);
  if (lines.length > 0) {
    throw new TestFailure(`${labelA}与${labelB}结论不一致:\n    ${lines.join('\n    ')}`);
  }
}

type TestFn = () => void;
interface Suite {
  name: string;
  cases: { name: string; fn: TestFn }[];
}
const suites: Suite[] = [];
function suite(name: string, define: (test: (n: string, fn: TestFn) => void) => void): void {
  const cases: { name: string; fn: TestFn }[] = [];
  define((n, fn) => cases.push({ name: n, fn }));
  suites.push({ name, cases });
}

suite('正常排布基准', (test) => {
  test('基准数据集的档期、工时与顺延依据', () => {
    const result = scheduleAll(normalDataset());
    assert(result.ok, `排产应成功，实际失败: ${JSON.stringify(result.failures)}`);

    const expect = (
      opId: string,
      loomId: string,
      start: number,
      end: number,
      work: number,
    ): ScheduledOp => {
      const s = getOp(result, opId);
      assertEq(s.loomId, loomId, `工序${opId} 织机`);
      assertEq(s.start, start, `工序${opId} 开始`);
      assertEq(s.end, end, `工序${opId} 结束`);
      assertEq(s.workMinutes, work, `工序${opId} 工时`);
      return s;
    };

    expect('A1', 'L1', 0, 20, 20);
    const b1 = expect('B1', 'L1', 20, 60, 40);
    expect('A2', 'L3', 60, 90, 30);
    expect('A3', 'L3', 90, 100, 10);
    const b2 = expect('B2', 'L3', 100, 120, 20);
    expect('C1', 'L1', 100, 110, 10);
    const c2 = expect('C2', 'L3', 120, 130, 10);

    assert(
      b1.basis.reasons.some((r) => r.includes('A1') && r.includes('占用至20')),
      `B1的顺延依据应指向A1占用至20，实际: ${b1.basis.reasons.join(' | ')}`,
    );
    assert(
      b2.basis.reasons.some((r) => r.includes('A3') && r.includes('占用至100')),
      `B2的顺延依据应指向A3占用至100，实际: ${b2.basis.reasons.join(' | ')}`,
    );
    assert(
      c2.basis.reasons.some((r) => r.includes('B2') && r.includes('占用至120')),
      `C2的顺延依据应指向B2占用至120，实际: ${c2.basis.reasons.join(' | ')}`,
    );
    const a2 = getOp(result, 'A2');
    assert(
      a2.basis.reasons.some((r) => r.includes('L3') && r.includes('自60起可用')),
      `A2的依据应说明织机L3自60起可用，实际: ${a2.basis.reasons.join(' | ')}`,
    );
  });

  test('边界数据集：零工时、工时向上取整、同优先级裁决', () => {
    const result = scheduleAll(boundaryDataset());
    assert(result.ok, `排产应成功，实际失败: ${JSON.stringify(result.failures)}`);

    const z1 = getOp(result, 'Z1');
    assertEq(z1.workMinutes, 0, 'Z1(0分钟) 工时');
    assertEq(z1.start, 4, 'Z1 开始');
    assertEq(z1.end, 4, 'Z1 结束(零工时不占位)');

    const z2 = getOp(result, 'Z2');
    assertEq(z2.workMinutes, 4, 'Z2(10分钟/3倍速) 工时向上取整');
    assertEq(z2.start, 4, 'Z2 开始(放行时间即就绪)');
    assertEq(z2.end, 8, 'Z2 结束');

    const z3 = getOp(result, 'Z3');
    assertEq(z3.workMinutes, 2, 'Z3(6分钟/3倍速) 工时');
    assertEq(z3.start, 8, 'Z3 开始');
    assertEq(z3.end, 10, 'Z3 结束');

    const adj = result.adjudications.find((a) => a.opId === 'Z1');
    assert(adj !== undefined, 'Z1应有裁决记录');
    assertEq(adj.rule, 'priority+loom-id-tiebreak', 'Z1 同优先级裁决规则');
    assertEq(adj.winner, 'L1', 'Z1 同优先级按织机编号裁决');
  });
});

suite('入口一致性', (test) => {
  for (const [label, dataset] of [
    ['正常数据集', normalDataset()],
    ['边界数据集', boundaryDataset()],
  ] as const) {
    test(`${label}：订单入口与织机看板入口结论一致`, () => {
      const fromOrders = viewToResult(triggerFromOrders(dataset));
      const fromLooms = viewToResult(triggerFromLoomBoard(dataset));
      assertConsistent(fromOrders, fromLooms, '订单入口', '织机看板入口');
    });
  }

  test('工序编辑入口（增量）与订单入口（整体重排）结论一致', () => {
    const input = normalDataset();
    const prev = scheduleAll(input);
    const changes: ChangeSet = { dependencies: [{ opId: 'B2', dependsOn: ['A2', 'C1'] }] };
    const editView = triggerAfterOperationEdit(input, changes, prev);
    const fullView = triggerFromOrders(applyChanges(input, changes));
    assertConsistent(viewToResult(editView), viewToResult(fullView), '工序编辑入口', '订单入口');
  });
});

suite('增量重推等价性', (test) => {
  const runMutation = (
    label: string,
    mutate: () => ChangeSet,
    expectedImpacted: string[] | null,
  ): void => {
    test(label, () => {
      const input = normalDataset();
      const prev = scheduleAll(input);
      assert(prev.ok, '基准排产应成功');
      const changes = mutate();
      const editView = triggerAfterOperationEdit(input, changes, prev);
      const impacted = editView.impacted;
      const full = scheduleAll(applyChanges(input, changes));
      assertConsistent(
        viewToResult(editView),
        full,
        '增量重推',
        '整体重排',
      );
      if (expectedImpacted !== null) {
        const actual = impacted.map((i) => i.opId).sort();
        assertEq(
          actual.join(','),
          [...expectedImpacted].sort().join(','),
          '受影响工序集合',
        );
      }
    });
  };

  runMutation(
    '追加前置依赖：仅重推受影响工序(B2、C2)',
    () => ({ dependencies: [{ opId: 'B2', dependsOn: ['A2', 'C1'] }] }),
    ['B2', 'C2'],
  );

  runMutation(
    '调整织机能力优先级：dye改判L2，联动A2/A3/B2/C2',
    () => ({ capabilityUpserts: [{ loomId: 'L2', operationType: 'dye', priority: 20 }] }),
    ['A2', 'A3', 'B2', 'C2'],
  );

  runMutation(
    '移除织机能力：L3不再支持dye',
    () => ({ capabilityRemovals: [{ loomId: 'L3', operationType: 'dye' }] }),
    ['A2', 'A3', 'B2', 'C2'],
  );

  test('依赖变更引入闭环：增量路径同样暴露失败', () => {
    const input = normalDataset();
    const prev = scheduleAll(input);
    const changes: ChangeSet = { dependencies: [{ opId: 'A1', dependsOn: ['A3'] }] };
    const view = triggerAfterOperationEdit(input, changes, prev);
    assert(!view.ok, '引入依赖闭环后排产应失败');
    const cycle = view.failures.find((f) => f.kind === 'dependency-cycle');
    assert(cycle !== undefined, `应报告依赖闭环，实际: ${JSON.stringify(view.failures)}`);
    if (cycle.kind === 'dependency-cycle') {
      for (const opId of ['A1', 'A2', 'A3']) {
        assert(cycle.cycle.includes(opId), `闭环路径应包含${opId}，实际: ${cycle.cycle.join(' -> ')}`);
      }
    }
  });
});

suite('裁决可追溯', (test) => {
  test('多台织机不同优先级覆盖：按优先级裁决并留存依据', () => {
    const result = scheduleAll(ambiguousCoverageDataset(false));
    assert(result.ok, '默认策略下应裁决后继续');
    const adj = result.adjudications.find((a) => a.opId === 'M1');
    assert(adj !== undefined, 'M1应有裁决记录');
    assertEq(adj.winner, 'L1', 'M1 裁决胜出织机');
    assertEq(adj.rule, 'priority', 'M1 裁决规则');
    assert(adj.ambiguous, 'M1 应标记为多织机不同优先级覆盖');
    assertEq(
      adj.candidates.map((c) => `${c.loomId}@${c.priority}`).join(','),
      'L1@10,L2@7',
      'M1 裁决候选清单',
    );
  });

  test('严格策略下多织机不同优先级覆盖直接判失败', () => {
    const result = scheduleAll(ambiguousCoverageDataset(true));
    assert(!result.ok, '严格策略下应失败');
    const failure = result.failures.find((f) => f.kind === 'ambiguous-coverage');
    assert(failure !== undefined, `应报告ambiguous-coverage，实际: ${JSON.stringify(result.failures)}`);
    if (failure.kind === 'ambiguous-coverage') {
      assertEq(failure.opId, 'M1', '歧义覆盖工序');
    }
  });
});

suite('失败路径', (test) => {
  test('依赖闭环：报告闭环路径而非静默挂起', () => {
    const result = scheduleAll(cycleDataset());
    assert(!result.ok, '存在依赖闭环时应失败');
    const cycle = result.failures.find((f) => f.kind === 'dependency-cycle');
    assert(cycle !== undefined, `应报告依赖闭环，实际: ${JSON.stringify(result.failures)}`);
    if (cycle.kind === 'dependency-cycle') {
      for (const opId of ['A1', 'A2', 'A3']) {
        assert(cycle.cycle.includes(opId), `闭环路径应包含${opId}，实际: ${cycle.cycle.join(' -> ')}`);
      }
    }
  });

  test('前置依赖指向不存在的工序', () => {
    const result = scheduleAll(missingDependencyDataset());
    assert(!result.ok, '依赖缺失时应失败');
    const failure = result.failures.find((f) => f.kind === 'missing-dependency');
    assert(failure !== undefined, `应报告missing-dependency，实际: ${JSON.stringify(result.failures)}`);
    if (failure.kind === 'missing-dependency') {
      assertEq(failure.opId, 'B2', '依赖缺失的工序');
      assertEq(failure.missingOpId, 'NOPE', '缺失的依赖目标');
    }
  });

  test('能力记录指向不存在的织机', () => {
    const result = scheduleAll(unknownLoomDataset());
    assert(!result.ok, '指向缺失织机时应失败');
    const failure = result.failures.find((f) => f.kind === 'unknown-loom-reference');
    assert(failure !== undefined, `应报告unknown-loom-reference，实际: ${JSON.stringify(result.failures)}`);
    if (failure.kind === 'unknown-loom-reference') {
      assertEq(failure.loomId, 'L9', '缺失的织机');
    }
  });

  test('工序类型无任何织机覆盖', () => {
    const result = scheduleAll(noCapableLoomDataset());
    assert(!result.ok, '能力覆盖不足时应失败');
    const failure = result.failures.find((f) => f.kind === 'no-capable-loom');
    assert(failure !== undefined, `应报告no-capable-loom，实际: ${JSON.stringify(result.failures)}`);
    if (failure.kind === 'no-capable-loom') {
      assertEq(failure.opId, 'D1', '无可用织机的工序');
      assertEq(failure.operationType, 'coat', '无覆盖的工序类型');
    }
  });
});

let passed = 0;
let failed = 0;
const failureDetails: { suite: string; name: string; message: string }[] = [];

console.log('织造排产与工时推演 · 离线验证');
console.log('================================');
for (const s of suites) {
  console.log(`\n[套件] ${s.name}`);
  for (const c of s.cases) {
    try {
      c.fn();
      passed += 1;
      console.log(`  ✓ ${c.name}`);
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      failureDetails.push({ suite: s.name, name: c.name, message });
      console.log(`  ✗ ${c.name}`);
      for (const line of message.split('\n')) {
        console.log(`    ${line}`);
      }
    }
  }
}

console.log('\n================================');
console.log(`汇总: ${passed} 通过 / ${failed} 失败，共 ${passed + failed} 条`);
if (failed > 0) {
  console.log('失败用例:');
  for (const f of failureDetails) {
    console.log(`  - [${f.suite}] ${f.name}`);
  }
  process.exitCode = 1;
}
