import {
  DivinationKernel,
  resolveTrigramSlot,
  computeBeamPosition,
  directionForSlot,
  SLOT_ANGLE_DEG,
} from './divinationKernel.ts';
import type { DivinationState, DropOutcome } from './divinationKernel.ts';
import { trigrams } from '../lib/starData.ts';

declare const process: { exitCode?: number };

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

interface ScenarioResult {
  scenario: string;
  checks: CheckResult[];
  finalState: DivinationState;
  outcomes: Array<DropOutcome | null>;
}

function assertCheck(name: string, condition: boolean, detail: string): CheckResult {
  return { name, passed: condition, detail };
}

function createVirtualClock() {
  let time = 1_000_000;
  const clock = {
    now: () => time,
    advance(ms: number) {
      time += ms;
      return time;
    },
  };
  return clock;
}

function angleDirection(deg: number, magnitude = 1): [number, number] {
  const rad = deg * Math.PI / 180;
  return [Math.cos(rad) * magnitude, Math.sin(rad) * magnitude];
}

function scenarioHit(): ScenarioResult {
  const clock = createVirtualClock();
  const kernel = new DivinationKernel({ now: clock.now });
  const outcomes: Array<DropOutcome | null> = [];
  const checks: CheckResult[] = [];
  const target = trigrams[0];

  kernel.dispatch({ type: 'talismanDragStart', talisman: target.name });
  outcomes.push(kernel.dispatch({ type: 'baguaDrop', direction: directionForSlot(target.position) }));

  const state = kernel.getState();
  checks.push(assertCheck('命中返回 matched=true', outcomes[0]?.matched === true, JSON.stringify(outcomes[0])));
  checks.push(assertCheck('命中卦位正确', outcomes[0]?.slot === target.position, String(outcomes[0]?.slot)));
  checks.push(assertCheck('光束可见且位于命中卦位', state.lightBeam?.visible === true && state.lightBeam.slot === target.position, JSON.stringify(state.lightBeam)));
  checks.push(assertCheck('光束位置为渲染坐标', JSON.stringify(state.lightBeam?.position) === JSON.stringify(computeBeamPosition(target.position)), JSON.stringify(state.lightBeam?.position)));
  checks.push(assertCheck('拖拽符咒已消费', state.draggedTalisman === null, String(state.draggedTalisman)));
  checks.push(assertCheck('光束到期时间为 2000ms', state.lightBeam !== null && state.lightBeam.expiresAt - state.lightBeam.startedAt === 2000, ''));

  clock.advance(1999);
  kernel.dispatch({ type: 'tick' });
  checks.push(assertCheck('到期前光束仍在', kernel.getState().lightBeam !== null, ''));
  clock.advance(1);
  kernel.dispatch({ type: 'tick' });
  checks.push(assertCheck('2000ms 后光束自行消失', kernel.getState().lightBeam === null, ''));

  return { scenario: 'hit-命中触发光束并自行消失', checks, finalState: kernel.getState(), outcomes };
}

function scenarioMiss(): ScenarioResult {
  const clock = createVirtualClock();
  const kernel = new DivinationKernel({ now: clock.now });
  const outcomes: Array<DropOutcome | null> = [];
  const checks: CheckResult[] = [];

  kernel.dispatch({ type: 'talismanDragStart', talisman: '乾' });
  outcomes.push(kernel.dispatch({ type: 'baguaDrop', direction: directionForSlot(3) }));

  const state = kernel.getState();
  checks.push(assertCheck('未命中返回 matched=false', outcomes[0]?.matched === false, JSON.stringify(outcomes[0])));
  checks.push(assertCheck('不产生光束', state.lightBeam === null, ''));
  checks.push(assertCheck('错误标志置位', state.baguaError === true, ''));

  clock.advance(399);
  kernel.dispatch({ type: 'tick' });
  checks.push(assertCheck('400ms 前错误仍在', kernel.getState().baguaError === true, ''));
  clock.advance(1);
  kernel.dispatch({ type: 'tick' });
  checks.push(assertCheck('400ms 后错误标志复位', kernel.getState().baguaError === false, ''));

  return { scenario: 'miss-未命中短暂错误提示', checks, finalState: kernel.getState(), outcomes };
}

function scenarioDuplicateDrop(): ScenarioResult {
  const clock = createVirtualClock();
  const kernel = new DivinationKernel({ now: clock.now });
  const outcomes: Array<DropOutcome | null> = [];
  const checks: CheckResult[] = [];
  const direction = directionForSlot(0);

  const singleKernel = new DivinationKernel({ now: clock.now });
  singleKernel.dispatch({ type: 'talismanDragStart', talisman: '乾' });
  singleKernel.dispatch({ type: 'baguaDrop', direction });

  kernel.dispatch({ type: 'talismanDragStart', talisman: '乾' });
  outcomes.push(kernel.dispatch({ type: 'baguaDrop', direction }));
  const firstBeamStart = kernel.getState().lightBeam?.startedAt;
  outcomes.push(kernel.dispatch({ type: 'baguaDrop', direction }));
  outcomes.push(kernel.dispatch({ type: 'baguaDrop', direction }));

  const state = kernel.getState();
  checks.push(assertCheck('重复投递不产生二次结果', outcomes[1] === null && outcomes[2] === null, JSON.stringify(outcomes)));
  checks.push(assertCheck('光束不被重复投递重置', state.lightBeam?.startedAt === firstBeamStart, String(firstBeamStart)));
  checks.push(assertCheck('最终状态与单次干净投递一致', JSON.stringify(state) === JSON.stringify(singleKernel.getState()), 'snapshot mismatch'));

  clock.advance(2000);
  kernel.dispatch({ type: 'tick' });
  singleKernel.dispatch({ type: 'tick' });
  checks.push(assertCheck('到期后两机状态仍一致且无残留', JSON.stringify(kernel.getState()) === JSON.stringify(singleKernel.getState()) && kernel.getState().lightBeam === null, ''));

  return { scenario: 'duplicate-重复投递幂等', checks, finalState: kernel.getState(), outcomes };
}

function scenarioMidDragSwitch(): ScenarioResult {
  const clock = createVirtualClock();
  const kernel = new DivinationKernel({ now: clock.now });
  const outcomes: Array<DropOutcome | null> = [];
  const checks: CheckResult[] = [];

  kernel.dispatch({ type: 'talismanDragStart', talisman: '乾' });
  kernel.dispatch({ type: 'talismanDragStart', talisman: '坤' });
  checks.push(assertCheck('中途切换后当前符咒为坤', kernel.getState().draggedTalisman === '坤', String(kernel.getState().draggedTalisman)));
  kernel.dispatch({ type: 'talismanDragEnd', talisman: '乾' });
  checks.push(assertCheck('旧符咒的滞后 dragEnd 被忽略', kernel.getState().draggedTalisman === '坤', String(kernel.getState().draggedTalisman)));

  outcomes.push(kernel.dispatch({ type: 'baguaDrop', direction: directionForSlot(7) }));
  checks.push(assertCheck('以新符咒坤完成推演', outcomes[0]?.talisman === '坤' && outcomes[0]?.matched === true, JSON.stringify(outcomes[0])));
  checks.push(assertCheck('命中后无错误态残留', kernel.getState().baguaError === false, ''));

  const previousBeamStart = kernel.getState().lightBeam?.startedAt;
  kernel.dispatch({ type: 'talismanDragStart', talisman: '乾' });
  kernel.dispatch({ type: 'talismanDragStart', talisman: '震' });
  outcomes.push(kernel.dispatch({ type: 'baguaDrop', direction: directionForSlot(0) }));
  checks.push(assertCheck('切换后投错位置返回未命中', outcomes[1]?.matched === false && outcomes[1]?.talisman === '震', JSON.stringify(outcomes[1])));
  checks.push(assertCheck('未命中不覆盖既有合法光束', kernel.getState().lightBeam?.startedAt === previousBeamStart, ''));
  checks.push(assertCheck('未命中给出错误标志', kernel.getState().baguaError === true, ''));

  clock.advance(400);
  kernel.dispatch({ type: 'tick' });
  checks.push(assertCheck('错误标志先于光束自行复位', kernel.getState().baguaError === false && kernel.getState().lightBeam !== null, ''));
  clock.advance(1600);
  kernel.dispatch({ type: 'tick' });
  const state = kernel.getState();
  checks.push(assertCheck('到期后光束与错误态均清空', state.lightBeam === null && state.baguaError === false, ''));

  return { scenario: 'switch-拖拽中途切换符咒', checks, finalState: state, outcomes };
}

function scenarioDirectionBoundary(): ScenarioResult {
  const checks: CheckResult[] = [];

  for (let slot = 0; slot < 8; slot += 1) {
    const centerDeg = slot * SLOT_ANGLE_DEG - 90;
    const centerSlot = resolveTrigramSlot(angleDirection(centerDeg));
    checks.push(assertCheck(`卦位 ${slot} 中心方向判定`, centerSlot === slot, String(centerSlot)));

    for (const magnitude of [1e-9, 1, 1e9]) {
      const resolved = resolveTrigramSlot(angleDirection(centerDeg, magnitude));
      checks.push(assertCheck(`卦位 ${slot} 方向长度=${magnitude} 判定不变`, resolved === slot, String(resolved)));
    }

    const lower = resolveTrigramSlot(angleDirection(centerDeg - SLOT_ANGLE_DEG / 2));
    const upper = resolveTrigramSlot(angleDirection(centerDeg + SLOT_ANGLE_DEG / 2));
    checks.push(assertCheck(`卦位 ${slot} 下边界确定归属`, lower === slot, String(lower)));
    checks.push(assertCheck(`卦位 ${slot} 上边界确定归属`, upper === (slot + 1) % 8, String(upper)));
  }

  const pointerA = resolveTrigramSlot([120.4, 120.4]);
  const pointerB = resolveTrigramSlot([120.4000001, 120.3999999]);
  const pointerC = resolveTrigramSlot([1204, 1204]);
  checks.push(assertCheck('指针精度/缩放抖动不改变判定', pointerA === pointerB && pointerA === pointerC, `${pointerA}/${pointerB}/${pointerC}`));
  checks.push(assertCheck('零向量为无效方向', resolveTrigramSlot([0, 0]) === -1, ''));

  const clock = createVirtualClock();
  const kernel = new DivinationKernel({ now: clock.now });
  kernel.dispatch({ type: 'talismanDragStart', talisman: '离' });
  const sameDirectionFromAnyScreenRect: [number, number] = [1, 0];
  kernel.dispatch({ type: 'baguaDrop', direction: sameDirectionFromAnyScreenRect });
  checks.push(assertCheck('只依赖相对方向：正东命中离', kernel.getState().lightBeam?.slot === 2, String(kernel.getState().lightBeam?.slot)));

  return { scenario: 'boundary-方向边界与布局解耦', checks, finalState: kernel.getState(), outcomes: [] };
}

function scenarioRotationStacking(): ScenarioResult {
  const clock = createVirtualClock();
  const kernel = new DivinationKernel({ now: clock.now });
  const outcomes: Array<DropOutcome | null> = [];
  const checks: CheckResult[] = [];
  let expectedX = 0;
  let expectedY = 0;

  const rotateBatch = (index: number) => {
    kernel.dispatch({ type: 'sphereDragStart' });
    kernel.dispatch({ type: 'sphereDragMove', deltaX: 130 + index * 7, deltaY: -41 + index * 11 });
    kernel.dispatch({ type: 'sphereDragMove', deltaX: 0.5 - index, deltaY: 2.2 });
    kernel.dispatch({ type: 'sphereDragEnd' });
    expectedY += (130 + index * 7 + 0.5 - index) * 0.5;
    expectedX += (-41 + index * 11 + 2.2) * 0.5;
  };

  for (let i = 0; i < 5; i += 1) {
    rotateBatch(i);
    if (i % 2 === 0) {
      kernel.dispatch({ type: 'talismanDragStart', talisman: '乾' });
      outcomes.push(kernel.dispatch({ type: 'baguaDrop', direction: directionForSlot(0) }));
    } else {
      kernel.dispatch({ type: 'talismanDragStart', talisman: '兑' });
      outcomes.push(kernel.dispatch({ type: 'baguaDrop', direction: directionForSlot(0) }));
    }
    clock.advance(100);
    kernel.dispatch({ type: 'tick' });
  }

  const norm = (v: number) => {
    const wrapped = v % 360;
    return wrapped < 0 ? wrapped + 360 : wrapped;
  };
  const state = kernel.getState();
  checks.push(assertCheck('旋转值连续叠加且归一化', Math.abs(state.rotation[0] - norm(expectedX)) < 1e-9 && Math.abs(state.rotation[1] - norm(expectedY)) < 1e-9, `${state.rotation[0]}/${state.rotation[1]}`));
  checks.push(assertCheck('浑天仪拖拽已结束', state.isDraggingSphere === false, ''));
  checks.push(assertCheck('符咒拖拽已消费', state.draggedTalisman === null, ''));

  clock.advance(2000);
  kernel.dispatch({ type: 'tick' });
  const settled = kernel.getState();
  checks.push(assertCheck('连续操作后无光束残留', settled.lightBeam === null, ''));
  checks.push(assertCheck('连续操作后无错误标志残留', settled.baguaError === false, ''));
  checks.push(assertCheck('旋转值不受特效到期影响', Math.abs(settled.rotation[0] - norm(expectedX)) < 1e-9, ''));

  return { scenario: 'rotation-旋转叠加与状态自洽', checks, finalState: settled, outcomes };
}

function run() {
  const results = [
    scenarioHit(),
    scenarioMiss(),
    scenarioDuplicateDrop(),
    scenarioMidDragSwitch(),
    scenarioDirectionBoundary(),
    scenarioRotationStacking(),
  ];

  let total = 0;
  let failed = 0;
  for (const result of results) {
    console.log(`\n[${result.scenario}]`);
    for (const check of result.checks) {
      total += 1;
      if (!check.passed) failed += 1;
      console.log(`  ${check.passed ? 'PASS' : 'FAIL'}  ${check.name}${check.detail ? `  (${check.detail})` : ''}`);
    }
  }

  console.log('\n--- deterministic final-state snapshot ---');
  console.log(JSON.stringify(results.map((r) => ({ scenario: r.scenario, finalState: r.finalState })), null, 2));
  console.log(`\n${total - failed}/${total} checks passed`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

run();
