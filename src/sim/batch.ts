/**
 * 离线批量验证入口（无浏览器、无网络、无鼠标事件）：
 *   npm run sim:batch                     运行全部预设场景 + 边界检查
 *   npm run sim:batch -- --scenario=feeding-cleanup --out=traj.json   单场景并导出轨迹
 *   npm run sim:batch -- --verify=traj.json                           回放已有轨迹并比对
 *
 * 每个场景执行三类检查：
 *   1. 确定性：同一配置 + 输入跑两次，轨迹逐位一致；
 *   2. 可回放：用轨迹中的配置与输入离线重放，结果一致；
 *   3. 帧率无关：用可变帧间隔（模拟真实浏览器）推进，轨迹与固定步进一致。
 */
import { Simulation, STEP_DT } from './Simulation';
import { Rng } from './rng';
import { SCENARIOS, getScenario, type Scenario } from './scenarios';
import {
  compareTrajectories,
  deserializeTrajectory,
  hashTrajectory,
  replayTrajectory,
  serializeTrajectory
} from './trajectory';
import type { SimEvent, Trajectory } from './types';

declare const process: { argv: string[]; exitCode: number | undefined };

interface CheckResult {
  label: string;
  ok: boolean;
  detail: string;
}

function runScenarioOnce(scenario: Scenario): Trajectory {
  const sim = new Simulation(scenario.config, { record: true });
  for (const input of scenario.inputs) {
    sim.queueInput(input.event, input.step);
  }
  sim.run(scenario.steps);
  return sim.getTrajectory();
}

/** 用可变帧间隔推进（模拟浏览器 requestAnimationFrame），验证帧率无关性 */
function runScenarioWithFramePump(scenario: Scenario, seed: number): Trajectory {
  const sim = new Simulation(scenario.config, { record: true });
  for (const input of scenario.inputs) {
    sim.queueInput(input.event, input.step);
  }
  const frameRng = new Rng(seed);
  while (sim.currentStep < scenario.steps) {
    sim.advance(0.008 + frameRng.next() * 0.025);
  }
  // advance 单次调用可能推进多步，截取与固定步进运行相同的步数进行比较
  const trajectory = sim.getTrajectory();
  return { ...trajectory, steps: trajectory.steps.slice(0, scenario.steps) };
}

function checkScenario(scenario: Scenario): CheckResult[] {
  const results: CheckResult[] = [];

  const first = runScenarioOnce(scenario);
  const second = runScenarioOnce(scenario);
  const detDiff = compareTrajectories(first, second);
  results.push({
    label: '确定性（两次运行一致）',
    ok: detDiff.equal,
    detail: detDiff.equal ? `hash=${hashTrajectory(first)}` : detDiff.message
  });

  const replayed = replayTrajectory(first);
  const replayDiff = compareTrajectories(first, replayed);
  results.push({
    label: '可回放（离线重放一致）',
    ok: replayDiff.equal,
    detail: replayDiff.equal ? `hash=${hashTrajectory(replayed)}` : replayDiff.message
  });

  const pumped = runScenarioWithFramePump(scenario, 0xfeed);
  const pumpDiff = compareTrajectories(first, pumped);
  results.push({
    label: '帧率无关（可变帧间隔一致）',
    ok: pumpDiff.equal,
    detail: pumpDiff.equal ? `hash=${hashTrajectory(pumped)}` : pumpDiff.message
  });

  return results;
}

/** 边界检查 1：鱼群达到上限时繁殖被拒绝，且数量永不超过上限 */
function checkBreedingCap(): CheckResult {
  const sim = new Simulation({ seed: 555, width: 1280, height: 720, initialFish: 30 }, { record: true });
  const fm = sim.fishManager;
  const male = fm.fishes.find(f => f.gender === 'male');
  const female = fm.fishes.find(f => f.gender === 'female');
  if (!male || !female) {
    return { label: '繁殖上限', ok: false, detail: '初始鱼群缺少可配对个体' };
  }
  // 人为制造一对相邻、可繁殖的鱼
  male.x = 600; male.y = 400; male.canMate = true; male.mateCooldown = 0;
  female.x = 615; female.y = 400; female.canMate = true; female.mateCooldown = 0;

  sim.run(600);
  const events = sim.getTrajectory().steps.flatMap(s => s.events);
  const blocked = events.filter((e): e is Extract<SimEvent, { type: 'breedBlocked' }> => e.type === 'breedBlocked');
  const capBlocked = blocked.filter(e => e.reason === 'maxFishReached');
  const finalCount = fm.fishes.length;
  const ok = capBlocked.length > 0 && finalCount === fm.MAX_FISH;
  return {
    label: '繁殖上限',
    ok,
    detail: `鱼数=${finalCount}/${fm.MAX_FISH}，上限拒绝事件=${capBlocked.length} 次`
  };
}

/** 边界检查 2：食物被吃完或过期/沉底后都会被清理 */
function checkFoodCleanup(): CheckResult {
  const sim = new Simulation({ seed: 66, width: 1280, height: 720, initialFish: 0 }, { record: true });
  sim.queueInput({ type: 'addFood', x: 640, y: 100 }, 5);   // 高处撒食：15 秒寿命到期 → expired
  sim.queueInput({ type: 'addFood', x: 640, y: 660 }, 5);  // 低处撒食：很快沉底 → sank
  sim.run(1200);
  const events = sim.getTrajectory().steps.flatMap(s => s.events);
  const removed = events.filter((e): e is Extract<SimEvent, { type: 'foodRemoved' }> => e.type === 'foodRemoved');
  const reasons = new Set(removed.map(r => r.reason));
  const ok = fm_foodCount(sim) === 0 && removed.length === 6 && reasons.has('expired') && reasons.has('sank');
  return {
    label: '食物清理',
    ok,
    detail: `剩余食物=${fm_foodCount(sim)}，清理事件=${removed.length}（原因: ${[...reasons].join('/') || '无'}）`
  };
}

function fm_foodCount(sim: Simulation): number {
  return sim.fishManager.foods.length;
}

/** 边界检查 3：越界装饰物被夹取回鱼缸范围内，且位置确定 */
function checkDecorationClamp(): CheckResult {
  const run = () => {
    const sim = new Simulation({ seed: 9, width: 1280, height: 720, initialFish: 0 }, { record: true });
    sim.queueInput({ type: 'addDecoration', decoration: 'coral', x: -500, y: 100 }, 1);
    sim.queueInput({ type: 'addDecoration', decoration: 'wreck', x: 99999, y: -300 }, 1);
    sim.run(10);
    return sim.getTrajectory().steps.flatMap(s => s.events)
      .filter((e): e is Extract<SimEvent, { type: 'decorationPlaced' }> => e.type === 'decorationPlaced');
  };
  const a = run();
  const b = run();
  const inBounds = a.every(e => e.x >= 0 && e.x <= 1280 && e.y >= 620 && e.y <= 720);
  const allClamped = a.every(e => e.clamped);
  const deterministic = JSON.stringify(a) === JSON.stringify(b);
  const ok = a.length === 2 && inBounds && allClamped && deterministic;
  return {
    label: '装饰物越界夹取',
    ok,
    detail: a.map(e => `${e.decoration}@(${e.x},${e.y})`).join('，') || '无放置事件'
  };
}

/** 边界检查 4：同一时间步内多个输入按记录顺序稳定生效 */
function checkSameStepOrdering(): CheckResult {
  const scenario = getScenario('same-step-multi-events')!;
  const trajectory = runScenarioOnce(scenario);
  const step100 = trajectory.steps.find(s => s.step === 100)!;
  const order = step100.events.map(e => e.type);
  const expected = ['foodAdded', 'decorationPlaced', 'foodAdded', 'decorationPlaced'];
  const ok = JSON.stringify(order) === JSON.stringify(expected);
  return {
    label: '同步多事件顺序',
    ok,
    detail: `实际顺序=[${order.join(', ')}]`
  };
}

function parseArgs(): { scenario?: string; out?: string; verify?: string } {
  const args: Record<string, string> = {};
  for (const raw of process.argv.slice(2)) {
    const match = raw.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

async function writeFile(path: string, content: string): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, content, 'utf8');
}

async function readFile(path: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  return readFile(path, 'utf8');
}

async function main(): Promise<void> {
  const args = parseArgs();
  let failures = 0;

  // 模式：回放并验证一份已导出的轨迹文件
  if (args.verify) {
    const trajectory = deserializeTrajectory(await readFile(args.verify));
    const replayed = replayTrajectory(trajectory);
    const diff = compareTrajectories(trajectory, replayed);
    console.log(`回放验证 ${args.verify}: ${diff.equal ? '✓ 一致' : '✗ ' + diff.message}`);
    console.log(`  原始 hash=${hashTrajectory(trajectory)}  回放 hash=${hashTrajectory(replayed)}`);
    process.exitCode = diff.equal ? 0 : 1;
    return;
  }

  const scenarios = args.scenario
    ? [getScenario(args.scenario)].filter((s): s is Scenario => Boolean(s))
    : SCENARIOS;
  if (scenarios.length === 0) {
    console.error(`未找到场景: ${args.scenario}（可选: ${SCENARIOS.map(s => s.name).join(', ')}）`);
    process.exitCode = 1;
    return;
  }

  for (const scenario of scenarios) {
    console.log(`\n■ 场景 ${scenario.name}（${scenario.steps} 步，步长 ${STEP_DT}s）`);
    console.log(`  ${scenario.description}`);
    const trajectory = runScenarioOnce(scenario);
    const last = trajectory.steps[trajectory.steps.length - 1];
    console.log(`  末态: 鱼=${last.fishCount} 食物=${last.foodCount} 装饰物=${last.decorationCount}  hash=${hashTrajectory(trajectory)}`);
    for (const result of checkScenario(scenario)) {
      console.log(`  ${result.ok ? '✓' : '✗'} ${result.label} — ${result.detail}`);
      if (!result.ok) failures++;
    }
    if (args.out) {
      await writeFile(args.out, serializeTrajectory(trajectory));
      console.log(`  轨迹已导出: ${args.out}`);
    }
  }

  if (!args.scenario) {
    console.log('\n■ 边界检查');
    for (const result of [checkBreedingCap(), checkFoodCleanup(), checkDecorationClamp(), checkSameStepOrdering()]) {
      console.log(`  ${result.ok ? '✓' : '✗'} ${result.label} — ${result.detail}`);
      if (!result.ok) failures++;
    }
  }

  console.log(failures === 0 ? '\n全部检查通过 ✓' : `\n${failures} 项检查失败 ✗`);
  process.exitCode = failures === 0 ? 0 : 1;
}

await main();
