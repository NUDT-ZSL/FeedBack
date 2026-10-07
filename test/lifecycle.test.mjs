/**
 * 离线验证：信件 → 派单 → 在途 → 抵达 → 休息冷却 → 异常回退 全链路状态一致性。
 * 运行方式：npm test（node --test，内存数据库 + 注入假时钟，无需网络与端口）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDatabase,
  createStore,
  LifecycleError,
  MINUTE_MS,
  REST_COOLDOWN_MS,
} from '../lifecycle.mjs';

// 固定时钟基准：2026-06-09 08:00 本地时间，所有用例的时间推进都在同一天内。
const T0 = new Date('2026-06-09T08:00:00').getTime();

async function freshStore() {
  const db = await createDatabase();
  return createStore(db);
}

const sampleLetter = { sender: '李白', receiver: '杜甫', destination: '洛阳', urgency: 'normal', weight: 10 };

function expectLifecycleError(fn, code) {
  assert.throws(fn, (err) => err instanceof LifecycleError && err.code === code);
}

test('抵达结算：到点后任务/信件/马匹/统计四方一致闭环', async () => {
  const store = await freshStore();
  const letter = store.createLetter(sampleLetter, T0);
  assert.equal(letter.status, 'pending');
  assert.equal(letter.estimatedDeliveryTime, 90); // 洛阳 90 分钟 × 普通 1.0

  const task = store.dispatch(letter.id, 'horse-1', T0);
  const eta = T0 + 90 * MINUTE_MS;
  assert.equal(task.status, 'in_progress');
  assert.equal(task.estimatedArrivalTime, eta, '预计送达时间在派单时确定');
  assert.equal(store.listLetters().find((l) => l.id === letter.id).status, 'assigned');
  const transitHorse = store.listHorses().find((h) => h.id === 'horse-1');
  assert.equal(transitHorse.status, 'transit');
  assert.equal(transitHorse.currentLoad, 10);
  assert.equal(transitHorse.assignedTaskId, task.id);

  // 到达前一分钟推进时钟：不应结算
  const early = store.sweep(eta - MINUTE_MS);
  assert.deepEqual(early.settledTaskIds, []);
  assert.equal(store.listTasks()[0].status, 'in_progress');

  // 到达时刻推进时钟：任务准时结算
  const swept = store.sweep(eta);
  assert.deepEqual(swept.settledTaskIds, [task.id]);

  const settled = store.listTasks()[0];
  assert.equal(settled.status, 'completed', '按预计送达时刻抵达，记为准时');
  assert.equal(settled.actualArrivalTime, eta, '实际抵达时刻按派单时确定的预计送达时间记录');
  assert.equal(store.listLetters().find((l) => l.id === letter.id).status, 'delivered');
  const idleHorse = store.listHorses().find((h) => h.id === 'horse-1');
  assert.equal(idleHorse.status, 'idle');
  assert.equal(idleHorse.currentLoad, 0);
  assert.equal(idleHorse.assignedTaskId, null);

  const stats = store.statistics(eta);
  assert.equal(stats.todayDeliveries, 1, '当日送达随结算增长');
  assert.equal(stats.averageDeliveryTime, 90);
  assert.equal(stats.overtimeRate, 0);
});

test('超时判定：实际抵达晚于派单时确定的预计送达时间记为延迟并计入超时率', async () => {
  const store = await freshStore();
  const onTimeLetter = store.createLetter(sampleLetter, T0);
  const lateLetter = store.createLetter({ ...sampleLetter, receiver: '王维' }, T0);
  const onTimeTask = store.dispatch(onTimeLetter.id, 'horse-1', T0);
  const lateTask = store.dispatch(lateLetter.id, 'horse-2', T0);

  store.sweep(T0 + 90 * MINUTE_MS); // 两单都到点，准时结算
  assert.equal(store.listTasks().find((t) => t.id === onTimeTask.id).status, 'completed');

  // 另一单重新派出并手动延迟结算：终态由实际抵达与预计送达时间比较得出
  const letter2 = store.createLetter({ ...sampleLetter, receiver: '孟浩然' }, T0);
  const task2 = store.dispatch(letter2.id, 'horse-1', T0 + 90 * MINUTE_MS);
  const lateActual = task2.estimatedArrivalTime + 5 * MINUTE_MS;
  const settled = store.settleTask(task2.id, lateActual, lateActual);
  assert.equal(settled.status, 'delayed');
  assert.equal(store.listLetters().find((l) => l.id === letter2.id).status, 'delivered');
  assert.equal(store.listHorses().find((h) => h.id === 'horse-1').status, 'idle');

  // 已结算任务不能重复结算
  expectLifecycleError(() => store.settleTask(task2.id, lateActual), 'TASK_ALREADY_SETTLED');

  const stats = store.statistics(lateActual);
  assert.equal(stats.todayDeliveries, 3, '延迟送达同样计入当日送达');
  assert.equal(stats.overtimeRate, 33, '3 单中 1 单超时');
  assert.equal(lateTask.id !== onTimeTask.id, true);
});

test('冷却到期：休息结束后马匹自动回到可接单状态', async () => {
  const store = await freshStore();
  const resting = store.restHorse('horse-1', T0);
  assert.equal(resting.status, 'resting');
  assert.equal(resting.restCooldownEnd, T0 + REST_COOLDOWN_MS);

  // 休息中不可接单
  const letter = store.createLetter(sampleLetter, T0);
  expectLifecycleError(() => store.dispatch(letter.id, 'horse-1', T0), 'HORSE_NOT_IDLE');
  // 重复休息被拒绝
  expectLifecycleError(() => store.restHorse('horse-1', T0), 'HORSE_NOT_IDLE');

  // 冷却结束前一秒：仍在休息
  const notYet = store.sweep(T0 + REST_COOLDOWN_MS - 1000);
  assert.deepEqual(notYet.releasedHorseIds, []);
  assert.equal(store.listHorses().find((h) => h.id === 'horse-1').status, 'resting');

  // 冷却到期：自动回空闲，可再次接单
  const done = store.sweep(T0 + REST_COOLDOWN_MS);
  assert.deepEqual(done.releasedHorseIds, ['horse-1']);
  const horse = store.listHorses().find((h) => h.id === 'horse-1');
  assert.equal(horse.status, 'idle');
  assert.equal(horse.restCooldownEnd, null);

  const task = store.dispatch(letter.id, 'horse-1', T0 + REST_COOLDOWN_MS);
  assert.equal(task.status, 'in_progress');
});

test('重复派单与非法派单被明确拒绝，且不留下半截状态', async () => {
  const store = await freshStore();
  const letter = store.createLetter(sampleLetter, T0);
  store.dispatch(letter.id, 'horse-1', T0);

  // 同一封信重复派单：拒绝，且仍只有一个在途任务
  expectLifecycleError(() => store.dispatch(letter.id, 'horse-2', T0), 'LETTER_NOT_PENDING');
  assert.equal(store.listTasks().filter((t) => t.status === 'in_progress').length, 1);
  assert.equal(store.listHorses().find((h) => h.id === 'horse-2').status, 'idle');

  // 不存在的信件 / 不存在的马匹
  expectLifecycleError(() => store.dispatch('no-such-letter', 'horse-2', T0), 'LETTER_NOT_FOUND');
  const letter2 = store.createLetter({ ...sampleLetter, receiver: '白居易' }, T0);
  expectLifecycleError(() => store.dispatch(letter2.id, 'no-such-horse', T0), 'HORSE_NOT_FOUND');

  // 载重超限：拒绝后马匹仍空闲、信件仍待派、无任务产生（异常回退）
  const heavy = store.createLetter({ ...sampleLetter, receiver: '韩愈', weight: 60 }, T0);
  expectLifecycleError(() => store.dispatch(heavy.id, 'horse-2', T0), 'LOAD_EXCEEDED');
  assert.equal(store.listHorses().find((h) => h.id === 'horse-2').status, 'idle');
  assert.equal(store.listLetters().find((l) => l.id === heavy.id).status, 'pending');
  assert.equal(store.listTasks().length, 1);

  // 在途马匹不能安排休息（避免任务悬空）
  expectLifecycleError(() => store.restHorse('horse-1', T0), 'HORSE_NOT_IDLE');
  assert.equal(store.listTasks()[0].status, 'in_progress');
});

test('删除在途信件被拒绝；送达后删除不留悬空任务，历史与统计口径一致', async () => {
  const store = await freshStore();
  const pending = store.createLetter({ ...sampleLetter, receiver: '刘禹锡' }, T0);
  const inflight = store.createLetter(sampleLetter, T0);
  const task = store.dispatch(inflight.id, 'horse-1', T0);

  // 在途信件删除被拒绝，三方状态不受影响
  expectLifecycleError(() => store.deleteLetter(inflight.id), 'LETTER_IN_TRANSIT');
  assert.equal(store.listLetters().find((l) => l.id === inflight.id).status, 'assigned');
  assert.equal(store.listTasks()[0].status, 'in_progress');
  assert.equal(store.listHorses().find((h) => h.id === 'horse-1').status, 'transit');

  // 待派信件可删除，删除后再派单报信件不存在
  store.deleteLetter(pending.id);
  expectLifecycleError(() => store.dispatch(pending.id, 'horse-2', T0), 'LETTER_NOT_FOUND');

  // 送达后删除：任务历史仍完整（不悬空），统计口径不变
  store.sweep(T0 + 90 * MINUTE_MS);
  const statsBefore = store.statistics(T0 + 90 * MINUTE_MS);
  store.deleteLetter(inflight.id);
  const history = store.taskHistory(1, 20);
  assert.equal(history.total, 1);
  assert.equal(history.tasks[0].id, task.id);
  assert.equal(history.tasks[0].status, 'completed');
  assert.equal(history.tasks[0].destination, '（信件已删除）');
  const statsAfter = store.statistics(T0 + 90 * MINUTE_MS);
  assert.deepEqual(statsAfter, statsBefore, '统计来自任务事实，与是否删除信件无关');
  assert.equal(statsAfter.todayDeliveries, 1);
});
