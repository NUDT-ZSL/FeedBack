const test = require("node:test");
const assert = require("node:assert/strict");
const SearchStore = require("../core.js");
require("../data.js");

const { SearchSimulator } = globalThis;
const inputA = { query: "合同 风险", filter: "all", page: 1 };
const inputB = { query: "发票", filter: "doc", page: 2 };

function batchEnvelope(token, input, index) {
  return {
    contextKey: token.key,
    runId: token.runId,
    totalBatches: SearchSimulator.totalBatches,
    batch: SearchSimulator.makeBatch(input, index)
  };
}

test("切换上下文后的批次缓存到所属上下文，不渲染到当前视图", () => {
  const store = new SearchStore();
  const a = store.startContext(inputA);
  assert.equal(store.ingestBatch(batchEnvelope(a, inputA, 0)).state, "rendered");

  const b = store.startContext(inputB);
  const laterA = store.ingestBatch(batchEnvelope(a, inputA, 1));
  assert.equal(laterA.state, "cached-for-other-context");
  assert.equal(store.getActive().key, b.key);
  assert.deepEqual(store.deriveView(b.key).rows, []);

  store.setActive(a.key);
  const view = store.deriveView(a.key);
  assert.equal(view.context.arrived.length, 2);
  assert.ok(view.rows.some((row) => row.locationId === "loc-004"));
  assert.equal(view.context.staleBatchCount, 1);
});

test("重新触发后，旧运行的批次必须过期且不能写入", () => {
  const store = new SearchStore();
  const first = store.startContext(inputA);
  store.ingestBatch(batchEnvelope(first, inputA, 0));

  const second = store.startContext(inputA, { force: true });
  assert.notEqual(first.runId, second.runId);
  const stale = store.ingestBatch(batchEnvelope(first, inputA, 1));
  assert.equal(stale.state, "superseded-run");

  const ctx = store.contexts.get(second.key);
  assert.equal(ctx.arrived.length, 0);
  assert.equal(store.staleEvents[0].reason, "superseded");
});

test("同一位置的不同内容同时保留，可裁决且不影响其他上下文", () => {
  const store = new SearchStore();
  const a = store.startContext(inputA);
  const b = store.startContext(inputB);
  store.setActive(a.key);

  store.ingestBatch(batchEnvelope(a, inputA, 0));
  store.ingestBatch({
    contextKey: a.key,
    runId: a.runId,
    totalBatches: SearchSimulator.totalBatches,
    batch: SearchSimulator.makeConflictBatch(inputA)
  });

  let view = store.deriveView(a.key);
  const conflict = view.rows.find((row) => row.locationId === "loc-001");
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.variants.length, 2);

  store.chooseVariant(a.key, "loc-001", conflict.variants[1].batchId);
  view = store.deriveView(a.key);
  assert.equal(view.rows[0].selected.batchId, conflict.variants[1].batchId);
  assert.equal(view.rows[0].resolved, true);
  assert.deepEqual(store.contexts.get(b.key).decisions.selectedByLocation.size, 0);
});

test("批次排除只改变所属上下文的派生结论，并可撤销", () => {
  const store = new SearchStore();
  const token = store.startContext(inputA);
  for (let i = 0; i < SearchSimulator.totalBatches; i += 1) {
    store.ingestBatch(batchEnvelope(token, inputA, i));
  }
  store.excludeBatch(token.key, "batch-1-3");
  const view = store.deriveView(token.key);
  assert.equal(view.excludedCount, 1);
  assert.ok(!view.rows.some((row) => row.selected && row.selected.batchId === "batch-1-3"));

  store.restoreBatch(token.key, "batch-1-3");
  assert.equal(store.deriveView(token.key).excludedCount, 0);
});

test("切换中断后继续接收，最终结果与一次性完整等待一致", () => {
  const interrupted = new SearchStore();
  const direct = new SearchStore();
  const ia = interrupted.startContext(inputA);
  const da = direct.startContext(inputA);

  interrupted.ingestBatch(batchEnvelope(ia, inputA, 0));
  interrupted.startContext(inputB);
  interrupted.ingestBatch(batchEnvelope(ia, inputA, 1));
  interrupted.setActive(ia.key);
  interrupted.ingestBatch(batchEnvelope(ia, inputA, 2));
  interrupted.startContext(inputB);
  interrupted.ingestBatch(batchEnvelope(ia, inputA, 3));

  for (let i = 0; i < SearchSimulator.totalBatches; i += 1) {
    direct.ingestBatch(batchEnvelope(da, inputA, i));
  }

  const compact = (view) => view.rows.map((row) => ({
    locationId: row.locationId,
    conflict: row.conflict,
    hash: row.selected.contentHash,
    title: row.selected.item.title
  }));
  assert.deepEqual(compact(interrupted.deriveView(ia.key)), compact(direct.deriveView(da.key)));
});
