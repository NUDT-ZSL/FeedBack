/**
 * 铜镜研磨 / 抛光逻辑链路的离线批量验证入口。
 *
 * 运行方式：npm run verify（等价于 node scripts/verify-simulation.ts）
 * 不渲染任何组件，直接以固定种子重放操作序列并断言每一步之后的确定状态。
 * 任一断言失败时进程以非零码退出。
 */
import {
  createGrindingEngine,
  runSimulation,
  computeReflectivity,
} from '../src/simulation/grindingEngine.ts';
import type {
  EngineEvent,
  MirrorState,
  StepResult,
} from '../src/simulation/grindingEngine.ts';
import {
  MAX_REFLECTIVITY,
  MIN_REFLECTIVITY,
  SCRATCH_THRESHOLD,
} from '../src/types/index.ts';
import type { GritType } from '../src/types/index.ts';

// ---------- 输入序列构造 ----------

interface StrokeOptions {
  startMs: number;
  durationMs: number;
  fps: number;
  force: (tMs: number) => number;
}

function grindStroke(
  grit: GritType,
  opts: StrokeOptions & { direction?: (tMs: number) => number }
): EngineEvent[] {
  const events: EngineEvent[] = [{ kind: 'startGrinding', time: opts.startMs, grit }];
  const stepMs = 1000 / opts.fps;
  const count = Math.round(opts.durationMs / stepMs);
  for (let i = 1; i <= count; i += 1) {
    const t = opts.startMs + i * stepMs;
    events.push({
      kind: 'grind',
      time: t,
      force: opts.force(t),
      direction: opts.direction ? opts.direction(t) : 90,
    });
  }
  events.push({ kind: 'stopGrinding', time: opts.startMs + count * stepMs });
  return events;
}

function polishStroke(opts: StrokeOptions): EngineEvent[] {
  const events: EngineEvent[] = [{ kind: 'startPolishing', time: opts.startMs }];
  const stepMs = 1000 / opts.fps;
  const count = Math.round(opts.durationMs / stepMs);
  for (let i = 1; i <= count; i += 1) {
    const t = opts.startMs + i * stepMs;
    events.push({ kind: 'polish', time: t, force: opts.force(t) });
  }
  events.push({ kind: 'stopPolishing', time: opts.startMs + count * stepMs });
  return events;
}

// ---------- 断言工具 ----------

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}\n        ${(err as Error).message}`);
  }
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function assertClose(actual: number, expected: number, eps: number, label: string): void {
  assert(
    Math.abs(actual - expected) <= eps,
    `${label}: |${actual} - ${expected}| > ${eps}`
  );
}

const FLOAT_FIELDS = [
  'grindingProgress',
  'uniformity',
  'reflectivity',
  'patternClarity',
  'polishProgress',
] as const;

/** 帧率无关性比较：浮点字段允许 1 ulp 级误差，整数字段与划痕序列必须完全一致。 */
function assertStatesEquivalent(a: MirrorState, b: MirrorState, eps: number, label: string): void {
  for (const field of FLOAT_FIELDS) {
    assertClose(a[field], b[field], eps, `${label}.${field}`);
  }
  assert(a.scratchCount === b.scratchCount, `${label}.scratchCount: ${a.scratchCount} !== ${b.scratchCount}`);
  assert(a.isDamaged === b.isDamaged, `${label}.isDamaged 不一致`);
  assert(a.currentGrit === b.currentGrit, `${label}.currentGrit 不一致`);
  assert(a.isPolishing === b.isPolishing, `${label}.isPolishing 不一致`);
  assert(
    JSON.stringify(a.scratches) === JSON.stringify(b.scratches),
    `${label}.scratches 划痕序列不一致`
  );
}

function last(results: StepResult[]): MirrorState {
  return results[results.length - 1].state;
}

// ---------- 场景 ----------

console.log('铜镜研磨模拟器 · 离线逻辑验证\n');

// 场景 1：粗磨高力度产生划痕并触发受损标记（固定种子）
const DAMAGE_SEED = 42;
const damageEvents = grindStroke(120, {
  startMs: 0,
  durationMs: 3000,
  fps: 60,
  force: () => 1.8,
});
const damageResults = runSimulation(damageEvents, DAMAGE_SEED);
const damagedState = last(damageResults);

check('粗磨力度超阈值产生划痕', () => {
  assert(damagedState.scratchCount > 0, '粗磨 3s 后应产生划痕');
});
check('划痕数量越过阈值触发受损标记', () => {
  assert(
    damagedState.scratchCount >= SCRATCH_THRESHOLD,
    `划痕数 ${damagedState.scratchCount} 应 >= ${SCRATCH_THRESHOLD}`
  );
  assert(damagedState.isDamaged === true, 'isDamaged 应为 true');
});
check('每步反射率都在合法区间内', () => {
  for (const { state } of damageResults) {
    assert(
      state.reflectivity >= MIN_REFLECTIVITY && state.reflectivity <= MAX_REFLECTIVITY,
      `反射率越界: ${state.reflectivity}`
    );
  }
});

// 场景 2：同一种子重放完全一致；不同种子划痕序列不同
check('固定种子重放结果逐步一致', () => {
  const replay = runSimulation(damageEvents, DAMAGE_SEED);
  assert(
    JSON.stringify(replay) === JSON.stringify(damageResults),
    '同种子两次重放的逐步结果应完全一致'
  );
});
check('不同种子产生不同划痕序列', () => {
  const other = last(runSimulation(damageEvents, DAMAGE_SEED + 1));
  assert(
    JSON.stringify(other.scratches) !== JSON.stringify(damagedState.scratches),
    '不同种子应产生不同的划痕序列'
  );
});

// 场景 3：受损后修复只发生在精磨或抛光阶段
const midGrindEvents = grindStroke(400, {
  startMs: 3000,
  durationMs: 2000,
  fps: 60,
  force: () => 1.2,
});
const polishRepairEvents = polishStroke({
  startMs: 5000,
  durationMs: 25000,
  fps: 60,
  force: () => 1.5,
});
const repairChain = [...damageEvents, ...midGrindEvents, ...polishRepairEvents];
const repairResults = runSimulation(repairChain, DAMAGE_SEED);
const afterMidGrind = repairResults[damageEvents.length + midGrindEvents.length - 1].state;
const afterPolishRepair = last(repairResults);

check('中磨阶段不发生修复', () => {
  assert(
    afterMidGrind.scratchCount === damagedState.scratchCount &&
      afterMidGrind.isDamaged === true,
    '400 目中磨不应改变划痕数量'
  );
});
check('抛光阶段修复划痕并解除受损标记', () => {
  assert(
    afterPolishRepair.scratchCount === 0,
    `抛光修复后划痕应清零，实际 ${afterPolishRepair.scratchCount}`
  );
  assert(afterPolishRepair.isDamaged === false, '修复完成后 isDamaged 应为 false');
});
check('精磨阶段同样发生修复', () => {
  const fineGrindEvents = grindStroke(1200, {
    startMs: 3000,
    durationMs: 150000,
    fps: 60,
    force: () => 2,
  });
  const results = runSimulation([...damageEvents, ...fineGrindEvents], DAMAGE_SEED);
  const finalState = last(results);
  assert(
    finalState.scratchCount === 0 && finalState.isDamaged === false,
    `1200 目精磨应修复全部划痕（剩余 ${finalState.scratchCount}）`
  );
});

// 场景 4：抛光推进抛光进度并提升反射率，反射率由研磨与抛光共同决定
check('抛光提升抛光进度与反射率', () => {
  const results = runSimulation(
    polishStroke({ startMs: 0, durationMs: 2000, fps: 60, force: () => 1 }),
    11
  );
  const finalState = last(results);
  assert(finalState.polishProgress > 0, '抛光进度应提升');
  assert(finalState.reflectivity > MIN_REFLECTIVITY, '反射率应高于下限');
  assertClose(
    finalState.reflectivity,
    computeReflectivity(finalState.grindingProgress, finalState.polishProgress),
    1e-9,
    '反射率应由研磨进度与抛光进度共同决定'
  );
});
check('研磨叠加抛光反射率更高', () => {
  const grindOnly = last(
    runSimulation(
      grindStroke(400, { startMs: 0, durationMs: 2000, fps: 60, force: () => 1 }),
      11
    )
  );
  const grindThenPolish = last(
    runSimulation(
      [
        ...grindStroke(400, { startMs: 0, durationMs: 2000, fps: 60, force: () => 1 }),
        ...polishStroke({ startMs: 2000, durationMs: 2000, fps: 60, force: () => 1 }),
      ],
      11
    )
  );
  assert(
    grindThenPolish.reflectivity > grindOnly.reflectivity,
    '研磨后追加抛光应进一步提升反射率'
  );
});

// 场景 5：同一输入序列（同一时刻-力度剖面）以不同帧率采样喂入，最终状态一致
function frameRateTimeline(fps: number): EngineEvent[] {
  return [
    ...grindStroke(120, {
      startMs: 0,
      durationMs: 4000,
      fps,
      force: () => 1.2,
      direction: () => 45,
    }),
    ...polishStroke({ startMs: 4000, durationMs: 3000, fps, force: () => 1.2 }),
    ...grindStroke(120, { startMs: 7000, durationMs: 3000, fps, force: () => 1.9, direction: () => 200 }),
    ...polishStroke({ startMs: 10000, durationMs: 4000, fps, force: () => 1.5 }),
  ];
}
check('同一序列不同帧率喂入结果一致', () => {
  const FRAME_RATES = [120, 60, 30, 17, 7];
  const EPS = 1e-8;
  const finals = FRAME_RATES.map((fps) => last(runSimulation(frameRateTimeline(fps), 7)));
  for (let i = 1; i < FRAME_RATES.length; i += 1) {
    assertStatesEquivalent(
      finals[0],
      finals[i],
      EPS,
      `${FRAME_RATES[0]}fps vs ${FRAME_RATES[i]}fps`
    );
  }
});

// 场景 6：边界输入给出稳定结果
check('目数为空时研磨事件为稳定无操作', () => {
  const engine = createGrindingEngine(99);
  const { state, effects } = engine.apply({ kind: 'grind', time: 0, force: 1, direction: 0 });
  assert(state.grindingProgress === 0 && state.reflectivity === MIN_REFLECTIVITY, '状态不应变化');
  assert(effects.scratchesAdded.length === 0 && effects.repairedCount === 0, '不应有副作用');
});
check('重复停止与未开始抛光为幂等无操作', () => {
  const engine = createGrindingEngine(99);
  engine.apply({ kind: 'stopGrinding', time: 10 });
  const before = JSON.stringify(engine.getState());
  engine.apply({ kind: 'stopGrinding', time: 20 });
  engine.apply({ kind: 'stopPolishing', time: 30 });
  engine.apply({ kind: 'polish', time: 40, force: 2 });
  assert(JSON.stringify(engine.getState()) === before, '状态应保持不变');
});
check('力度越界被钳制而非静默丢弃', () => {
  const run = (force: number) => {
    const engine = createGrindingEngine(5);
    engine.apply({ kind: 'startGrinding', time: 0, grit: 400 });
    return engine.apply({ kind: 'grind', time: 1000, force, direction: 10 }).state;
  };
  const negative = run(-3);
  assert(negative.grindingProgress === 0, '负力度应钳制为 0');
  const nanForce = run(Number.NaN);
  assert(nanForce.grindingProgress === 0, 'NaN 力度应钳制为 0');
  const huge = run(999);
  const atMax = run(2);
  assert(
    JSON.stringify(huge) === JSON.stringify(atMax),
    '超出上限的力度应与上限力度结果一致'
  );
});
check('时刻倒序不产生推进也不回拨时钟', () => {
  const engine = createGrindingEngine(5);
  engine.apply({ kind: 'startGrinding', time: 1000, grit: 400 });
  engine.apply({ kind: 'grind', time: 2000, force: 1, direction: 0 });
  const before = engine.getState().grindingProgress;
  engine.apply({ kind: 'grind', time: 500, force: 1, direction: 0 });
  assert(engine.getState().grindingProgress === before, '倒序时刻不应推进进度');
  engine.apply({ kind: 'grind', time: 3000, force: 1, direction: 0 });
  assert(
    engine.getState().grindingProgress > before,
    '时钟不应被倒序事件回拨，后续事件仍按真实间隔推进'
  );
});

// ---------- 抽样轨迹展示 ----------

console.log('\n抽样轨迹（场景 1，种子 42，每 500ms 一行）:');
console.log('  t(ms)  研磨%   均度%   反射率  清晰度  划痕  受损    抛光%');
damageResults.forEach(({ state }, index) => {
  const t = Math.round((index / (damageResults.length - 1)) * 3000);
  if (index % 30 === 0 || index === damageResults.length - 1) {
    console.log(
      `  ${String(t).padStart(5)}  ${state.grindingProgress.toFixed(2).padStart(6)}  ` +
        `${state.uniformity.toFixed(2).padStart(6)}  ${state.reflectivity.toFixed(2).padStart(6)}  ` +
        `${state.patternClarity.toFixed(2).padStart(6)}  ${String(state.scratchCount).padStart(4)}  ` +
        `${state.isDamaged ? '是' : '否'}     ${state.polishProgress.toFixed(2).padStart(6)}`
    );
  }
});

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) {
  process.exit(1);
}
