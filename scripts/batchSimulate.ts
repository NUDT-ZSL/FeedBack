import {
  DEFAULT_SEED,
  LIMITS,
  STAGE_LABELS,
  WorkshopEngine,
  type HistoryRecordV2,
  type Operation,
  type Recipe,
  parseHistoryRecord,
} from '../src/simulation/index.ts';

interface Scenario {
  name: string;
  recipe: Recipe;
  operations: Operation[];
}

const scenarios: Scenario[] = [
  {
    name: '正常流程：合格配料 + 充足搅拌 + 合适力度 + 完整干燥 + 5 检验点',
    recipe: { bark: 20, bamboo: 30, water: 350 },
    operations: [
      { type: 'mix', duration: 60 },
      { type: 'form', scoops: 3 },
      { type: 'press', force: 50 },
      { type: 'dry', ticks: 10 },
      { type: 'inspect', points: 5 },
    ],
  },
  {
    name: '边界：配料总量低于下限',
    recipe: { bark: 5, bamboo: 5, water: 20 },
    operations: [
      { type: 'mix', duration: 30 },
      { type: 'form', scoops: 1 },
      { type: 'press', force: 50 },
      { type: 'dry', ticks: 10 },
      { type: 'inspect', points: 3 },
    ],
  },
  {
    name: '边界：配料总量超过上限',
    recipe: { bark: 120, bamboo: 130, water: 300 },
    operations: [
      { type: 'mix', duration: 60 },
      { type: 'form', scoops: 2 },
      { type: 'press', force: 60 },
      { type: 'dry', ticks: 10 },
      { type: 'inspect', points: 3 },
    ],
  },
  {
    name: '边界：压榨力度低于下限',
    recipe: { bark: 20, bamboo: 30, water: 350 },
    operations: [
      { type: 'mix', duration: 60 },
      { type: 'form', scoops: 3 },
      { type: 'press', force: 10 },
      { type: 'dry', ticks: 25 },
      { type: 'inspect', points: 4 },
    ],
  },
  {
    name: '边界：压榨力度超过上限',
    recipe: { bark: 20, bamboo: 30, water: 350 },
    operations: [
      { type: 'mix', duration: 60 },
      { type: 'form', scoops: 3 },
      { type: 'press', force: 95 },
      { type: 'dry', ticks: 25 },
      { type: 'inspect', points: 4 },
    ],
  },
  {
    name: '边界：干燥未完成即检验',
    recipe: { bark: 20, bamboo: 30, water: 350 },
    operations: [
      { type: 'mix', duration: 60 },
      { type: 'form', scoops: 3 },
      { type: 'press', force: 50 },
      { type: 'dry', ticks: 6 },
      { type: 'inspect', points: 5 },
    ],
  },
  {
    name: '边界：检验点超过上限（8 个，上限 5）',
    recipe: { bark: 20, bamboo: 30, water: 350 },
    operations: [
      { type: 'mix', duration: 60 },
      { type: 'form', scoops: 3 },
      { type: 'press', force: 50 },
      { type: 'dry', ticks: 10 },
      { type: 'inspect', points: 8 },
    ],
  },
  {
    name: '边界：环节乱序（未配料直接压榨，应被忽略并记录）',
    recipe: { bark: 20, bamboo: 30, water: 350 },
    operations: [
      { type: 'press', force: 50 },
      { type: 'mix', duration: 60 },
      { type: 'form', scoops: 3 },
      { type: 'press', force: 50 },
      { type: 'dry', ticks: 10 },
      { type: 'inspect', points: 3 },
    ],
  },
  {
    name: '正常流程：晾晒分两次推进至干燥完成',
    recipe: { bark: 18, bamboo: 26, water: 320 },
    operations: [
      { type: 'mix', duration: 45 },
      { type: 'form', scoops: 2 },
      { type: 'press', force: 45 },
      { type: 'dry', ticks: 5 },
      { type: 'dry', ticks: 5 },
      { type: 'inspect', points: 5 },
    ],
  },
];

function formatIntermediates(state: ReturnType<WorkshopEngine['getState']>): string {
  const inter = state.intermediates;
  return [
    `浓度=${inter.concentration ?? '—'}`,
    `均匀度=${inter.uniformity ?? '—'}`,
    `压榨力度=${inter.pressForce ?? '—'}(${inter.pressEffective ? '有效' : '无效'})`,
    `干燥进度=${inter.dryness}%`,
    `检验得分=${inter.inspectScore ?? '—'}`,
  ].join('  ');
}

function runScenario(scenario: Scenario) {
  const engine = new WorkshopEngine(scenario.recipe, { seed: DEFAULT_SEED });
  const lines: string[] = [];
  for (const operation of scenario.operations) {
    const result = engine.apply(operation);
    const label = STAGE_LABELS[operation.type];
    lines.push(`  [${label}] 参数=${JSON.stringify(operation)}`);
    lines.push(`        中间量: ${formatIntermediates(result.state)}`);
    if (result.events.length > 0) {
      for (const event of result.events) {
        lines.push(`        ⚠ ${event.code}: ${event.message}`);
      }
    }
  }
  const state = engine.getState();
  const conclusion = state.conclusion;
  lines.push(
    `  => 最终结论: ${conclusion ? conclusion.rating : '未定级'}  得分=${
      conclusion?.score ?? '—'
    }  有效=${conclusion?.valid ?? false}`,
  );
  if (conclusion?.reasons.length) {
    for (const reason of conclusion.reasons) lines.push(`     依据: ${reason}`);
  }
  return { state, lines };
}

function stableSnapshot(scenario: Scenario): string {
  const engine = new WorkshopEngine(scenario.recipe, { seed: DEFAULT_SEED });
  for (const operation of scenario.operations) engine.apply(operation);
  return JSON.stringify(engine.getState());
}

function snapshotEngineOnly(scenario: Scenario): string {
  const engine = new WorkshopEngine(scenario.recipe);
  for (const operation of scenario.operations) engine.apply(operation);
  return JSON.stringify(engine.getState());
}

function verifyLegacyMigration(): string {
  const legacy = {
    id: 'old-1',
    time: 1700000000000,
    score: 88,
    level: '乙',
    recipe: { bark: 10, bamboo: 20, water: 200 },
  };
  const migrated = parseHistoryRecord(legacy) as HistoryRecordV2;
  return `旧版记录迁移: id=${migrated.id} 评级=${migrated.conclusion.rating} 得分=${migrated.conclusion.score}`;
}

let mismatch = false;
console.log(`造纸作坊批量推演（固定种子=${DEFAULT_SEED}，共 ${scenarios.length} 组序列）\n`);
scenarios.forEach((scenario, index) => {
  console.log(`场景 ${index + 1}: ${scenario.name}`);
  console.log(`  配料: ${JSON.stringify(scenario.recipe)}`);
  const { lines } = runScenario(scenario);
  for (const line of lines) console.log(line);

  const first = stableSnapshot(scenario);
  const second = stableSnapshot(scenario);
  const defaultSeeded = snapshotEngineOnly(scenario);
  const consistent = first === second;
  const defaultConsistent = first === defaultSeeded;
  if (!consistent || !defaultConsistent) mismatch = true;
  console.log(
    `  确定性: 重复推演${consistent ? '一致' : '不一致'}  默认随机源${
      defaultConsistent ? '一致' : '不一致'
    }\n`,
  );
});

console.log(verifyLegacyMigration());
console.log(`\n规则上限: 配料总量[${LIMITS.RECIPE_TOTAL_MIN}, ${LIMITS.RECIPE_TOTAL_MAX}]  压榨力度[${LIMITS.PRESS_FORCE_MIN}, ${LIMITS.PRESS_FORCE_MAX}]  检验点上限 ${LIMITS.MAX_INSPECT_POINTS}  干燥目标 ${LIMITS.DRY_TARGET}%`);
if (mismatch) {
  console.error('\n错误: 同一输入重复推演结果不一致');
  process.exit(1);
}
console.log('\n全部场景推演完成，结果确定且可复现。');
