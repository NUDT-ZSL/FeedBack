/**
 * 离线确定性验证：驿站调度状态闭环。
 *
 * 运行：node scripts/verify-lifecycle.mjs
 *
 * 使用注入的虚拟时钟推进时间，无需网络、无需起 HTTP 服务、无需等待真实时间。
 * 覆盖：抵达结算、冷却到期、重复派单、删除在途信件、异常回退/超时口径、跨视图不变量。
 */
import assert from 'node:assert/strict';
import { createStation, DomainError } from '../server/core.js';

const T0 = new Date('2026-10-08T10:00:00+08:00').getTime();
let now = T0;
const station = await createStation({ now: () => now, restCooldownMs: 30_000 });

let checks = 0;
function check(label, fn) {
  fn();
  checks += 1;
  console.log(`  ✓ ${label}`);
}
function expectError(label, fn, code) {
  let err;
  try { fn(); } catch (e) { err = e; }
  assert.ok(err instanceof DomainError, `${label}：应抛出 DomainError`);
  assert.equal(err.code, code, `${label}：错误码应为 ${code}，实际 ${err.code}`);
  checks += 1;
  console.log(`  ✓ ${label}（拒绝：${err.message}）`);
}

function newLetter(overrides = {}) {
  return station.addLetter({
    sender: '张三', receiver: '李四', destination: '长安',
    urgency: 'urgent', weight: 5, ...overrides,
  });
}

/* ------------------------------------------------------------------ *
 * 场景一：抵达结算
 * ------------------------------------------------------------------ */
console.log('\n[场景一] 抵达时刻到达后按预计送达时间结算');
{
  const letter = newLetter({ urgency: 'urgent' }); // 长安 120 分钟 × 0.5 = 60 分钟
  const horseId = 'horse-1';
  const task = station.dispatchTask({ letterId: letter.id, horseId });

  check('派单时固定预计到达时刻 = 出发 + 60 分钟', () => {
    assert.equal(task.estimatedArrivalTime - task.departureTime, 60 * 60_000);
    assert.equal(task.status, 'in_progress');
  });
  check('派单后：信件 assigned / 马匹 transit 挂同一任务', () => {
    assert.equal(station.getLetter(letter.id).status, 'assigned');
    const horse = station.getHorse(horseId);
    assert.equal(horse.status, 'transit');
    assert.equal(horse.assignedTaskId, task.id);
  });

  now = task.estimatedArrivalTime - 1;
  station.reconcile();
  check('预计时刻前 1ms：任务仍 in_progress、马匹仍 transit、今日送达为 0', () => {
    assert.equal(station.getTask(task.id).status, 'in_progress');
    assert.equal(station.getHorse(horseId).status, 'transit');
    assert.equal(station.getStatistics().todayDeliveries, 0);
  });

  now = task.estimatedArrivalTime;
  station.reconcile();
  check('预计时刻到达：任务 completed 且实际到达时刻 = 预计到达时刻', () => {
    const settled = station.getTask(task.id);
    assert.equal(settled.status, 'completed');
    assert.equal(settled.actualArrivalTime, settled.estimatedArrivalTime);
  });
  check('同步结算：信件 delivered、马匹 idle/空载/解绑任务', () => {
    assert.equal(station.getLetter(letter.id).status, 'delivered');
    const horse = station.getHorse(horseId);
    assert.equal(horse.status, 'idle');
    assert.equal(horse.currentLoad, 0);
    assert.equal(horse.assignedTaskId, null);
  });
  check('统计与明细一致：今日送达 1、平均时长 60 分、超时率 0%', () => {
    const stats = station.getStatistics();
    assert.deepEqual(stats, { todayDeliveries: 1, averageDeliveryTime: 60, overtimeRate: 0 });
  });
}

/* ------------------------------------------------------------------ *
 * 场景二：休息冷却到期自动恢复
 * ------------------------------------------------------------------ */
console.log('\n[场景二] 马匹休息冷却到期后自动回到可接单');
{
  const horseId = 'horse-2';
  station.restHorse(horseId);
  const resting = station.getHorse(horseId);
  check('休息后：resting 且冷却结束时刻 = 当前 + 30 秒', () => {
    assert.equal(resting.status, 'resting');
    assert.equal(resting.restCooldownEnd, now + 30_000);
  });

  const letter = newLetter();
  expectError('冷却中派单被拒绝', () => station.dispatchTask({ letterId: letter.id, horseId }), 'HORSE_NOT_IDLE');

  now += 29_999;
  station.reconcile();
  check('冷却到期前 1ms：仍 resting', () => {
    assert.equal(station.getHorse(horseId).status, 'resting');
  });

  now += 1;
  station.reconcile();
  check('冷却到期：自动 idle 且 restCooldownEnd 清空', () => {
    const horse = station.getHorse(horseId);
    assert.equal(horse.status, 'idle');
    assert.equal(horse.restCooldownEnd, null);
  });
  check('恢复后可正常接单', () => {
    const task = station.dispatchTask({ letterId: letter.id, horseId });
    assert.equal(task.status, 'in_progress');
    assert.equal(station.getHorse(horseId).status, 'transit');
  });
  // 结算收尾，方便后续不变量检查
  now = Math.max(now, station.getTask(station.getHorse(horseId).assignedTaskId).estimatedArrivalTime);
  station.reconcile();
}

/* ------------------------------------------------------------------ *
 * 场景三：重复派单被拒绝
 * ------------------------------------------------------------------ */
console.log('\n[场景三] 同一封信重复派单被拒绝，不产生第二个在途任务');
{
  const letter = newLetter();
  station.dispatchTask({ letterId: letter.id, horseId: 'horse-3' });
  expectError('对已派单信件再次派单被拒绝',
    () => station.dispatchTask({ letterId: letter.id, horseId: 'horse-4' }), 'LETTER_NOT_PENDING');

  check('该信件仍只有 1 个 in_progress 任务，horse-4 保持 idle', () => {
    const active = station.db
      .exec(`SELECT COUNT(*) AS c FROM tasks WHERE letterId = '${letter.id}' AND status = 'in_progress'`)[0]
      .values[0][0];
    assert.equal(active, 1);
    assert.equal(station.getHorse('horse-4').status, 'idle');
    assert.equal(station.getLetter(letter.id).status, 'assigned');
  });
}

/* ------------------------------------------------------------------ *
 * 场景四：删除在途信件被拒绝；删除待派发信件允许
 * ------------------------------------------------------------------ */
console.log('\n[场景四] 删除在途信件被拒绝，不产生悬空任务');
{
  const activeLetter = newLetter();
  const task = station.dispatchTask({ letterId: activeLetter.id, horseId: 'horse-4' });
  expectError('删除有在途任务的信件被拒绝',
    () => station.deleteLetter(activeLetter.id), 'LETTER_IN_TRANSIT');
  check('拒绝后事实不变：信件仍在、任务仍在途、马匹仍 transit', () => {
    assert.equal(station.getLetter(activeLetter.id).status, 'assigned');
    assert.equal(station.getTask(task.id).status, 'in_progress');
    assert.equal(station.getHorse('horse-4').status, 'transit');
  });

  const pendingLetter = newLetter();
  station.deleteLetter(pendingLetter.id);
  check('待派发信件可删除', () => {
    assert.equal(station.getLetter(pendingLetter.id), null);
  });
  expectError('对已删除信件派单返回 404',
    () => station.dispatchTask({ letterId: pendingLetter.id, horseId: 'horse-5' }), 'LETTER_NOT_FOUND');
}

/* ------------------------------------------------------------------ *
 * 场景五（补链）：异常回退与超时判定共用同一预计时刻
 * ------------------------------------------------------------------ */
console.log('\n[场景五] 异常回退释放马匹/信件，迟到上报按预计时刻判超时');
{
  const letter = newLetter({ urgency: 'regular' }); // 长安 120 × 2 = 240 分钟
  const task = station.dispatchTask({ letterId: letter.id, horseId: 'horse-5' });

  station.rollbackTask(task.id);
  check('回退后：任务 cancelled、信件回到 pending、马匹 idle 可再接单', () => {
    assert.equal(station.getTask(task.id).status, 'cancelled');
    assert.equal(station.getLetter(letter.id).status, 'pending');
    assert.equal(station.getHorse('horse-5').status, 'idle');
  });
  const reTask = station.dispatchTask({ letterId: letter.id, horseId: 'horse-5' });
  check('回退后同一封信可重新派单，新任务独立', () => {
    assert.notEqual(reTask.id, task.id);
    assert.equal(reTask.status, 'in_progress');
  });
  now = reTask.estimatedArrivalTime + 5 * 60_000; // 迟到 5 分钟
  station.reportArrival(reTask.id, now);
  check('迟到上报：任务 delayed，信件 delivered，超时率统计含该单', () => {
    assert.equal(station.getTask(reTask.id).status, 'delayed');
    assert.equal(station.getLetter(letter.id).status, 'delivered');
  });
  expectError('重复上报到达被拒绝', () => station.reportArrival(reTask.id, now), 'TASK_ALREADY_SETTLED');
}

/* ------------------------------------------------------------------ *
 * 全局不变量：信件 / 马匹 / 任务 / 统计任意时刻互相印证
 * ------------------------------------------------------------------ */
console.log('\n[全局不变量] 三方状态一致性与统计口径核对');
{
  station.reconcile();
  const tasks = station.listTasks();
  const letters = station.listLetters();
  const horses = station.listHorses();
  const inProgress = tasks.filter((t) => t.status === 'in_progress');

  check('每个 in_progress 任务：信件 assigned 且马匹 transit 且挂同一任务', () => {
    for (const t of inProgress) {
      const l = letters.find((x) => x.id === t.letterId);
      const h = horses.find((x) => x.id === t.horseId);
      assert.ok(l && h);
      assert.equal(l.status, 'assigned');
      assert.equal(h.status, 'transit');
      assert.equal(h.assignedTaskId, t.id);
    }
  });
  check('每封 assigned 信件恰好对应 1 个 in_progress 任务', () => {
    for (const l of letters.filter((x) => x.status === 'assigned')) {
      const count = inProgress.filter((t) => t.letterId === l.id).length;
      assert.equal(count, 1);
    }
  });
  check('每匹 transit 马恰好对应 1 个 in_progress 任务；resting 马冷却均未到期', () => {
    for (const h of horses) {
      if (h.status === 'transit') {
        const count = inProgress.filter((t) => t.horseId === h.id).length;
        assert.equal(count, 1);
      }
      if (h.status === 'resting') assert.ok(h.restCooldownEnd > now);
    }
  });
  check('无悬空任务：每个任务都能关联到真实马匹（信件删除只允许在无在途任务时发生）', () => {
    for (const t of tasks) {
      assert.ok(horses.some((h) => h.id === t.horseId));
      if (t.status === 'in_progress') assert.ok(letters.some((l) => l.id === t.letterId));
    }
  });
  check('统计数值可由任务明细独立重算得出', () => {
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const finished = tasks.filter((t) => t.status === 'completed' || t.status === 'delayed');
    const expectToday = finished.filter((t) => t.actualArrivalTime >= todayStart.getTime()).length;
    const expectRate = finished.length
      ? Math.round(finished.filter((t) => t.status === 'delayed').length / finished.length * 100)
      : 0;
    const expectAvg = finished.length
      ? Math.round(finished.reduce((s, t) => s + (t.actualArrivalTime - t.departureTime), 0)
        / finished.length / 60_000)
      : 0;
    const stats = station.getStatistics();
    assert.equal(stats.todayDeliveries, expectToday);
    assert.equal(stats.overtimeRate, expectRate);
    assert.equal(stats.averageDeliveryTime, expectAvg);
  });
}

console.log(`\n全部 ${checks} 项断言通过。`);
