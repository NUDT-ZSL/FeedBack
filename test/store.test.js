import test from "node:test";
import assert from "node:assert/strict";
import { createStore, ValidationError } from "../src/store.js";
import {
  addMember,
  addRoleSource,
  addScopeDirective,
  addScopeEdge,
  confirmOperation,
  openPage,
  resolveConflict,
  startOperation,
  updateRole
} from "../src/actions.js";

async function expectValidation(fn, code) {
  let error;
  try {
    await fn();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, "预期请求被拒绝");
  assert.equal(error.name, "ValidationError");
  assert.equal(error.code, code);
}

function freshStore() {
  return createStore();
}

test("成员重复、未知角色、未知范围和成环继承都被拒绝并指出位置", async () => {
  const store = freshStore();
  await expectValidation(
    () => addMember(store, { memberId: "bob", roleId: "viewer" }),
    "DUPLICATE_MEMBER"
  );
  assert.equal(store.state.members.length, 4);

  await expectValidation(
    () => addMember(store, { memberId: "erin", roleId: "ghost" }),
    "UNKNOWN_ROLE"
  );
  assert.equal(store.state.members.some((member) => member.id === "erin"), false);

  await expectValidation(
    () => addScopeEdge(store, { parent: "cn", child: "missing" }),
    "UNKNOWN_SCOPE"
  );
  try {
    await addScopeEdge(store, { parent: "cn", child: "missing-chain" });
  } catch (error) {
    assert.equal(error.details.location, "edge.child");
    assert.deepEqual(error.details.chains, ["cn → missing-chain"]);
  }
  await expectValidation(
    () => addScopeEdge(store, { parent: "eu", child: "root" }),
    "SCOPE_CYCLE"
  );
  try {
    await addScopeEdge(store, { parent: "eu", child: "root" });
  } catch (error) {
    assert.deepEqual(error.details.chains, ["eu → root → eu"]);
  }
  assert.equal(store.state.edges.some((edge) => edge.parent === "eu" && edge.child === "root"), false);
});

test("角色收窄后只影响相关页面，已加载数据失效且旧操作待处理", async () => {
  const store = freshStore();
  const aliceOrders = openPage(store, { memberId: "alice", page: "orders" }, "2026-01-01T00:00:00.000Z");
  const aliceFinance = openPage(store, { memberId: "alice", page: "finance" }, "2026-01-01T00:01:00.000Z");
  const bobFinance = openPage(store, { memberId: "bob", page: "finance" }, "2026-01-01T00:01:30.000Z");
  const ordersSnapshotBefore = aliceOrders.snapshot.id;
  const financeSnapshotBefore = aliceFinance.snapshot.id;
  const bobSnapshotBefore = bobFinance.snapshot.id;
  const operation = startOperation(store, {
    pageId: aliceOrders.id,
    itemId: "ORD-101",
    action: "approve"
  }, "2026-01-01T00:02:00.000Z");

  const result = updateRole(store, {
    memberId: "alice",
    roleId: "viewer",
    source: { type: "admin", id: "console", label: "管理员收窄" },
    content: "管理员收窄：alice=viewer"
  }, "2026-01-01T00:03:00.000Z");

  assert.deepEqual(new Set(result.affectedPageIds), new Set([aliceFinance.id, aliceOrders.id]));
  assert.notEqual(aliceOrders.snapshot.id, ordersSnapshotBefore);
  assert.notEqual(aliceFinance.snapshot.id, financeSnapshotBefore);
  assert.equal(bobFinance.snapshot.id, bobSnapshotBefore);
  assert.equal(aliceFinance.snapshot.status, "active");
  assert.equal(aliceFinance.snapshot.pages.includes("finance"), true);
  assert.equal(aliceOrders.snapshot.pages.includes("orders"), true);
  assert.deepEqual(aliceOrders.loadedItems.map((item) => item.id), ["ORD-101", "ORD-102"]);
  assert.deepEqual(aliceOrders.invalidations.map((item) => item.itemId), ["ORD-101", "ORD-102"]);
  assert.equal(aliceOrders.invalidations[0].code, "scope_narrowed");
  assert.equal(aliceFinance.invalidations[0].code, "scope_narrowed");
  assert.match(operation.blockReason, /approve|授权范围/);
  assert.equal(operation.status, "pending_review");
  assert.ok(operation.blockedAt, "pending_review 必须记录阻断时刻");
  assert.equal(operation.evidence.snapshotId.startsWith("snapshot-"), true);
  assert.equal(operation.evidence.roleId, "hr_operator");
  assert.equal(operation.evidence.itemSnapshot.id, "ORD-101");

  await expectValidation(() => confirmOperation(store, {
    pageId: aliceOrders.id,
    operationId: operation.id
  }), "OPERATION_PENDING_REVIEW");
  await expectValidation(() => startOperation(store, {
    pageId: aliceOrders.id,
    itemId: "ORD-101",
    action: "approve"
  }), "ITEM_INVALID");
});

test("多个来源的角色/范围冲突双方保留，冲突解除后页面恢复收敛", async () => {
  const store = freshStore();
  const page = openPage(store, { memberId: "bob", page: "finance" }, "2026-02-01T00:00:00.000Z");
  await addRoleSource(store, {
    memberId: "bob",
    roleId: "admin",
    source: { type: "audit", id: "audit", label: "审计临时授权" },
    content: "审计临时授权：bob=admin"
  });
  assert.equal(store.state.conflicts.some((item) => item.type === "role_conflict"), true);
  assert.equal(page.snapshot.status, "conflict");
  assert.equal(page.snapshot.roleId, null);
  assert.equal(page.invalidations.length, page.loadedItems.length);
  await expectValidation(() => openPage(store, { memberId: "bob", page: "orders" }), "PAGE_FORBIDDEN");

  const conflict = store.state.conflicts.find((item) => item.type === "role_conflict");
  assert.equal(conflict.sources.length, 2);
  await resolveConflict(store, {
    conflictId: conflict.id,
    source: { type: "seed", id: "seed" }
  }, "2026-02-01T00:05:00.000Z");
  assert.equal(store.state.conflicts.some((item) => item.id === conflict.id), false);
  assert.equal(page.snapshot.status, "active");
  assert.equal(page.snapshot.roleId, "finance_auditor");
  assert.equal(page.invalidations.length, 0);
});

test("范围 allow/deny 矛盾会冻结范围且生成链条化记录", async () => {
  const store = freshStore();
  const page = openPage(store, { memberId: "bob", page: "finance" }, "2026-03-01T00:00:00.000Z");
  await addScopeDirective(store, {
    memberId: "bob",
    scopeId: "cn_south",
    effect: "allow",
    source: { type: "contract", id: "contract", label: "合同来源" },
    content: "合同来源：allow cn_south"
  });
  await addScopeDirective(store, {
    memberId: "bob",
    scopeId: "cn_south",
    effect: "deny",
    source: { type: "risk", id: "risk", label: "风控来源" },
    content: "风控来源：deny cn_south"
  });
  const invalid = page.invalidations.find((entry) => entry.itemId === "FIN-202");
  assert.equal(invalid.code, "scope_conflict");
  assert.match(invalid.basis, /allow\/deny/);
  const conflict = store.state.conflicts.find((item) => item.type === "scope_conflict");
  assert.deepEqual(conflict.sources.map((item) => item.source.type).sort(), ["contract", "risk"]);
});
