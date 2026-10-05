/**
 * 离线批量推演入口：使用固定输入序列覆盖正常流程与全部边界情形，
 * 逐项输出中间量（浓度/均匀度/压榨力度/干燥进度/检验点）、边界事件与最终评级。
 *
 * 运行：npm run simulate
 */
declare const process: { exit(code: number): void };

import {
  runSimulation,
  createSeededRandom,
  type WorkshopOperation,
  type SimulationState,
  type SimulationStep,
  type MaterialType,
} from '../src/simulation/engine.ts';

interface Scenario {
  name: string;
  seed: number;
  operations: WorkshopOperation[];
}

const add = (material: MaterialType, amount: number): WorkshopOperation => ({
  type: 'addMaterial',
  material,
  amount,
});
const inspects = (count: number): WorkshopOperation[] =>
  Array.from({ length: count }, () => ({ type: 'inspect' }) as WorkshopOperation);

const normalFlow = (pressLevel?: number): WorkshopOperation[] => [
  { type: 'scoop' },
  pressLevel === undefined ? { type: 'press' } : { type: 'press', pressLevel },
  { type: 'advanceDrying', drynessDelta: 100 },
  ...inspects(10),
  { type: 'finalize' },
];

const scenarios: Scenario[] = [
  {
    name: '正常流程：默认配料（浓度50），完整抄纸-压榨-晾晒-检验',
    seed: 42,
    operations: normalFlow(),
  },
  {
    name: '正常流程：浓度偏低（降至30）',
    seed: 42,
    operations: [add('chuPi', -20), ...normalFlow()],
  },
  {
    name: '边界：配料单项与总量越界（三种原料均+50，总量150）',
    seed: 42,
    operations: [
      add('chuPi', 50),
      add('sangPi', 50),
      add('maXianWei', 50),
      ...normalFlow(),
    ],
  },
  {
    name: '边界：压榨力度低于合理区间（62 < 70）',
    seed: 42,
    operations: normalFlow(62),
  },
  {
    name: '边界：压榨力度高于合理区间（96 > 90）',
    seed: 42,
    operations: normalFlow(96),
  },
  {
    name: '边界：干燥未完成（60%）即检验并定级',
    seed: 42,
    operations: [
      { type: 'scoop' },
      { type: 'press' },
      { type: 'advanceDrying', drynessDelta: 30 },
      { type: 'inspect' },
      { type: 'finalize' },
    ],
  },
  {
    name: '边界：检验点超过上限（点击12次，上限10）',
    seed: 42,
    operations: [
      { type: 'scoop' },
      { type: 'press' },
      { type: 'advanceDrying', drynessDelta: 100 },
      ...inspects(12),
      { type: 'finalize' },
    ],
  },
  {
    name: '边界：未抄纸即检验（操作乱序，应被拒绝）',
    seed: 42,
    operations: [{ type: 'inspect' }, ...normalFlow()],
  },
];

const GRADE_LABEL: Record<string, string> = {
  excellent: '优',
  good: '良',
  medium: '中',
  poor: '差',
};

function describeOperation(operation: WorkshopOperation): string {
  switch (operation.type) {
    case 'addMaterial':
      return `调整原料 ${operation.material} ${operation.amount > 0 ? '+' : ''}${operation.amount}`;
    case 'scoop':
      return '抄纸';
    case 'press':
      return operation.pressLevel === undefined
        ? '压榨（随机力度）'
        : `压榨（指定力度 ${operation.pressLevel}）`;
    case 'advanceDrying':
      return `晾晒推进 +${operation.drynessDelta ?? 100}%`;
    case 'inspect':
      return '检验打点';
    case 'finalize':
      return '定级';
  }
}

function formatState(state: SimulationState): string {
  const uniformity = state.uniformity === null ? '-' : state.uniformity.toFixed(1);
  const pressLevel = state.pressLevel === null ? '-' : state.pressLevel.toFixed(2);
  return (
    `阶段=${state.stage} 浓度=${state.concentration}% 均匀度=${uniformity}% ` +
    `压榨=${pressLevel}% 干燥=${state.dryness}% 检验点=${state.inspectionPoints}/10`
  );
}

function printStep(step: SimulationStep, index: number): void {
  const issues = step.issues
    .map((issue) => `${issue.code}: ${issue.message}`)
    .join(' | ');
  console.log(
    `  ${String(index + 1).padStart(2, ' ')}. ${describeOperation(step.operation)} ` +
      `[${step.applied ? '已应用' : '已拒绝'}] ${formatState(step.state)}`
  );
  if (issues) {
    console.log(`      ⚠ ${issues}`);
  }
}

let failures = 0;

for (const scenario of scenarios) {
  console.log(`\n■ ${scenario.name}`);
  const run = runSimulation(scenario.operations, {
    random: createSeededRandom(scenario.seed),
    idGenerator: (() => {
      let counter = 0;
      return () => `paper-${++counter}`;
    })(),
  });
  run.steps.forEach(printStep);
  const { result } = run.finalState;
  if (result) {
    console.log(`  => 最终结论：${GRADE_LABEL[result.grade]}（得分 ${result.score}）`);
  } else {
    console.log('  => 最终结论：未定级（流程未完成）');
  }
}

console.log('\n■ 确定性校验：同一输入序列与种子重复推演两次');
const fixedOperations = scenarios[0].operations;
const first = JSON.stringify(
  runSimulation(fixedOperations, {
    random: createSeededRandom(42),
    idGenerator: (() => {
      let counter = 0;
      return () => `paper-${++counter}`;
    })(),
  })
);
const second = JSON.stringify(
  runSimulation(fixedOperations, {
    random: createSeededRandom(42),
    idGenerator: (() => {
      let counter = 0;
      return () => `paper-${++counter}`;
    })(),
  })
);
if (first === second) {
  console.log('  PASS：两次推演轨迹完全一致');
} else {
  console.log('  FAIL：两次推演结果不一致');
  failures += 1;
}

const otherSeed = JSON.stringify(
  runSimulation(fixedOperations, { random: createSeededRandom(7) })
);
console.log(
  first !== otherSeed
    ? '  PASS：更换种子后随机中间量随之变化（随机源可注入生效）'
    : '  WARN：不同种子未产生差异（检查随机源接入）'
);

if (failures > 0) {
  process.exit(1);
}
