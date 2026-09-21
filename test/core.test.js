import test from "node:test";
import assert from "node:assert/strict";
import "../src/core.js";

const Engine = globalThis.ContextEngine;

const NOW = "2026-09-22T09:00:00.000Z";

function stateWithActivity(title = "活动") {
  const state = Engine.createState(NOW);
  Engine.addActivity(state, { id: "a1", title }, NOW);
  return state;
}

test("时效越早的无依赖条目越靠前，过期信息带风险提示", () => {
  const state = stateWithActivity();
  Engine.addEntry(state, {
    id: "later", activityId: "a1", kind: "todo", title: "晚些处理",
    validUntil: "2026-09-25T00:00:00.000Z"
  }, NOW);
  Engine.addEntry(state, {
    id: "urgent", activityId: "a1", kind: "todo", title: "立即核对",
    validUntil: "2026-09-22T12:00:00.000Z"
  }, NOW);
  Engine.addEntry(state, {
    id: "old", activityId: "a1", kind: "material", title: "过期材料",
    validUntil: "2026-09-20T00:00:00.000Z"
  }, NOW);

  const result = Engine.deriveActivity(state, "a1", NOW);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.steps.map((item) => item.entry.id), ["urgent", "later", "old"]);
  assert.match(result.warnings.join(";"), /已过期/);
});

test("依赖条目先于后继条目，形成恢复顺序", () => {
  const state = stateWithActivity();
  Engine.addEntry(state, { id: "next", activityId: "a1", kind: "todo", title: "后续", dependsOn: ["base"] }, NOW);
  Engine.addEntry(state, { id: "base", activityId: "a1", kind: "material", title: "前置材料" }, NOW);

  const result = Engine.deriveActivity(state, "a1", NOW);
  assert.deepEqual(result.steps.map((item) => item.entry.id), ["base", "next"]);
});

test("相互矛盾的条目同时保留，并在裁决前阻断续接结论", () => {
  const state = stateWithActivity();
  Engine.addEntry(state, { id: "x", activityId: "a1", kind: "idea", title: "方案 X" }, NOW);
  Engine.addEntry(state, { id: "y", activityId: "a1", kind: "idea", title: "方案 Y" }, NOW);
  Engine.addConflict(state, { entryAId: "x", entryBId: "y", note: "入口不一致" }, NOW);

  let result = Engine.deriveActivity(state, "a1", NOW);
  assert.equal(result.status, "conflict");
  assert.equal(result.activeEntries.length, 2);
  assert.equal(result.steps.length, 0);

  Engine.resolveConflict(state, result.openConflicts[0].id, { choice: "A", rationale: "X 已确认" }, NOW);
  result = Engine.deriveActivity(state, "a1", NOW);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.steps.map((item) => item.entry.id), ["x"]);
  assert.deepEqual(result.rejectedEntries.map((item) => item.entry.id), ["y"]);
});

test("依赖缺失时活动标记为不可信，并显式列出问题条目", () => {
  const state = stateWithActivity();
  Engine.addEntry(state, {
    id: "dangling", activityId: "a1", kind: "todo",
    title: "等待缺失材料", dependsOn: ["missing"]
  }, NOW);

  const result = Engine.deriveActivity(state, "a1", NOW);
  assert.equal(result.status, "untrusted");
  assert.equal(result.steps.length, 0);
  assert.equal(result.reasons[0].code, "missing-dependency");
  assert.equal(result.activeEntries[0].entry.id, "dangling");
});

test("依赖闭环时所有参与条目标记，且不生成静默顺序", () => {
  const state = stateWithActivity();
  Engine.addEntry(state, { id: "a", activityId: "a1", kind: "todo", title: "甲", dependsOn: ["c"] }, NOW);
  Engine.addEntry(state, { id: "b", activityId: "a1", kind: "todo", title: "乙", dependsOn: ["a"] }, NOW);
  Engine.addEntry(state, { id: "c", activityId: "a1", kind: "todo", title: "丙", dependsOn: ["b"] }, NOW);

  const result = Engine.deriveActivity(state, "a1", NOW);
  assert.equal(result.status, "untrusted");
  assert.deepEqual(new Set(result.reasons.map((reason) => reason.entryId)), new Set(["a", "b", "c"]));
});

test("闭环跨活动时，参与的活动均标记为不可信", () => {
  const state = Engine.createState(NOW);
  Engine.addActivity(state, { id: "a1", title: "活动一" }, NOW);
  Engine.addActivity(state, { id: "a2", title: "活动二" }, NOW);
  Engine.addEntry(state, { id: "one", activityId: "a1", kind: "todo", title: "一", dependsOn: ["two"] }, NOW);
  Engine.addEntry(state, { id: "two", activityId: "a2", kind: "todo", title: "二", dependsOn: ["one"] }, NOW);

  assert.equal(state.computed.a1.status, "untrusted");
  assert.equal(state.computed.a2.status, "untrusted");
  assert.equal(Engine.incrementalMatchesFull(state, NOW), true);
});

test("修正一个被依赖条目时，只重推其反向依赖闭包内的活动", () => {
  const state = Engine.createState(NOW);
  Engine.addActivity(state, { id: "a1", title: "上游" }, NOW);
  Engine.addActivity(state, { id: "a2", title: "受影响" }, NOW);
  Engine.addActivity(state, { id: "a3", title: "无关" }, NOW);
  Engine.addEntry(state, { id: "base", activityId: "a1", kind: "material", title: "基础材料" }, NOW);
  Engine.addEntry(state, { id: "child", activityId: "a2", kind: "todo", title: "依赖基础", dependsOn: ["base"] }, NOW);
  Engine.addEntry(state, { id: "solo", activityId: "a3", kind: "todo", title: "独立事项" }, NOW);

  const beforeA2 = JSON.stringify(state.computed.a2);
  const beforeA3 = JSON.stringify(state.computed.a3);
  Engine.updateEntry(state, "base", { status: "retired" }, NOW);

  assert.notEqual(JSON.stringify(state.computed.a2), beforeA2);
  assert.equal(state.computed.a2.status, "untrusted");
  assert.equal(JSON.stringify(state.computed.a3), beforeA3);
  assert.equal(Engine.incrementalMatchesFull(state, NOW), true);
});

test("裁决后增量重推结果与全量重推一致", () => {
  const state = stateWithActivity();
  Engine.addEntry(state, { id: "p", activityId: "a1", kind: "material", title: "旧口径" }, NOW);
  Engine.addEntry(state, { id: "q", activityId: "a1", kind: "material", title: "新口径" }, NOW);
  Engine.addEntry(state, { id: "task", activityId: "a1", kind: "todo", title: "按口径执行", dependsOn: ["p"] }, NOW);
  const conflict = Engine.addConflict(state, { entryAId: "p", entryBId: "q" }, NOW);
  Engine.resolveConflict(state, conflict.id, { choice: "B" }, NOW);

  assert.equal(Engine.incrementalMatchesFull(state, NOW), true);
  assert.equal(state.computed.a1.status, "untrusted");
  assert.match(state.computed.a1.reasons[0].message, /被否定/);
});
