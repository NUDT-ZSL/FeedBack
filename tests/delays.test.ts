import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSimContext,
  dispatchDocument,
  advance,
  checkTimeouts,
} from '../src/simulation.ts';
import {
  makeState,
  makeStation,
  makeDoc,
  makeClock,
  assertInvariants,
  findDoc,
  findLog,
  findHorse,
} from './helpers.ts';

test('延误判定：超时未送达的文书、日志、在途驿马在同一拍内同步收敛', () => {
  const clock = makeClock();
  const ctx = createSimContext({ now: clock.now });
  // 时限 0.5s，行程 1s：必然在途中超时
  const doc = makeDoc({
    id: 'doc-1',
    fromStation: 'station-0',
    toStation: 'station-1',
    timeLimit: 0.5,
  });
  let state = makeState({
    stations: [makeStation(0, [doc]), makeStation(1), makeStation(2)],
  });

  state = dispatchDocument(state, ctx, 'station-0', 'horse-0', 'doc-1');
  assert.equal(state.movingHorses.length, 1);

  clock.advanceBy(600);
  state = advance(state, clock.current);

  assert.equal(findDoc(state, 'doc-1').status, 'delayed');
  assert.equal(findLog(state, 'doc-1').status, 'delayed');
  assert.equal(state.movingHorses.length, 0, '延误后在途记录应立即清除');
  assert.equal(findHorse(state, 'horse-0').available, true, '延误后驿马应立即释放');
  assert.equal(state.alertMessage, `警告：文书 ${findDoc(state, 'doc-1').code} 已延误！`);
  assertInvariants(state);
});

test('延误收敛：判定后状态稳定，不残留悬挂在途记录，也不重复触发', () => {
  const clock = makeClock();
  const ctx = createSimContext({ now: clock.now });
  const doc = makeDoc({
    id: 'doc-1',
    fromStation: 'station-0',
    toStation: 'station-1',
    timeLimit: 0.5,
  });
  let state = makeState({
    stations: [makeStation(0, [doc]), makeStation(1), makeStation(2)],
  });

  state = dispatchDocument(state, ctx, 'station-0', 'horse-0', 'doc-1');
  clock.advanceBy(600);
  state = advance(state, clock.current);
  const converged = state;

  // 继续推进多个时间拍：状态不应再变化
  for (let i = 0; i < 5; i++) {
    clock.advanceBy(500);
    state = advance(state, clock.current);
    assertInvariants(state);
  }
  assert.deepEqual(state.logs, converged.logs, '延误日志不应被重复改写');
  assert.equal(findDoc(state, 'doc-1').status, 'delayed');
  assert.equal(state.movingHorses.length, 0);
});

test('部分延误：一份文书超时不影响其他在途文书继续送达', () => {
  const clock = makeClock();
  const ctx = createSimContext({ now: clock.now });
  const docs = [
    makeDoc({ id: 'doc-tight', fromStation: 'station-0', toStation: 'station-1', timeLimit: 0.5 }),
    makeDoc({ id: 'doc-loose', fromStation: 'station-0', toStation: 'station-2', timeLimit: 15 }),
  ];
  let state = makeState({
    stations: [makeStation(0, docs), makeStation(1), makeStation(2)],
  });

  state = dispatchDocument(state, ctx, 'station-0', 'horse-0', 'doc-tight');
  state = dispatchDocument(state, ctx, 'station-0', 'horse-1', 'doc-loose');

  clock.advanceBy(600);
  state = advance(state, clock.current);
  assert.equal(findDoc(state, 'doc-tight').status, 'delayed');
  assert.equal(findDoc(state, 'doc-loose').status, 'in-transit');
  assert.equal(findHorse(state, 'horse-0').available, true);
  assert.equal(findHorse(state, 'horse-1').available, false);
  assert.equal(state.movingHorses.length, 1);
  assertInvariants(state);

  // 另一份文书按原行程正常送达
  clock.advanceBy(1400);
  state = advance(state, clock.current);
  assert.equal(findDoc(state, 'doc-loose').status, 'delivered');
  assert.equal(findLog(state, 'doc-loose').status, 'delivered');
  assert.equal(findHorse(state, 'horse-1').available, true);
  assert.equal(findDoc(state, 'doc-tight').status, 'delayed');
  assertInvariants(state);
});

test('时间边界：耗时恰好等于时限不判延误，超时 1ms 即判延误', () => {
  const clock = makeClock();
  const ctx = createSimContext({ now: clock.now });
  // 行程 1s（普通、满体力、1 站），时限恰好 1s
  const doc = makeDoc({
    id: 'doc-1',
    fromStation: 'station-0',
    toStation: 'station-1',
    timeLimit: 1,
  });
  let state = makeState({
    stations: [makeStation(0, [doc]), makeStation(1), makeStation(2)],
  });
  state = dispatchDocument(state, ctx, 'station-0', 'horse-0', 'doc-1');

  clock.advanceBy(1000);
  state = advance(state, clock.current);
  assert.equal(findDoc(state, 'doc-1').status, 'delivered', '到达与超时同刻应判定送达');
  assert.equal(state.alertMessage, null);
  assertInvariants(state);

  // 超时 1ms 的场景：行程 2s，时限 1s
  const clock2 = makeClock();
  const ctx2 = createSimContext({ now: clock2.now });
  const doc2 = makeDoc({
    id: 'doc-2',
    fromStation: 'station-0',
    toStation: 'station-2',
    timeLimit: 1,
  });
  let state2 = makeState({
    stations: [makeStation(0, [doc2]), makeStation(1), makeStation(2)],
  });
  state2 = dispatchDocument(state2, ctx2, 'station-0', 'horse-0', 'doc-2');

  clock2.advanceBy(1000);
  state2 = advance(state2, clock2.current);
  assert.equal(findDoc(state2, 'doc-2').status, 'in-transit', '恰好等于时限不应判延误');

  clock2.advanceBy(1);
  state2 = advance(state2, clock2.current);
  assert.equal(findDoc(state2, 'doc-2').status, 'delayed', '超过时限 1ms 应判延误');
  assert.equal(state2.movingHorses.length, 0);
  assertInvariants(state2);
});

test('checkTimeouts 幂等：无超时文书时不产生新状态', () => {
  const clock = makeClock();
  const ctx = createSimContext({ now: clock.now });
  const doc = makeDoc({ id: 'doc-1', fromStation: 'station-0', toStation: 'station-1' });
  let state = makeState({
    stations: [makeStation(0, [doc]), makeStation(1), makeStation(2)],
  });
  state = dispatchDocument(state, ctx, 'station-0', 'horse-0', 'doc-1');

  clock.advanceBy(500);
  const next = checkTimeouts(state, clock.current);
  assert.equal(next, state, '无超时时不应产生新状态');
  assertInvariants(next);
});
