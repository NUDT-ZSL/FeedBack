import assert from "node:assert/strict";
import test from "node:test";
import { createWorkbench, ValidationError, PermissionError } from "./core.js";

function freshWorkbench() {
  let clock = 1_700_000_000_000;
  return createWorkbench(() => clock += 100);
}

test("角色收窄只给同一成员打开的页面生成新快照，并阻断未确认操作", () => {
  const workbench = freshWorkbench();
  const before = workbench.state.sessions.map(session => ({ id: session.id, revision: session.currentRevision }));

  const result = workbench.addClaim({
    memberId: "u-li", kind: "role", valueId: "role-viewer",
    sourceId: "src-hr", sourceName: "HR 主数据"
  });
  const model = workbench.getViewModel();

  assert.equal(model.version, 2);
  assert.deepEqual(result.affected.filter(item => item.changed).map(item => item.memberId), ["u-li", "u-li"]);
  assert.equal(model.members.find(member => member.id === "u-wang").access.roleId, "role-finance");
  for (const session of model.sessions.filter(session => session.memberId === "u-li")) {
    assert.equal(session.currentRevision, 2);
    assert.equal(session.currentSnapshot.roleId, "role-viewer");
  }
  const pending = model.sessions.flatMap(session => session.operations).find(operation => operation.status === "blocked-pending");
  assert.ok(pending);
  assert.equal(pending.blockReasonCode, "ACTION_REVOKED");
  assert.match(pending.evidence, /权限收窄前/);
  assert.equal(pending.confirmedAt, undefined);
  assert.throws(
    () => workbench.confirmOperation({ operationId: pending.id }),
    error => error instanceof PermissionError && error.details.reason === "ACTION_REVOKED"
  );
  assert.deepEqual(before.map(item => item.revision), [1, 1]);
});

test("范围收窄后已加载数据保留并展示新快照下的失效依据", () => {
  const workbench = freshWorkbench();
  workbench.addClaim({
    memberId: "u-li", kind: "scope", valueId: "scope-budget",
    sourceId: "src-hr", sourceName: "HR 主数据"
  });
  const session = workbench.getViewModel().sessions[1];
  const invalid = session.invalidRecords;
  assert.deepEqual(invalid.map(item => item.recordId), ["rec-shanghai-approval", "rec-east-export"]);
  assert.ok(invalid.every(item => item.invalidReasonCode === "SCOPE_NARROWED"));
  assert.match(invalid[0].invalidBasis, /快照修订 2/);
  assert.match(invalid[0].invalidBasis, /scope-budget/);

  assert.throws(
    () => workbench.initiateOperation({ sessionId: session.id, recordId: "rec-shanghai-approval", actionId: "customers:approve" }),
    error => error instanceof PermissionError && error.details.reason === "SCOPE_NARROWED"
  );
});

test("不同来源给出不同范围时保留双方，冲突未决前权限不生效；裁定后收敛", () => {
  const workbench = freshWorkbench();
  workbench.addClaim({ memberId: "u-li", kind: "scope", valueId: "scope-budget", sourceId: "src-audit", sourceName: "审计临时权限单" });
  let model = workbench.getViewModel();
  const conflict = model.conflicts.find(item => item.memberId === "u-li" && item.kind === "scope" && item.status === "open");
  assert.ok(conflict);
  assert.match(conflict.summary, /李雯/);
  assert.match(conflict.summary, /HR 主数据/);
  assert.match(conflict.summary, /审计临时权限单/);
  assert.deepEqual(conflict.sources.map(source => source.valueId).sort(), ["scope-budget", "scope-shanghai"]);
  const member = model.members.find(item => item.id === "u-li");
  assert.equal(member.access.blockedByConflict, true);
  assert.equal(member.claims.length, 3);

  const winning = conflict.sources.find(source => source.valueId === "scope-shanghai").claimId;
  workbench.resolveConflict({ conflictId: conflict.id, winningClaimId: winning, decidedBy: "管理员", note: "保留 HR 范围" });
  model = workbench.getViewModel();
  const resolved = model.conflicts.find(item => item.id === conflict.id);
  assert.equal(resolved.status, "resolved");
  assert.equal(model.members.find(item => item.id === "u-li").access.rootScopeId, "scope-shanghai");
  assert.equal(model.members.find(item => item.id === "u-li").claims.length, 3);
});

test("继承范围会展开闭包，未受影响页面不产生新快照", () => {
  const workbench = freshWorkbench();
  const unaffectedRevision = workbench.state.sessions.find(session => session.memberId === "u-li").currentRevision;
  workbench.addClaim({
    memberId: "u-wang", kind: "scope", valueId: "scope-east",
    sourceId: "src-hr", sourceName: "HR 主数据"
  });
  const model = workbench.getViewModel();
  const wang = model.members.find(member => member.id === "u-wang");
  assert.deepEqual(wang.access.scopeIds, ["scope-east", "scope-shanghai"]);
  assert.equal(model.sessions.find(session => session.memberId === "u-li").currentRevision, unaffectedRevision);
  assert.deepEqual(model.events[0].affectedPages, []);
});

test("重复成员和未登记角色会被拒绝并指出位置", () => {
  const workbench = freshWorkbench();
  assert.throws(
    () => workbench.addMember({ id: "u-li", name: "重复李雯", roleId: "role-ops", scopeId: "scope-shanghai", sourceName: "HR 主数据" }),
    error => error instanceof ValidationError && error.details.some(detail => detail.path === "member.id")
  );
  assert.throws(
    () => workbench.addMember({ id: "u-new", name: "新人", roleId: "role-missing", scopeId: "scope-shanghai", sourceName: "HR 主数据" }),
    error => error instanceof ValidationError && error.details.some(detail => detail.kind === "unknown-role" && detail.path.includes("valueId"))
  );
  assert.equal(workbench.getViewModel().members.length, 3);
});

test("继承成环或引用不存在范围会被拒绝，并返回涉及链条", () => {
  const workbench = freshWorkbench();
  assert.throws(
    () => workbench.upsertScope({ id: "scope-shanghai", name: "上海", includes: ["scope-east"] }),
    error => error instanceof ValidationError
      && error.details.filter(detail => detail.kind === "scope-cycle").length === 1
      && error.details.some(detail => detail.kind === "scope-cycle"
        && detail.chain[0] === "scope-east" && detail.chain.at(-1) === "scope-east"
        && detail.chain.includes("scope-shanghai")
        && detail.path.endsWith(".includes[0]"))
  );
  assert.throws(
    () => workbench.upsertScope({ id: "scope-east", name: "华东", includes: ["scope-missing"] }),
    error => error instanceof ValidationError
      && error.details.filter(detail => detail.kind === "unknown-scope").length === 1
      && error.details.some(detail => detail.kind === "unknown-scope"
        && detail.chain[0] === "scope-east" && detail.chain.at(-1) === "scope-missing"
        && detail.path === "scopes[scope-east].includes[0]")
  );
  const model = workbench.getViewModel();
  assert.deepEqual(model.scopes.find(scope => scope.id === "scope-east").includes, ["scope-shanghai"]);
  assert.deepEqual(model.scopes.find(scope => scope.id === "scope-shanghai").includes, []);
});

test("页面快照可以追溯生效时刻、当时角色和角色来源", () => {
  const workbench = freshWorkbench();
  const opened = workbench.openSession({ memberId: "u-wang", pageId: "finance", title: "王磊财务页" });
  const snapshot = opened.session.currentSnapshot;
  assert.equal(snapshot.roleId, "role-finance");
  assert.equal(snapshot.roleName, "财务专员");
  assert.equal(typeof snapshot.effectiveAt, "number");
  assert.ok(snapshot.roleClaimId.startsWith("claim-"));
  assert.deepEqual(snapshot.actions, ["customers:view", "finance:view", "finance:post"]);

  workbench.upsertRole({
    id: "role-finance", name: "财务专员",
    pages: ["finance"], actions: ["finance:view"]
  });
  const converged = workbench.getViewModel().sessions.find(session => session.id === opened.session.id);
  assert.equal(converged.snapshots.length, 2);
  assert.equal(converged.snapshots[0].roleId, "role-finance");
  assert.equal(converged.currentSnapshot.actions.length, 1);
  assert.equal(converged.currentSnapshot.roleId, "role-finance");
});
