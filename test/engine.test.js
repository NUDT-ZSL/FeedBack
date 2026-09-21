const test = require("node:test");
const assert = require("node:assert/strict");

const {
  adjudicateConflict,
  analyze,
  applyContextEdit,
  createAnalysisState,
  recomputeChain,
} = require("../src/engine.js");
const model = require("../src/sample-data.js");

function byId(result, id) {
  return result.handoffs.find((item) => item.id === id);
}

function hasReason(item, code) {
  return item.reasons.some((reason) => reason.code === code);
}

test("沿依赖链计算状态，并显式暴露冲突、缺失依赖、成环和过期", () => {
  const result = analyze(model);
  assert.equal(byId(result, "H1").status, "ready");
  assert.equal(byId(result, "H2").status, "blocked");
  assert.equal(byId(result, "H3").status, "blocked");
  assert.equal(byId(result, "H4").status, "untrusted");
  assert.equal(byId(result, "H5").status, "untrusted");
  assert.equal(byId(result, "H6").status, "untrusted");
  assert.equal(byId(result, "H7").status, "untrusted");

  assert.equal(result.summary.unresolvedConflicts, 1);
  assert.ok(hasReason(byId(result, "H2"), "UNRESOLVED_CONFLICT"));
  assert.ok(hasReason(byId(result, "H3"), "MISSING_DEPENDENCY"));
  assert.equal(byId(result, "H3").trusted, false);
  assert.equal(byId(result, "H3").blockedByConflict, true);
  assert.equal(byId(result, "H3").chainCompleteness, 0.688);
  assert.ok(hasReason(byId(result, "H4"), "DEPENDENCY_CYCLE"));
  assert.ok(hasReason(byId(result, "H5"), "DEPENDENCY_CYCLE"));
  assert.ok(hasReason(byId(result, "H6"), "STALE_CONTEXT"));
  assert.ok(hasReason(byId(result, "H7"), "UPSTREAM_NOT_READY"));

  const conflict = result.conflicts[0];
  assert.equal(conflict.handoffId, "H2");
  assert.equal(conflict.key, "slaWindow");
  assert.deepEqual(conflict.entries.map((entry) => entry.id), ["C5", "C6"]);
  assert.equal(conflict.resolved, false);
});

test("裁决冲突后只重推下游链，并且结果等于完整重推", () => {
  const initial = analyze(model);
  const state = adjudicateConflict(createAnalysisState(), "H2", "slaWindow", {
    winnerContextId: "C6",
    note: "电话纪要更新，采用 15:00 承诺",
  });
  const full = analyze(model, state);
  const incremental = recomputeChain(model, state, ["H2"], initial);

  assert.deepEqual(incremental.affected.sort(), ["H2", "H3"]);
  assert.ok(incremental.reused.includes("H1"));
  assert.ok(incremental.reused.includes("H7"));
  assert.deepEqual(incremental.result, full);
  assert.equal(byId(full, "H2").status, "ready");
  assert.equal(byId(full, "H3").status, "untrusted");
  assert.ok(hasReason(byId(full, "H3"), "MISSING_DEPENDENCY"));
});

test("修改过期上下文后仅重推该项和其下游，完整度随之更新", () => {
  const initial = analyze(model);
  let state = createAnalysisState();
  state = applyContextEdit(state, "C12", {
    value: "vpat_live_new_rotated_token",
    validUntil: "2026-09-23T18:00:00+08:00",
    source: "密钥保险柜 v4（轮换后）",
  });
  const full = analyze(model, state);
  const incremental = recomputeChain(model, state, ["H6"], initial);

  assert.deepEqual(incremental.affected.sort(), ["H6", "H7"]);
  assert.deepEqual(incremental.result, full);
  assert.equal(byId(full, "H6").status, "ready");
  assert.equal(byId(full, "H7").status, "ready");
  assert.equal(byId(full, "H6").contextCompleteness, 1);
});

test("缺失上下文产生不完整状态，成环 SCC 中每个事项保持同样不可信结论", () => {
  const incompleteModel = JSON.parse(JSON.stringify(model));
  incompleteModel.contexts = incompleteModel.contexts.filter((item) => item.id !== "C1");
  const result = analyze(incompleteModel);
  assert.equal(byId(result, "H1").status, "incomplete");
  assert.ok(hasReason(byId(result, "H1"), "MISSING_CONTEXT"));
  assert.deepEqual(byId(result, "H4").reasons.find((item) => item.code === "DEPENDENCY_CYCLE").component, ["H4", "H5"]);
});

test("任意事项作为变更种子时，环扩展后的增量推演都与全量推演一致", () => {
  const initial = analyze(model);
  for (const seed of model.handoffs.map((item) => item.id)) {
    const changed = createAnalysisState();
    const full = analyze(model, changed);
    const incremental = recomputeChain(model, changed, [seed], initial);
    assert.deepEqual(incremental.result, full, `种子 ${seed} 的增量结果必须等于全量结果`);
  }

  const cyclicEdit = applyContextEdit(createAnalysisState(), "C10", {
    value: "更新后的付款证据",
    validUntil: "2026-09-26T09:00:00+08:00",
  });
  const cyclicIncrement = recomputeChain(model, cyclicEdit, ["H4"], initial);
  assert.deepEqual(cyclicIncrement.affected.sort(), ["H4", "H5"]);
  assert.deepEqual(cyclicIncrement.result, analyze(model, cyclicEdit));
});
