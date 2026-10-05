/**
 * 离线批量推演入口：
 *   npm run simulate            人类可读输出
 *   npm run simulate -- --json  JSON 输出
 *
 * 不依赖真实计时与 Math.random：所有随机因素由固定 seed 的伪随机序列注入，
 * 同一组输入重复推演结果完全一致。
 */
import {
  createInitialState,
  createSeededRng,
  runSimulation,
  calculateQualityScore,
  DEFAULT_MATERIALS,
  MAX_INSPECTION_POINTS,
  type SimOperation,
  type SimState,
  type SimTraceEntry,
} from '../src/simulation/index';
import { parseHistoryRecords } from '../src/simulation/history';

interface Scenario {
  name: string;
  description: string;
  seed: number;
  operations: SimOperation[];
}

const inspectTen: SimOperation[] = Array.from({ length: MAX_INSPECTION_POINTS }, () => ({
  type: 'inspect',
}));

const scenarios: Scenario[] = [
  {
    name: '正常流程',
    description: '默认配料(楮皮20 桑皮20 麻纤维10) → 抄纸 → 压榨 → 晾晒至100% → 10 点检验 → 评定',
    seed: 20261005,
    operations: [
      { type: 'scoop' },
      { type: 'press' },
      { type: 'dry', dryness: 65 },
      { type: 'dry', dryness: 100 },
      ...inspectTen,
      { type: 'finalize' },
    ],
  },
  {
    name: '边界-配料总量越界',
    description: '单种原料 +40 触发单项越界(>50)；三种各 +50 使总量越界(>100)',
    seed: 1,
    operations: [
      { type: 'addMaterial', material: 'chuPi', amount: 40 },
      { type: 'addMaterial', material: 'sangPi', amount: 50 },
      { type: 'addMaterial', material: 'maXianWei', amount: 50 },
      { type: 'scoop' },
      { type: 'press' },
      { type: 'dry', dryness: 100 },
      ...inspectTen,
      { type: 'finalize' },
    ],
  },
  {
    name: '边界-压榨力度过低',
    description: '强制压榨力度 40，低于合理区间 [70,90]，工序继续但得分受影响',
    seed: 7,
    operations: [
      { type: 'scoop' },
      { type: 'press', force: 40 },
      { type: 'dry', dryness: 100 },
      ...inspectTen,
      { type: 'finalize' },
    ],
  },
  {
    name: '边界-压榨力度过高',
    description: '强制压榨力度 110，高于合理区间 [70,90]，工序继续但得分受影响',
    seed: 7,
    operations: [
      { type: 'scoop' },
      { type: 'press', force: 110 },
      { type: 'dry', dryness: 100 },
      ...inspectTen,
      { type: 'finalize' },
    ],
  },
  {
    name: '边界-干燥未完成即检验',
    description: '干燥只到 45% 即检验 10 点并评定，结论体现干燥不足',
    seed: 42,
    operations: [
      { type: 'scoop' },
      { type: 'press' },
      { type: 'dry', dryness: 45 },
      ...inspectTen,
      { type: 'finalize' },
    ],
  },
  {
    name: '边界-检验点超过上限',
    description: '晒干后连续检验 12 次，第 11、12 次被拒绝并给出可观察标记',
    seed: 99,
    operations: [
      { type: 'scoop' },
      { type: 'press' },
      { type: 'dry', dryness: 100 },
      ...inspectTen,
      { type: 'inspect' },
      { type: 'inspect' },
      { type: 'finalize' },
    ],
  },
  {
    name: '边界-非法工序顺序',
    description: '未抄纸先压榨；重复抄纸；未压榨先晾晒 —— 均应被拒绝并留痕',
    seed: 3,
    operations: [
      { type: 'press' },
      { type: 'scoop' },
      { type: 'scoop' },
      { type: 'dry', dryness: 100 },
    ],
  },
];

function describeState(state: SimState): string {
  const parts = [
    `浓度=${round1(state.concentration)}%`,
    `配料={楮皮:${state.materials.chuPi},桑皮:${state.materials.sangPi},麻纤维:${state.materials.maXianWei}}`,
  ];
  if (state.paper) {
    parts.push(
      `阶段=${state.paper.stage}`,
      `均匀度=${round1(state.paper.uniformity)}%`,
      `压榨力度=${round1(state.paper.pressLevel)}`,
      `干燥进度=${round1(state.paper.dryness)}%`,
      `检验点=${state.paper.inspectionPoints}`
    );
  }
  if (state.result) {
    parts.push(`得分=${state.result.score}`, `评级=${state.result.grade}`);
  }
  return parts.join(' ');
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function runScenario(scenario: Scenario) {
  const rng = createSeededRng(scenario.seed);
  return runSimulation(scenario.operations, { rng, initial: createInitialState({ ...DEFAULT_MATERIALS }) });
}

function printScenario(scenario: Scenario): void {
  const outcome = runScenario(scenario);
  console.log('='.repeat(78));
  console.log(`【${scenario.name}】 ${scenario.description}`);
  console.log(`seed=${scenario.seed}  操作数=${scenario.operations.length}`);
  console.log('-'.repeat(78));
  outcome.trace.forEach((entry: SimTraceEntry, index: number) => {
    const opName = JSON.stringify(entry.op);
    console.log(`#${index + 1} ${entry.applied ? '已执行' : '已拒绝'}  ${opName}`);
    entry.violations.forEach((v) => {
      console.log(`      ⚠ [${v.type}] ${v.message}`);
    });
    console.log(`      → ${describeState(entry.state)}`);
  });

  const { finalState } = outcome;
  if (finalState.paper) {
    const breakdown = calculateQualityScore(
      finalState.concentration,
      finalState.paper.uniformity,
      finalState.paper.dryness,
      finalState.paper.pressLevel,
      finalState.paper.inspectionPoints
    );
    console.log('-'.repeat(78));
    console.log(
      `得分推导: 浓度项=${round1(breakdown.concentrationScore)}×0.25 + ` +
        `均匀度项=${round1(breakdown.uniformityScore)}×0.30 + ` +
        `干燥项=${round1(breakdown.drynessScore)}×0.20 + ` +
        `压榨项=${round1(breakdown.pressScore)}×0.15 + ` +
        `检验加分=${round1(breakdown.inspectionBonus)}`
    );
  }
  console.log(
    `最终结论: ${finalState.result ? `${finalState.result.score}分 / ${finalState.result.grade}` : '本序列未产出成品（无最终结论）'}`
  );
  console.log('');
}

function legacyCompatCheck(): string[] {
  const notes: string[] = [];
  const oldShape = JSON.stringify([
    {
      // 模拟历史上已经保存的旧记录（缺字段、且夹带未知字段）
      id: 'abc123',
      timestamp: 1730000000000,
      materials: { chuPi: 25, sangPi: 15, maXianWei: 10 },
      score: 82,
      grade: 'good',
    },
    { broken: 'not a record' },
    'garbage',
    null,
  ]);
  const parsed = parseHistoryRecords(oldShape);
  const first = parsed[0];
  const ok =
    parsed.length === 1 &&
    first.score === 82 &&
    first.grade === 'good' &&
    first.concentration === 50 &&
    first.uniformity === 0 &&
    first.dryness === 0 &&
    first.pressLevel === 0;
  notes.push(
    `旧记录解析: ${ok ? '通过' : '失败'}（4 条输入中解析出 ${parsed.length} 条，缺失字段补默认值，坏记录跳过）`
  );

  const corrupted = parseHistoryRecords('not-json{');
  notes.push(`损坏存储解析: ${corrupted.length === 0 ? '通过' : '失败'}（返回空列表而非抛错）`);
  return notes;
}

function determinismCheck(): string {
  const a = runScenario(scenarios[0]);
  const b = runScenario(scenarios[0]);
  const equal = JSON.stringify(a) === JSON.stringify(b);
  return `重复推演一致性: ${equal ? '通过' : '失败'}（正常流程用相同 seed 连推两次，trace 完全一致=${equal}）`;
}

const asJson = process.argv.includes('--json');

if (asJson) {
  const output = scenarios.map((scenario) => ({
    name: scenario.name,
    seed: scenario.seed,
    ...runScenario(scenario),
  }));
  console.log(JSON.stringify(output, null, 2));
} else {
  scenarios.forEach(printScenario);
  console.log('#'.repeat(78));
  console.log('# 自检');
  console.log('#'.repeat(78));
  console.log(determinismCheck());
  legacyCompatCheck().forEach((note) => console.log(note));
}
