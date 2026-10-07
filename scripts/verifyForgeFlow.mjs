import assert from 'node:assert/strict';
import { ForgeCore } from '../.verify-build/forgeCore.js';

const INITIAL_STATE = {
  currentState: 'idle',
  hammerCount: 0,
  temperature: 1200,
  materialType: null,
  heatingProgress: 0,
  grindingProgress: 0,
  sharpeningProgress: 0,
  inscription: ''
};

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

function withSilencedWarnings(fn) {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    fn();
  } finally {
    console.warn = originalWarn;
  }
  return warnings;
}

function tickUntil(core, targetState, maxTicks = 1000) {
  let ticks = 0;
  while (core.getState().currentState !== targetState && ticks < maxTicks) {
    core.update(0.1);
    ticks++;
  }
  assert.ok(ticks < maxTicks, `reached ${targetState} within tick budget`);
  return ticks;
}

function runFullFlow(core) {
  const snapshots = [];
  const snap = (label) => snapshots.push([label, core.getState()]);

  core.setMaterial('meteorite');
  core.enterState('heating');
  snap('heating-started');

  tickUntil(core, 'hammering');
  snap('heating-done');

  // 阶段切换后，旧阶段（加热/磨砺）的时间推进不得继续生效
  core.update(1);
  snap('hammering-tick-noop');

  for (let i = 0; i < 60; i++) core.addHammerCount();
  snap('hammering-done');

  // 淬火阶段锤击不再累积
  core.addHammerCount();
  snap('quenching-hammer-noop');

  core.setQuenchingComplete();
  snap('quenching-done');

  // 方向错误的研磨不累积进度
  assert.equal(core.addGrindingProgress(5, false), false);
  snap('grinding-wrong-direction');

  for (let i = 0; i < 20; i++) assert.equal(core.addGrindingProgress(5, true), true);
  snap('grinding-done');

  tickUntil(core, 'inscribing');
  snap('sharpening-done');

  // 铭文阶段时间推进不再累积任何进度
  core.update(1);
  snap('inscribing-tick-noop');

  core.setInscription('青釭');
  snap('inscription-done');

  core.enterState('idle');
  snap('restarted');

  return snapshots;
}

console.log('verifyForgeFlow');

check('initial state matches expected defaults', () => {
  assert.deepEqual(new ForgeCore().getState(), INITIAL_STATE);
});

check('illegal transitions do not mutate state or accumulate progress', () => {
  const core = new ForgeCore();
  const warnings = withSilencedWarnings(() => {
    core.enterState('grinding');
    core.enterState('showing');
    core.setInscription('不该写入');
    core.addHeatingProgress(50);
    core.addHammerCount();
    core.addGrindingProgress(50, true);
    core.addSharpeningProgress(50);
    core.setQuenchingComplete();
    core.update(1);
  });
  assert.deepEqual(core.getState(), INITIAL_STATE);
  assert.ok(warnings.length >= 3, 'illegal transitions are reported, not silent');
});

check('transition validation is centralized and predictable', () => {
  const core = new ForgeCore();
  const order = ['idle', 'heating', 'hammering', 'quenching', 'grinding', 'sharpening', 'inscribing', 'showing'];
  for (let i = 0; i < order.length; i++) {
    const next = order[(i + 1) % order.length];
    assert.equal(core.canTransition(order[i], next), true, `${order[i]} -> ${next}`);
    for (const other of order) {
      if (other !== next) {
        assert.equal(core.canTransition(order[i], other), false, `${order[i]} -/-> ${other}`);
      }
    }
  }
});

check('full forge flow reaches expected stage values', () => {
  const core = new ForgeCore();
  const snapshots = runFullFlow(core);
  const byLabel = Object.fromEntries(snapshots.map(([label, state]) => [label, state]));

  assert.equal(byLabel['heating-done'].currentState, 'hammering');
  assert.equal(byLabel['heating-done'].heatingProgress, 100);
  assert.equal(byLabel['heating-done'].temperature, 800);

  assert.equal(byLabel['hammering-tick-noop'].heatingProgress, 100);
  assert.equal(byLabel['hammering-tick-noop'].sharpeningProgress, 0);

  assert.equal(byLabel['hammering-done'].currentState, 'quenching');
  assert.equal(byLabel['hammering-done'].hammerCount, 60);
  assert.equal(byLabel['hammering-done'].temperature, 600);

  assert.equal(byLabel['quenching-hammer-noop'].hammerCount, 60);

  assert.equal(byLabel['quenching-done'].currentState, 'grinding');
  assert.equal(byLabel['quenching-done'].temperature, 100);

  assert.equal(byLabel['grinding-wrong-direction'].grindingProgress, 0);

  assert.equal(byLabel['grinding-done'].currentState, 'sharpening');
  assert.equal(byLabel['grinding-done'].grindingProgress, 100);

  assert.equal(byLabel['sharpening-done'].currentState, 'inscribing');
  assert.equal(byLabel['sharpening-done'].sharpeningProgress, 100);

  assert.equal(byLabel['inscription-done'].currentState, 'showing');
  assert.equal(byLabel['inscription-done'].inscription, '青釭');
  assert.equal(byLabel['inscription-done'].materialType, 'meteorite');

  assert.equal(byLabel['restarted'].currentState, 'idle');
});

check('reset mid-flow restores all progress, temperature, hammer count and inscription', () => {
  const core = new ForgeCore();
  const notifications = [];
  core.onStateChange((state) => notifications.push(state.currentState));

  core.setMaterial('cold');
  core.enterState('heating');
  for (let i = 0; i < 10; i++) core.update(0.1);
  assert.ok(core.getState().heatingProgress > 0);

  core.reset();
  assert.deepEqual(core.getState(), INITIAL_STATE);
  assert.equal(notifications[notifications.length - 1], 'idle');

  runFullFlow(core);
  core.reset();
  assert.deepEqual(core.getState(), INITIAL_STATE);
});

check('repeated runs after reset produce identical results', () => {
  const core = new ForgeCore();
  const first = runFullFlow(core);
  core.reset();
  const second = runFullFlow(core);
  core.reset();
  const third = runFullFlow(core);
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
});

console.log(`all ${passed} checks passed`);
