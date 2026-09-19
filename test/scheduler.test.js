/* 调度引擎离线验证：node test/scheduler.test.js */
"use strict";
const assert = require("assert");
const { createScheduler } = require("../scheduler.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok - " + name);
}

// 1. 任务与分片维护：重复标识 / 非正工作量被拒绝并指出位置；整批原子拒绝
test("校验：重复标识与非正工作量被拒绝并指出位置", function () {
  const s = createScheduler({ shardSize: 10, frameBudget: 6 });
  assert.ok(s.addTasks([{ id: "a", totalWork: 25, priority: 1 }]).ok);
  const r = s.addTasks([
    { id: "a", totalWork: 5 },              // 与既有任务重复
    { id: "b", totalWork: 0 },              // 非正工作量
    { id: "c", totalWork: -3 },             // 非正工作量
    { id: "d", totalWork: 4 },
    { id: "d", totalWork: 6 },              // 批内重复
  ]);
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.errors.map(e => e.index), [0, 1, 2, 4]);
  assert.strictEqual(r.errors[0].field, "id");
  assert.strictEqual(r.errors[1].field, "totalWork");
  assert.strictEqual(s.query("b"), null); // 整批拒绝，部分写入不存在
  assert.strictEqual(s.query("d"), null);
  const q = s.query("a");
  assert.strictEqual(q.shardCount, 3); // 25 = 10 + 10 + 5
  assert.deepStrictEqual(q.shards.map(x => x.work), [10, 10, 5]);
});

// 2. 生命周期：隐藏暂停保位、恢复续起，不整片重跑、不重复计入
test("生命周期：隐藏暂停保位，恢复从暂停点续起", function () {
  const s = createScheduler({ shardSize: 10, frameBudget: 4 });
  s.addTasks([{ id: "t", totalWork: 20, priority: 1 }]);
  s.step(); // 推进 4，分片#0 偏移 4
  s.setLifecycle("hidden");
  assert.deepStrictEqual(s.query("t").pausePosition, { shardIndex: 0, offset: 4 });
  assert.strictEqual(s.query("t").status, "paused");
  assert.strictEqual(s.query("t").lastEvent.type, "lifecycle");
  const idle = s.step();
  assert.ok(idle.idle);
  assert.strictEqual(s.query("t").completedWork, 4); // 隐藏期间不计入
  s.setLifecycle("visible");
  assert.strictEqual(s.query("t").status, "active");
  while (s.query("t").status !== "done") s.step();
  assert.strictEqual(s.query("t").completedWork, 20); // 恰好等于总工作量，无重复计入
  assert.strictEqual(s.query("t").pausePosition, null);
});

// 3. 额度不足：分片切小 / 顺延并说明依据，不丢片、不停滞
test("额度：分片超出额度被切小，整帧额度为零时顺延且不停滞", function () {
  const s = createScheduler({ shardSize: 10, frameBudget: 6 });
  s.addTasks([{ id: "big", totalWork: 10, priority: 1 }]);
  let rep = s.step(3); // 分片 10 > 额度 3 → 切小
  assert.strictEqual(rep.advances[0].amount, 3);
  assert.strictEqual(rep.defers.length, 1);
  assert.ok(rep.defers[0].reason.includes("切小"));
  assert.ok(s.query("big").deferReason.includes("顺延"));
  rep = s.step(0); // 整帧额度不足 → 顺延
  assert.strictEqual(rep.advances.length, 0);
  assert.strictEqual(rep.defers.length, 1);
  assert.ok(rep.defers[0].reason.includes("顺延"));
  assert.strictEqual(s.query("big").completedWork, 3);
  while (s.query("big").status !== "done") s.step(4);
  assert.strictEqual(s.query("big").completedWork, 10); // 未丢片、未停滞
});

// 4. 取消 / 调优先级：重算结果与从头重规划一致，未受影响位置不变
test("重规划：与从头重规划一致，未受影响任务推进位置不变", function () {
  const s = createScheduler({ shardSize: 10, frameBudget: 3 });
  s.addTasks([
    { id: "p1", totalWork: 30, priority: 1 },
    { id: "p2", totalWork: 30, priority: 2 },
    { id: "p3", totalWork: 30, priority: 3 },
  ]);
  s.step();
  s.step(); // p3 推进 6
  const before = s.query("p3");
  const beforeP2 = s.query("p2");
  s.setPriority("p1", 9);
  assert.deepStrictEqual(s.getQueue(), s.plannedOrder()); // 与从头重规划一致
  assert.strictEqual(s.getQueue()[0], "p1");
  assert.strictEqual(s.query("p3").completedWork, before.completedWork); // 位置不变
  assert.deepStrictEqual(s.query("p3").pausePosition, before.pausePosition);
  assert.deepStrictEqual(s.query("p2").pausePosition, beforeP2.pausePosition);
  s.cancel("p1");
  assert.deepStrictEqual(s.getQueue(), s.plannedOrder());
  assert.strictEqual(s.getQueue()[0], "p3");
  assert.strictEqual(s.query("p3").completedWork, before.completedWork);
  assert.strictEqual(s.query("p1").status, "cancelled");
  // 取消后 p3 从原偏移续跑，不回退
  s.step(3);
  assert.strictEqual(s.query("p3").completedWork, before.completedWork + 3);
});

// 5. 查询：字段齐全、剩余分片正确、结果按稳定顺序返回
test("查询：任意任务状态可查，结果按稳定顺序返回", function () {
  const s = createScheduler({ shardSize: 10, frameBudget: 6 });
  s.addTasks([
    { id: "x", totalWork: 15, priority: 2 },
    { id: "y", totalWork: 8, priority: 5 },
    { id: "z", totalWork: 20, priority: 2 },
  ]);
  s.step(); // y 先推进 6（优先级最高）
  const q = s.query("y");
  assert.strictEqual(q.completedWork, 6);
  assert.strictEqual(q.remainingShards.length, 1); // 8 工作量 = 1 个分片，推进 6 后仍剩该片
  assert.strictEqual(q.remainingShards[0].left, 2);
  assert.deepStrictEqual(q.pausePosition, { shardIndex: 0, offset: 6 });
  assert.ok(q.lastEvent);
  const all1 = s.queryAll().map(t => t.id);
  const all2 = s.queryAll().map(t => t.id);
  assert.deepStrictEqual(all1, all2); // 稳定顺序
  assert.deepStrictEqual(all1, ["y", "x", "z"]); // 优先级降序，同级按提交序
});

console.log("\n" + passed + " 项测试全部通过");
