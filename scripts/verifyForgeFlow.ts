import {
  ForgeCore,
  FORGE_STAGE_ORDER,
  PROGRESS_MAX,
  HAMMER_TARGET,
  INITIAL_TEMPERATURE,
  QUENCHED_TEMPERATURE,
  HEATING_TEMPERATURE_DROP,
  HAMMER_TEMPERATURE_FLOOR
} from '../src/forgeCore.ts';
import type { ForgeStateData } from '../src/forgeCore.ts';

const DELTA = 0.1;
const CYCLES = 3;
const INSCRIPTION = '青锋';

let failures = 0;

function check(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}`);
  }
}

function snapshotOf(core: ForgeCore): string {
  return JSON.stringify(core.getState());
}

function isInitialState(state: ForgeStateData): boolean {
  return state.currentState === 'idle'
    && state.hammerCount === 0
    && state.temperature === INITIAL_TEMPERATURE
    && state.materialType === null
    && state.heatingProgress === 0
    && state.grindingProgress === 0
    && state.sharpeningProgress === 0
    && state.inscription === '';
}

function runFullFlow(core: ForgeCore, cycle: number): string[] {
  console.log(`\n[周期 ${cycle}] 完整锻造流程`);
  const snapshots: string[] = [];
  const snap = (label: string): void => {
    snapshots.push(`${label}=${snapshotOf(core)}`);
  };

  check(isInitialState(core.getState()), `周期 ${cycle}: 初始状态为 idle 且各进度/温度/锤击/铭文为初始值`);
  snap('initial');

  check(core.enterState('grinding') === false, '非法迁移 idle->grinding 被拒绝');
  check(core.enterState('showing') === false, '非法迁移 idle->showing 被拒绝');
  core.update(1);
  core.addHeatingProgress(10);
  core.addHammerCount();
  core.addSharpeningProgress(10);
  check(core.addGrindingProgress(10, true) === false, 'idle 下研磨推进被拒绝');
  check(core.setInscription('非法') === false, 'idle 下铭文写入被拒绝');
  check(isInitialState(core.getState()), '非法迁移与越阶段推进后状态保持初始值');
  snap('after-illegal');

  check(core.setMaterial('mystery') === true, 'idle 下允许放入材料');
  check(core.enterState('heating') === true, '合法迁移 idle->heating');
  snap('heating-start');

  let guard = 0;
  while (core.getState().currentState === 'heating' && guard < 1000) {
    core.update(DELTA);
    guard++;
  }
  check(core.getState().currentState === 'hammering', '加热进度满后自动进入锤炼');
  check(core.getState().heatingProgress === PROGRESS_MAX, '加热进度达到上限 100');
  check(core.getState().temperature === INITIAL_TEMPERATURE - HEATING_TEMPERATURE_DROP, '加热完成温度为 800℃');
  snap('after-heating');

  core.update(DELTA);
  core.addHeatingProgress(10);
  check(core.getState().heatingProgress === PROGRESS_MAX && core.getState().sharpeningProgress === 0,
    '阶段切换后旧阶段（加热）推进不再生效');
  check(core.setMaterial('cold') === false, '非 idle 阶段更换材料被拒绝');

  for (let i = 0; i < HAMMER_TARGET; i++) {
    core.addHammerCount();
  }
  check(core.getState().currentState === 'quenching', '锤击 60 次后进入淬火');
  check(core.getState().hammerCount === HAMMER_TARGET, '锤击次数达到上限 60');
  check(core.getState().temperature === HAMMER_TEMPERATURE_FLOOR, '锤炼温度降至下限 600℃');
  core.addHammerCount();
  check(core.getState().hammerCount === HAMMER_TARGET, '淬火阶段锤击次数不再累积');
  snap('after-hammering');

  core.setQuenchingComplete();
  check(core.getState().currentState === 'grinding' && core.getState().temperature === QUENCHED_TEMPERATURE,
    '淬火完成进入研磨且温度降至 100℃');
  snap('after-quenching');

  check(core.addGrindingProgress(10, false) === false, '错误方向研磨不累积进度');
  check(core.getState().grindingProgress === 0, '错误方向后研磨进度仍为 0');
  for (let i = 0; i < 20; i++) {
    core.addGrindingProgress(5, true);
  }
  check(core.getState().currentState === 'sharpening', '研磨进度满后进入开刃');
  check(core.getState().grindingProgress === PROGRESS_MAX, '研磨进度达到上限 100');
  snap('after-grinding');

  guard = 0;
  while (core.getState().currentState === 'sharpening' && guard < 1000) {
    core.update(DELTA);
    guard++;
  }
  check(core.getState().currentState === 'inscribing', '开刃进度满后进入铭刻');
  check(core.getState().sharpeningProgress === PROGRESS_MAX, '开刃进度达到上限 100');
  snap('after-sharpening');

  check(core.setInscription(INSCRIPTION) === true, '铭刻阶段写入铭文');
  check(core.getState().currentState === 'showing' && core.getState().inscription === INSCRIPTION,
    '铭文写入后进入展示阶段');
  snap('showing');

  core.reset();
  check(isInitialState(core.getState()), `周期 ${cycle}: 重置后全部状态回到初始值`);
  check(core.enterState('inscribing') === false, '重置后非法迁移 idle->inscribing 仍被拒绝');
  snap('after-reset');

  return snapshots;
}

function verifyTransitionTable(): void {
  console.log('\n[迁移表] 阶段顺序与合法性集中判定');
  for (let i = 0; i < FORGE_STAGE_ORDER.length; i++) {
    const from = FORGE_STAGE_ORDER[i];
    const to = FORGE_STAGE_ORDER[(i + 1) % FORGE_STAGE_ORDER.length];
    check(ForgeCore.canTransition(from, to), `合法迁移 ${from} -> ${to}`);
  }
  check(FORGE_STAGE_ORDER.join(',') === 'idle,heating,hammering,quenching,grinding,sharpening,inscribing,showing',
    '阶段名称与顺序保持不变');
  const skipProbe = new ForgeCore();
  check(skipProbe.canTransitionTo('heating') && !skipProbe.canTransitionTo('quenching'),
    '实例级 canTransitionTo 与迁移表一致');
}

console.log('锻造流程离线验证开始');
verifyTransitionTable();

const core = new ForgeCore();
let lastStateChange: ForgeStateData | null = null;
let lastProgress: ForgeStateData | null = null;
core.onStateChange((state) => { lastStateChange = state; });
core.onProgress((state) => { lastProgress = state; });

const cycleResults: string[][] = [];
for (let cycle = 1; cycle <= CYCLES; cycle++) {
  cycleResults.push(runFullFlow(core, cycle));
  check(lastStateChange !== null && JSON.stringify(lastStateChange) === snapshotOf(core),
    `周期 ${cycle}: 状态变更通知与权威状态一致`);
}

for (let cycle = 1; cycle < CYCLES; cycle++) {
  check(JSON.stringify(cycleResults[cycle]) === JSON.stringify(cycleResults[0]),
    `周期 ${cycle + 1} 与周期 1 的全流程快照完全一致`);
}

check(lastProgress !== null, '进度通知在流程中正常触发');

console.log('');
if (failures > 0) {
  console.error(`验证失败：共 ${failures} 项检查未通过`);
  throw new Error(`forge flow verification failed: ${failures} check(s)`);
}
console.log('全部检查通过：阶段迁移、进度推进与重置在多次连续操作下结果一致');
