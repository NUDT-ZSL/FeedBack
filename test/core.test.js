const test = require("node:test");
const assert = require("node:assert/strict");
const { createCoordinator } = require("../src/core.js");

function manualSource() {
  const runs = [];
  return {
    runs,
    start(run) {
      runs.push(run);
    }
  };
}

function batch(batchId, items) {
  return { batchId, items };
}

function item(position, title, key) {
  return { position, id: `item-${position}`, title, summary: title, contentKey: key };
}

function selectedTitle(position) {
  return (position.chosen || position.visibleClaims[0]).item.title;
}

test("batch is bound to its birth context and cannot render after switching", () => {
  const source = manualSource();
  const coordinator = createCoordinator({ source });
  const first = coordinator.submit({ query: "alpha", page: 1 });
  const second = coordinator.submit({ query: "beta", page: 1 });

  source.runs[0].onStart(2);
  source.runs[0].onBatch(batch("old-1", [item(1, "old result", "old-v1")]));

  assert.equal(coordinator.getSnapshot().activeContext.key, second);
  assert.equal(coordinator.getSnapshot().activeContext.positions.length, 0);
  assert.equal(coordinator.getSnapshot().notices.length, 1);

  coordinator.switchContext(first);
  assert.equal(selectedTitle(coordinator.getSnapshot().activeContext.positions[0]), "old result");
});

test("returning to a prior context reuses arrived batches instead of refetching", () => {
  const source = manualSource();
  const coordinator = createCoordinator({ source });
  const first = coordinator.submit({ query: "alpha" });
  source.runs[0].onStart(2);
  source.runs[0].onBatch(batch("a1", [item(1, "alpha one", "alpha-one")]));
  coordinator.submit({ query: "beta" });

  coordinator.switchContext(first);
  const view = coordinator.getSnapshot().activeContext;
  assert.equal(view.arrivedBatches, 1);
  assert.equal(selectedTitle(view.positions[0]), "alpha one");
  assert.equal(source.runs.length, 2);

  source.runs[0].onBatch(batch("a2", [item(2, "alpha two", "alpha-two")]));
  assert.equal(coordinator.getSnapshot().activeContext.arrivedBatches, 2);
});

test("different content for the same position is both retained and marked contradictory", () => {
  const source = manualSource();
  const coordinator = createCoordinator({ source });
  const key = coordinator.submit({ query: "alpha" });
  const run = source.runs[0];
  run.onStart(2);
  run.onBatch(batch("a", [item(1, "original", "v1")]));
  run.onBatch(batch("b", [item(1, "revised", "v2")]));

  const position = coordinator.getSnapshot().activeContext.positions[0];
  assert.equal(position.status, "conflict");
  assert.deepEqual(position.visibleClaims.map((claim) => claim.item.title), ["original", "revised"]);

  coordinator.resolveConflict(key, 1, "v2");
  const resolved = coordinator.getSnapshot().activeContext.positions[0];
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.chosen.item.title, "revised");
  assert.equal(resolved.visibleClaims.length, 2);
});

test("stable entity id does not hide a revised content conflict", () => {
  const source = manualSource();
  const coordinator = createCoordinator({ source });
  coordinator.submit({ query: "alpha" });
  const run = source.runs[0];
  run.onBatch(batch("a", [{ position: 1, id: "same-entity", title: "标题", summary: "旧摘要" }]));
  run.onBatch(batch("b", [{ position: 1, id: "same-entity", title: "标题", summary: "新摘要" }]));

  const position = coordinator.getSnapshot().activeContext.positions[0];
  assert.equal(position.status, "conflict");
  assert.deepEqual(position.visibleClaims.map((claim) => claim.item.summary), ["旧摘要", "新摘要"]);
});

test("a claim arriving after adjudication reopens the conflict without losing the choice", () => {
  const source = manualSource();
  const coordinator = createCoordinator({ source });
  const key = coordinator.submit({ query: "alpha" });
  const run = source.runs[0];
  run.onBatch(batch("a", [item(1, "original", "v1")]));
  run.onBatch(batch("b", [item(1, "revised", "v2")]));
  coordinator.resolveConflict(key, 1, "v1");
  assert.equal(coordinator.getSnapshot().activeContext.positions[0].status, "resolved");

  run.onBatch(batch("c", [item(1, "late revision", "v3")]));
  const position = coordinator.getSnapshot().activeContext.positions[0];
  assert.equal(position.status, "conflict");
  assert.equal(position.hasNewerClaim, true);
  assert.equal(position.chosen.item.title, "original");
  assert.deepEqual(position.visibleClaims.map((claim) => claim.item.title), ["original", "revised", "late revision"]);
});

test("conflict adjudication and batch exclusion are local to one context", () => {
  const source = manualSource();
  const coordinator = createCoordinator({ source });
  const first = coordinator.submit({ query: "same", page: 1 });
  source.runs[0].onStart(2);
  source.runs[0].onBatch(batch("a", [item(1, "original", "v1")]));
  source.runs[0].onBatch(batch("b", [item(1, "revised", "v2")]));
  const second = coordinator.submit({ query: "same", page: 2 });
  source.runs[1].onStart(2);
  source.runs[1].onBatch(batch("a", [item(1, "original", "v1")]));
  source.runs[1].onBatch(batch("b", [item(1, "revised", "v2")]));

  coordinator.resolveConflict(first, 1, "v2");
  coordinator.excludeBatch(first, "b");
  coordinator.switchContext(second);
  const other = coordinator.getSnapshot().activeContext.positions[0];
  assert.equal(other.status, "conflict");
  assert.equal(other.chosen, null);
  assert.deepEqual(other.visibleClaims.map((claim) => claim.item.title), ["original", "revised"]);
});

test("out-of-order arrivals through switching converge to the same positions as one complete wait", () => {
  const switchedSource = manualSource();
  const switched = createCoordinator({ source: switchedSource });
  const switchedKey = switched.submit({ query: "alpha" });
  switched.submit({ query: "beta" });
  switchedSource.runs[0].onStart(3);
  switchedSource.runs[0].onBatch(batch("a", [item(1, "one", "one")]));
  switchedSource.runs[0].onBatch(batch("c", [item(3, "three", "three")]));
  switched.switchContext(switchedKey);
  switchedSource.runs[0].onBatch(batch("b", [item(2, "two", "two")]));
  switchedSource.runs[0].onComplete();

  const directSource = manualSource();
  const directCoordinator = createCoordinator({ source: directSource });
  directCoordinator.submit({ query: "alpha" });
  directSource.runs[0].onStart(3);
  directSource.runs[0].onBatch(batch("a", [item(1, "one", "one")]));
  directSource.runs[0].onBatch(batch("c", [item(3, "three", "three")]));
  directSource.runs[0].onBatch(batch("b", [item(2, "two", "two")]));
  directSource.runs[0].onComplete();

  assert.deepEqual(
    switched.getSnapshot().activeContext.positions.map((entry) => [entry.position, selectedTitle(entry)]),
    directCoordinator.getSnapshot().activeContext.positions.map((entry) => [entry.position, selectedTitle(entry)])
  );
  assert.equal(switched.getSnapshot().activeContext.status, "complete");
});

test("retriggering keeps an older transport useful and merges only missing batches", () => {
  const source = manualSource();
  const coordinator = createCoordinator({ source });
  const key = coordinator.submit({ query: "alpha" });
  source.runs[0].onStart(2);
  source.runs[0].onBatch(batch("a", [item(1, "one", "one")]));

  coordinator.retrigger(key);
  assert.equal(source.runs.length, 2);
  source.runs[1].onStart(2);
  source.runs[1].onBatch(batch("a", [item(1, "one", "one")]));
  source.runs[1].onBatch(batch("b", [item(2, "two-new", "two-new")]));
  source.runs[1].onComplete();

  let view = coordinator.getSnapshot().activeContext;
  assert.equal(view.arrivedBatches, 2);
  assert.equal(view.status, "loading");

  source.runs[0].onBatch(batch("b", [item(2, "two-old-late", "two-old-late")]));
  source.runs[0].onComplete();
  view = coordinator.getSnapshot().activeContext;
  assert.equal(view.arrivedBatches, 2);
  assert.equal(view.status, "complete");
  assert.equal(selectedTitle(view.positions[1]), "two-new");
});

test("excluding every visible batch marks the affected position excluded without deleting data", () => {
  const source = manualSource();
  const coordinator = createCoordinator({ source });
  const key = coordinator.submit({ query: "alpha" });
  const run = source.runs[0];
  run.onStart(2);
  run.onBatch(batch("a", [item(1, "original", "v1")]));
  run.onBatch(batch("b", [item(1, "revised", "v2")]));

  coordinator.excludeBatch(key, "a");
  let position = coordinator.getSnapshot().activeContext.positions[0];
  assert.equal(position.status, "unique");
  assert.equal(selectedTitle(position), "revised");

  coordinator.excludeBatch(key, "b");
  position = coordinator.getSnapshot().activeContext.positions[0];
  assert.equal(position.status, "excluded");
  assert.equal(position.claims.length, 2);

  coordinator.restoreBatch(key, "a");
  position = coordinator.getSnapshot().activeContext.positions[0];
  assert.equal(position.status, "unique");
  assert.equal(selectedTitle(position), "original");
});
