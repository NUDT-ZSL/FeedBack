/**
 * 浑天仪推演离线批量验证入口。
 *
 * 运行：npm run verify
 * 行为：顺序执行全部场景，输出可读的通过/失败结论；
 *       失败信息定位到具体 tick 与星体；任一失败以非零码退出。
 * 约束：完全离线，不访问网络，不依赖浏览器或外部星历服务。
 */

import { runScenario, ScenarioResult } from './harness';
import { determinismScenario } from './scenarios/01-determinism';
import { rewindReplayScenario } from './scenarios/02-rewind-replay';
import { horizonScenario } from './scenarios/03-horizon';
import { occultationScenario } from './scenarios/04-occultation';
import { completionConsistencyScenario } from './scenarios/05-completion-consistency';
import { longRunScenario } from './scenarios/06-long-run';

const scenarios: Array<[string, (ctx: import('./harness').CheckContext) => void]> = [
  ['01 重复推演确定性', determinismScenario],
  ['02 时间轴回退重放一致性', rewindReplayScenario],
  ['03 地平线遮挡判定', horizonScenario],
  ['04 星体互掩与临界相切', occultationScenario],
  ['05 可见性与完成度一致性', completionConsistencyScenario],
  ['06 长程推进统计无漂移', longRunScenario],
];

const results: ScenarioResult[] = [];
for (const [name, fn] of scenarios) {
  results.push(runScenario(name, fn));
}

let totalChecks = 0;
let totalFailures = 0;

console.log('');
console.log('浑天仪推演离线验证报告');
console.log('='.repeat(60));

for (const r of results) {
  totalChecks += r.checks;
  totalFailures += r.failures.length;
  const status = r.failures.length === 0 ? '通过' : '失败';
  console.log(
    `[${status}] ${r.name}  —  ${r.checks} 项检查，${r.failures.length} 项失败（${r.elapsedMs}ms）`,
  );
  for (const f of r.failures.slice(0, 20)) {
    console.log(`    ✗ ${f.message}`);
  }
  if (r.failures.length > 20) {
    console.log(`    … 其余 ${r.failures.length - 20} 项失败从略`);
  }
}

console.log('='.repeat(60));
console.log(
  `合计：${results.length} 个场景，${totalChecks} 项检查，${totalFailures} 项失败`,
);
console.log(totalFailures === 0 ? '结论：全部通过' : '结论：存在失败，请根据上方 tick/星体定位排查');
console.log('');

process.exit(totalFailures === 0 ? 0 : 1);
