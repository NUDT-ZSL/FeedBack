"use strict";

const assert = require("assert");
const path = require("path");

global.window = undefined;
require(path.join(__dirname, "..", "js", "utils.js"));
require(path.join(__dirname, "..", "js", "core.js"));
require(path.join(__dirname, "..", "js", "server.js"));

const { WhiteboardStore, MockLocalServer } = globalThis.WB;

const baseA = {
  id: "a",
  type: "note",
  label: "A",
  x: 10,
  y: 20,
  width: 100,
  height: 80,
  color: "#fff"
};

function assertShape(actual, expectedPatch, message) {
  if (!expectedPatch) {
    assert.strictEqual(actual, undefined, message);
    return;
  }
  assert.ok(actual, message + "：元素应存在");
  Object.entries(expectedPatch).forEach(([key, value]) => {
    assert.strictEqual(actual[key], value, message + "：" + key);
  });
}

function testOptimisticAndDependencies() {
  const store = new WhiteboardStore({ initialElements: { a: baseA } });
  const move = store.updateElement("a", { x: 80 });
  const color = store.updateElement("a", { color: "#000" });
  assert.deepStrictEqual(color.dependencies, [move.id]);
  assertShape(store.getActiveElement("a"), { x: 80, color: "#000" });
  assert.strictEqual(store.getElementStatus("a"), "pending");
}

function testMoveDraftCanSplitAfterCommitDuringGesture() {
  const store = new WhiteboardStore({ initialElements: { a: baseA } });
  const draft = store.beginMoveDraft("a");
  store.updateMoveDraft(draft.id, 60, 70);
  assertShape(store.getActiveElement("a"), { x: 60, y: 70 });
  store.sendOperation(draft.id, 1);
  const remote = Object.assign({}, baseA, { x: 60, y: 70 });
  store.receiveOutcome({ opId: draft.id, revision: 1, status: "accepted", element: remote });
  assertShape(store.getActiveElement("a"), { x: 60, y: 70 });

  const continuation = store.beginMoveDraft("a");
  assert.deepStrictEqual(continuation.dependencies, [draft.id]);
  store.updateMoveDraft(continuation.id, 90, 75);
  assertShape(store.getActiveElement("a"), { x: 90, y: 75, color: "#fff" });
}

function testOutOfOrderCommit() {
  const store = new WhiteboardStore({ initialElements: { a: baseA } });
  const move = store.updateElement("a", { x: 80 });
  const independent = store.addElement(Object.assign({}, baseA, { id: "b", x: 200 }));
  const colored = store.updateElement("a", { color: "#123" });

  store.receiveOutcome({ opId: independent.id, revision: 2, status: "accepted", element: Object.assign({}, baseA, { id: "b", x: 200 }) });
  assert.strictEqual(store.getStats().revision, 0);
  store.receiveOutcome({ opId: move.id, revision: 1, status: "accepted", element: Object.assign({}, baseA, { x: 80 }) });
  assert.strictEqual(store.getStats().revision, 2);
  store.receiveOutcome({ opId: colored.id, revision: 3, status: "accepted", element: Object.assign({}, baseA, { x: 80, color: "#123" }) });
  assertShape(store.getCommittedElements().a, { x: 80, color: "#123" });
  store.assertConvergedWithReplay();
}

function testRejectCascadeKeepsIndependentOps() {
  const store = new WhiteboardStore({ initialElements: { a: baseA } });
  const badAdd = store.addElement(Object.assign({}, baseA, { id: "bad", x: 30 }));
  const dependentMove = store.updateElement("bad", { x: 90 });
  const independentAdd = store.addElement(Object.assign({}, baseA, { id: "kept", x: 300 }));

  store.receiveOutcome({ opId: badAdd.id, revision: 1, status: "rejected", reason: "denied" });
  store.receiveOutcome({ opId: independentAdd.id, revision: 2, status: "accepted", element: Object.assign({}, baseA, { id: "kept", x: 300 }) });
  store.receiveOutcome({ opId: dependentMove.id, revision: 3, status: "rejected", reason: "dependency denied" });

  assert.strictEqual(store.getOp(badAdd.id).status, "rolled-back");
  assert.strictEqual(store.getOp(dependentMove.id).status, "rolled-back");
  assert.strictEqual(store.getOp(independentAdd.id).status, "confirmed");
  assert.ok(!store.getActiveElement("bad"));
  assert.ok(store.getActiveElement("kept"));
  const group = store.getRollbackGroups()[0];
  assert.deepStrictEqual(group.opIds, [badAdd.id, dependentMove.id]);
  store.assertConvergedWithReplay();
}

function testDivergenceRollsDescendantsAndCommitsRemoteResult() {
  const store = new WhiteboardStore({ initialElements: { a: baseA } });
  const move = store.updateElement("a", { x: 80 });
  const followColor = store.updateElement("a", { color: "#111" });
  const remote = Object.assign({}, baseA, { x: 126, y: 52, color: "#fecdd3" });

  store.receiveOutcome({ opId: followColor.id, revision: 2, status: "rejected", reason: "stale dependency" });
  assert.strictEqual(store.getStats().revision, 0);
  store.receiveOutcome({ opId: move.id, revision: 1, status: "accepted", element: remote, reason: "normalized" });

  assert.strictEqual(store.getOp(move.id).status, "rolled-back");
  assert.strictEqual(store.getOp(followColor.id).status, "rolled-back");
  assertShape(store.getCommittedElements().a, { x: 126, color: "#fecdd3" });
  assertShape(store.getActiveElement("a"), { x: 126, color: "#fecdd3" });
  store.assertConvergedWithReplay();
}

function testRetryReappliesRolledBackBranch() {
  const store = new WhiteboardStore({ initialElements: {} });
  const add = store.addElement(Object.assign({}, baseA, { id: "retry" }));
  const move = store.updateElement("retry", { x: 111 });
  store.receiveOutcome({ opId: add.id, revision: 1, status: "rejected", reason: "temporary" });
  store.receiveOutcome({ opId: move.id, revision: 2, status: "rejected", reason: "missing parent" });

  const groupId = store.getRollbackGroups()[0].id;
  const result = store.retryGroup(groupId);
  assert.strictEqual(result.operations.length, 2);
  const [newAdd, newMove] = result.operations;
  const retryElement = newAdd.input.element;
  assert.deepStrictEqual(newMove.dependencies, [newAdd.id]);
  store.receiveOutcome({ opId: newAdd.id, revision: 3, status: "accepted", element: retryElement });
  store.receiveOutcome({ opId: newMove.id, revision: 4, status: "accepted", element: Object.assign({}, retryElement, { x: 111 }) });
  assertShape(store.getActiveElement("retry"), { x: 111 });
  assert.strictEqual(store.getOp(add.id).retried, true);
  store.assertConvergedWithReplay();
}

function testDivergenceRootIsRolledBackButRemoteStateRemainsRetriable() {
  const store = new WhiteboardStore({ initialElements: { a: baseA } });
  const move = store.updateElement("a", { x: 80, color: "#111" });
  const remote = Object.assign({}, baseA, { x: 126, y: 52, color: "#fecdd3" });
  store.receiveOutcome({ opId: move.id, revision: 1, status: "accepted", element: remote, reason: "normalized" });

  assert.strictEqual(store.getOp(move.id).status, "rolled-back");
  assertShape(store.getActiveElement("a"), { x: 126, color: "#fecdd3" });
  const group = store.getRollbackGroups()[0];
  assert.deepStrictEqual(group.opIds, [move.id]);
  const retried = store.retryGroup(group.id);
  assert.strictEqual(retried.operations.length, 1);
  assertShape(retried.operations[0].basisElement, { x: 126, color: "#fecdd3" });
  assertShape(retried.operations[0].expectedElement, { x: 80, color: "#111" });
  assert.deepStrictEqual(retried.operations[0].dependencies, []);
  const finalElement = Object.assign({}, remote, { x: 80, color: "#111" });
  store.receiveOutcome({ opId: retried.operations[0].id, revision: 2, status: "accepted", element: finalElement });
  assertShape(store.getActiveElement("a"), { x: 80, color: "#111" });
  store.assertConvergedWithReplay();
}

function testMockServerDependencyFailsOnStaleBasis() {
  const server = new MockLocalServer({ a: baseA }, { maxLatency: 0 });
  const store = new WhiteboardStore({ initialElements: { a: baseA } });
  server.arm("diverge");
  const move = store.updateElement("a", { x: 80 });
  const follow = store.updateElement("a", { color: "#000" });
  const firstOutcome = server.process(move, 1);
  const secondOutcome = server.process(follow, 2);
  assert.strictEqual(firstOutcome.status, "accepted");
  assert.strictEqual(secondOutcome.status, "rejected");
}

const tests = [
  testMoveDraftCanSplitAfterCommitDuringGesture,
  testOptimisticAndDependencies,
  testOutOfOrderCommit,
  testRejectCascadeKeepsIndependentOps,
  testDivergenceRollsDescendantsAndCommitsRemoteResult,
  testDivergenceRootIsRolledBackButRemoteStateRemainsRetriable,
  testRetryReappliesRolledBackBranch,
  testMockServerDependencyFailsOnStaleBasis
];

tests.forEach((test) => {
  test();
  console.log("✓", test.name);
});
console.log("\nAll", tests.length, "core tests passed.");
