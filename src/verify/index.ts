/**
 * 排产推演离线验证入口。
 *
 * 用法：npm run verify（等价于 node src/verify/index.ts）
 * 纯 Node 运行，无网络、无外部服务依赖；任一检查失败时退出码为 1。
 *
 * 失败分类：
 * - SCHEDULE 排布结论错
 * - COST     代价结论错
 * - SCOPE    受影响范围漏推
 */
import { applyChange, deriveSchedule, reschedulePartial } from '../scheduling/engine.ts';
import type { Plan } from '../scheduling/types.ts';
import { checkPinsPreserved, checkScope, diffPlans, type Finding } from './harness.ts';
import { scenarios, type Scenario } from './scenarios.ts';

function runScenario(scenario: Scenario): Finding[] {
  const findings: Finding[] = [];
  // 基线推导不带裁决 pins；pins 只作用于变更后的重推
  const base = deriveSchedule(scenario.input);

  if (scenario.expectedError) {
    if (base.ok) {
      findings.push({
        scenario: scenario.id,
        class: 'SCHEDULE',
        message: `期望整体推导失败(${scenario.expectedError})，实际成功`,
      });
    } else if (base.error.code !== scenario.expectedError) {
      findings.push({
        scenario: scenario.id,
        class: 'SCHEDULE',
        message: `期望错误码 ${scenario.expectedError}，实际 ${base.error.code}（${base.error.message}）`,
      });
    }
    return findings;
  }

  if (!base.ok) {
    findings.push({
      scenario: scenario.id,
      class: 'SCHEDULE',
      message: `整体推导意外失败：${base.error.code}（${base.error.message}）`,
    });
    return findings;
  }

  if (scenario.expectedPlan) {
    findings.push(...diffPlans(scenario.id, scenario.expectedPlan, base.plan, '整体推导'));
  }

  if (!scenario.change) return findings;

  const partial = reschedulePartial(scenario.input, base.plan, {
    change: scenario.change,
    pins: scenario.pins,
  });
  const fullInput = applyChange(scenario.input, scenario.change);
  const full = deriveSchedule(fullInput, scenario.pins ?? []);

  if (scenario.expectedPartialError) {
    if (partial.ok) {
      findings.push({
        scenario: scenario.id,
        class: 'SCHEDULE',
        message: `期望局部重推失败(${scenario.expectedPartialError})，实际成功`,
      });
    } else if (partial.error.code !== scenario.expectedPartialError) {
      findings.push({
        scenario: scenario.id,
        class: 'SCHEDULE',
        message: `局部重推期望错误码 ${scenario.expectedPartialError}，实际 ${partial.error.code}（${partial.error.message}）`,
      });
    }
    if (full.ok || full.error.code !== scenario.expectedPartialError) {
      findings.push({
        scenario: scenario.id,
        class: 'SCHEDULE',
        message: `整体重排与局部重推的错误结论不一致：整体=${full.ok ? '成功' : full.error.code}，期望=${scenario.expectedPartialError}`,
      });
    }
    return findings;
  }

  if (!partial.ok) {
    findings.push({
      scenario: scenario.id,
      class: 'SCHEDULE',
      message: `局部重推意外失败：${partial.error.code}（${partial.error.message}）`,
    });
    return findings;
  }
  if (!full.ok) {
    findings.push({
      scenario: scenario.id,
      class: 'SCHEDULE',
      message: `局部重推成功但整体重排失败：${full.error.code}（${full.error.message}）`,
    });
    return findings;
  }

  // 局部重推结论必须与同等裁决条件下的整体重排一致
  findings.push(...diffPlans(scenario.id, full.plan, partial.plan, '局部重推 vs 整体重排'));
  // 局部重推结论必须与人工参考结论一致
  if (scenario.expectedPartialPlan) {
    findings.push(...diffPlans(scenario.id, scenario.expectedPartialPlan, partial.plan, '局部重推 vs 参考结论'));
  }
  // 受影响范围：相对基线发生变化的工序不得漏推
  findings.push(...checkScope(scenario.id, base.plan, partial.plan, partial.affected, scenario.pins ?? []));
  // 冲突来源保留：钉住工序不得被改动
  findings.push(...checkPinsPreserved(scenario.id, scenario.pins ?? [], partial.plan));

  if (scenario.expectedAffected) {
    const expected = [...scenario.expectedAffected].sort();
    const actual = [...partial.affected].sort();
    if (expected.join(',') !== actual.join(',')) {
      findings.push({
        scenario: scenario.id,
        class: 'SCOPE',
        message: `受影响集合不一致，期望 [${expected.join(', ')}]，实际 [${actual.join(', ')}]`,
      });
    }
  }

  return findings;
}

/**
 * 变异自检：验证“比较器本身”能稳定区分三类失败。
 * 若自检失效，说明验证装置无法观察到边界破坏，必须报失败。
 */
function runMutationSelfCheck(): Finding[] {
  const findings: Finding[] = [];
  const scenario = scenarios.find((item) => item.id === 'E-window-shrink')!;
  const base = deriveSchedule(scenario.input);
  if (!base.ok || !scenario.change) {
    findings.push({ scenario: 'self-check', class: 'SCHEDULE', message: '自检场景初始化失败' });
    return findings;
  }
  const partial = reschedulePartial(scenario.input, base.plan, { change: scenario.change });
  const full = deriveSchedule(applyChange(scenario.input, scenario.change));
  if (!partial.ok || !full.ok) {
    findings.push({ scenario: 'self-check', class: 'SCHEDULE', message: '自检场景重推失败' });
    return findings;
  }

  const tamperedSchedule: Plan = {
    ...partial.plan,
    assignments: partial.plan.assignments.map((item) =>
      item.opId === 'O1' ? { ...item, start: item.start + 1, end: item.end + 1 } : item,
    ),
  };
  if (!diffPlans('self-check', full.plan, tamperedSchedule, '变异').some((f) => f.class === 'SCHEDULE')) {
    findings.push({ scenario: 'self-check', class: 'SCHEDULE', message: '排布变异未被识别为 SCHEDULE' });
  }

  const tamperedCost: Plan = { ...partial.plan, totalCost: partial.plan.totalCost + 1 };
  if (!diffPlans('self-check', full.plan, tamperedCost, '变异').some((f) => f.class === 'COST')) {
    findings.push({ scenario: 'self-check', class: 'COST', message: '代价变异未被识别为 COST' });
  }

  const shrunkAffected = partial.affected.filter((id) => id !== 'O1');
  if (!checkScope('self-check', base.plan, partial.plan, shrunkAffected, []).some((f) => f.class === 'SCOPE')) {
    findings.push({ scenario: 'self-check', class: 'SCOPE', message: '受影响范围漏推变异未被识别为 SCOPE' });
  }

  return findings;
}

function main(): void {
  const allFindings: Finding[] = [];
  let passed = 0;

  for (const scenario of scenarios) {
    const findings = runScenario(scenario);
    allFindings.push(...findings);
    if (findings.length === 0) {
      passed += 1;
      console.log(`PASS ${scenario.id} ${scenario.title}`);
    } else {
      console.log(`FAIL ${scenario.id} ${scenario.title}`);
      for (const finding of findings) {
        console.log(`  [${finding.class}] ${finding.message}`);
      }
    }
  }

  const selfCheckFindings = runMutationSelfCheck();
  allFindings.push(...selfCheckFindings);
  if (selfCheckFindings.length === 0) {
    console.log('PASS self-check 验证装置可区分 SCHEDULE / COST / SCOPE 三类失败');
  } else {
    console.log('FAIL self-check');
    for (const finding of selfCheckFindings) {
      console.log(`  [${finding.class}] ${finding.message}`);
    }
  }

  const byClass = (cls: string): number => allFindings.filter((f) => f.class === cls).length;
  console.log('');
  console.log(
    `场景 ${passed}/${scenarios.length} 通过；发现 ${allFindings.length} 个问题` +
      `（SCHEDULE=${byClass('SCHEDULE')} COST=${byClass('COST')} SCOPE=${byClass('SCOPE')}）`,
  );
  if (allFindings.length > 0) process.exit(1);
}

main();
