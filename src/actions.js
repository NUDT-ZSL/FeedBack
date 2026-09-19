import { evaluateAccess, pathsToScope, scopeClosure } from "./domain.js";
import { PAGES, ITEMS, adminSource } from "./data.js";
import { ValidationError, reconcileSession } from "./store.js";

let localSequence = 1;
const id = (prefix) => `${prefix}-${Date.now().toString(36)}-${localSequence++}`;

function requireMember(state, memberId) {
  if (!state.members.some((member) => member.id === memberId)) {
    throw new ValidationError("UNKNOWN_MEMBER", `成员标识不存在：${memberId}`, {
      location: "memberId",
      memberId
    });
  }
}

function requireKnownRole(state, roleId, location) {
  if (!state.roles[roleId]) {
    throw new ValidationError("UNKNOWN_ROLE", `位置 ${location} 引用了未登记角色：${roleId}`, {
      location,
      roleId
    });
  }
}

function requireKnownScope(state, scopeId, location) {
  if (!state.scopes[scopeId]) {
    const chains = pathsToScope(scopeId, state.edges).map((path) => path.join(" → "));
    throw new ValidationError("UNKNOWN_SCOPE", `位置 ${location} 引用了不存在的范围：${scopeId}`, {
      location,
      scopeId,
      chains: chains.length ? chains : [`未找到通向 ${scopeId} 的链条`]
    });
  }
}

function assertNoCycle(edges, parent, child) {
  if (parent === child) {
    throw new ValidationError("SCOPE_CYCLE", `范围不能继承自身：${parent}`, {
      location: `edge ${parent} → ${child}`,
      chain: [parent, child]
    });
  }
  if (scopeClosure([child], edges).has(parent)) {
    const reverseEdges = new Map();
    for (const edge of edges) {
      if (!reverseEdges.has(edge.child)) reverseEdges.set(edge.child, []);
      reverseEdges.get(edge.child).push(edge.parent);
    }
    const paths = [];
    const walk = (node, trail) => {
      if (node === parent) {
        paths.push([...trail].reverse().join(" → "));
        return;
      }
      if (trail.includes(node)) return;
      for (const up of reverseEdges.get(node) ?? []) walk(up, [...trail, up]);
    };
    walk(child, [child]);
    throw new ValidationError("SCOPE_CYCLE",
      `新增继承 ${parent} → ${child} 会形成闭环`, {
        location: `edge ${parent} → ${child}`,
        chain: paths[0]?.split(" → ") ?? [parent, child],
        chains: paths.length ? paths : [`${parent} → ${child} → ${parent}`]
      });
  }
}

export function addMember(store, input) {
  const state = store.state;
  const memberId = String(input.memberId ?? "").trim();
  const roleId = String(input.roleId ?? "").trim();
  if (!memberId) {
    throw new ValidationError("INVALID_MEMBER", "成员唯一标识不能为空", { location: "member.memberId" });
  }
  if (state.members.some((member) => member.id === memberId)) {
    throw new ValidationError("DUPLICATE_MEMBER", `成员标识重复：${memberId}`, {
      location: "member.memberId",
      memberId
    });
  }
  requireKnownRole(state, roleId, "member.roleId");
  state.members.push({ id: memberId, name: input.name || memberId });
  state.assignments.push({
    id: id("asg"),
    memberId,
    roleId,
    source: input.source ?? adminSource(),
    content: input.content ?? `管理控制台：${memberId}=${roleId}`
  });
  store.refreshConflicts();
  return store.reconcile(`新增成员 ${memberId}`);
}

export function addRoleSource(store, input) {
  requireMember(store.state, input.memberId);
  requireKnownRole(store.state, input.roleId, "roleSource.roleId");
  const source = input.source ?? adminSource(input.sourceLabel ?? "第二来源");
  store.state.assignments.push({
    id: id("asg"),
    memberId: input.memberId,
    roleId: input.roleId,
    source,
    content: input.content ?? `${source.label}：${input.memberId}=${input.roleId}`
  });
  return store.reconcile(`追加 ${input.memberId} 的角色来源`);
}

export function addScopeDirective(store, input) {
  requireMember(store.state, input.memberId);
  requireKnownScope(store.state, input.scopeId, "scopeDirective.scopeId");
  if (!["allow", "deny"].includes(input.effect)) {
    throw new ValidationError("INVALID_DIRECTIVE", "授权范围指令必须为 allow 或 deny", {
      location: "scopeDirective.effect"
    });
  }
  const source = input.source ?? adminSource(input.sourceLabel ?? "范围来源");
  store.state.directives.push({
    id: id("dir"),
    memberId: input.memberId,
    scopeId: input.scopeId,
    effect: input.effect,
    source,
    content: input.content ?? `${source.label}：${input.effect} ${input.scopeId}`
  });
  return store.reconcile(`${source.label} 对 ${input.memberId} 追加 ${input.effect}`);
}

export function updateRole(store, input) {
  requireMember(store.state, input.memberId);
  requireKnownRole(store.state, input.roleId, "admin.roleId");
  const source = input.source ?? adminSource();
  if (!input.preserveOtherSources) {
    store.state.assignments = store.state.assignments
      .filter((record) => record.memberId !== input.memberId);
  }
  store.state.assignments.push({
    id: id("asg"),
    memberId: input.memberId,
    roleId: input.roleId,
    source,
    content: input.content ?? `${source.label}：调整 ${input.memberId} 为 ${input.roleId}`
  });
  return store.reconcile(`管理员调整 ${input.memberId} 角色`);
}

export function addScope(store, input) {
  const scopeId = String(input.scopeId ?? "").trim();
  if (!scopeId) {
    throw new ValidationError("INVALID_SCOPE", "范围标识不能为空", { location: "scope.scopeId" });
  }
  if (store.state.scopes[scopeId]) {
    throw new ValidationError("DUPLICATE_SCOPE", `范围标识重复：${scopeId}`, {
      location: "scope.scopeId",
      scopeId
    });
  }
  if (input.parentId) {
    if (!store.state.scopes[input.parentId]) {
      throw new ValidationError("UNKNOWN_SCOPE",
        `位置 scope.parentId 引用了不存在的范围：${input.parentId}`, {
          location: "scope.parentId",
          scopeId: input.parentId,
          chains: [`${input.parentId} → ${scopeId}`]
        });
    }
  }
  store.state.scopes[scopeId] = { id: scopeId, name: input.name || scopeId };
  if (input.parentId) {
    store.state.edges.push({ parent: input.parentId, child: scopeId });
  }
  store.refreshConflicts();
  store.emit("scope_added", { scopeId, parentId: input.parentId ?? null });
  return store.reconcile(`新增范围 ${scopeId}`);
}

export function addScopeEdge(store, input) {
  requireKnownScope(store.state, input.parent, "edge.parent");
  if (!store.state.scopes[input.child]) {
    throw new ValidationError("UNKNOWN_SCOPE",
      `位置 edge.child 引用了不存在的范围：${input.child}`, {
        location: "edge.child",
        scopeId: input.child,
        chains: [`${input.parent} → ${input.child}`]
      });
  }
  if (store.state.edges.some((edge) => edge.parent === input.parent && edge.child === input.child)) {
    return { identical: true, affectedPageIds: [] };
  }
  assertNoCycle(store.state.edges, input.parent, input.child);
  store.state.edges.push({ parent: input.parent, child: input.child });
  return store.reconcile(`新增继承 ${input.parent} → ${input.child}`);
}

export function createRole(store, input) {
  const roleId = String(input.roleId ?? "").trim();
  if (!roleId) {
    throw new ValidationError("INVALID_ROLE", "角色标识不能为空", { location: "role.roleId" });
  }
  if (store.state.roles[roleId]) {
    throw new ValidationError("DUPLICATE_ROLE", `角色标识重复：${roleId}`, {
      location: "role.roleId",
      roleId
    });
  }
  const grants = normalizeGrants(store.state, input.grants ?? []);
  store.state.roles[roleId] = { id: roleId, name: input.name || roleId, grants };
  store.refreshConflicts();
  store.emit("role_created", { roleId });
  return store.reconcile(`新增角色 ${roleId}`);
}

export function setRoleGrants(store, input) {
  requireKnownRole(store.state, input.roleId, "grant.roleId");
  const grants = normalizeGrants(store.state, input.grants ?? []);
  store.state.roles[input.roleId].grants = grants;
  if (input.name) store.state.roles[input.roleId].name = input.name;
  return store.reconcile(`调整角色 ${input.roleId} 授权`);
}

function normalizeGrants(state, rawGrants) {
  return rawGrants.map((grant, index) => {
    const page = String(grant.page ?? "").trim();
    const action = String(grant.action ?? "").trim();
    const scopeId = String(grant.scopeId ?? "").trim();
    const location = `role.grants[${index}]`;
    if (!PAGES[page]) {
      throw new ValidationError("UNKNOWN_PAGE", `位置 ${location}.page 引用了未登记页面：${page}`, {
        location: `${location}.page`,
        page
      });
    }
    if (!PAGES[page].actions.includes(action)) {
      throw new ValidationError("UNKNOWN_ACTION",
        `位置 ${location}.action 引用了未登记操作：${page}.${action}`, {
          location: `${location}.action`,
          action,
          allowedActions: PAGES[page].actions
        });
    }
    if (!state.scopes[scopeId]) {
      throw new ValidationError("UNKNOWN_SCOPE",
        `位置 ${location}.scopeId 引用了不存在的范围：${scopeId}`, {
          location: `${location}.scopeId`,
          scopeId,
          chains: [`${page}.${action} → ${scopeId}`]
        });
    }
    return { page, action, scopeId };
  });
}

export function resolveConflict(store, input, at = new Date().toISOString()) {
  const conflict = store.state.conflicts.find((record) => record.id === input.conflictId);
  if (!conflict) {
    throw new ValidationError("UNKNOWN_CONFLICT", `冲突不存在或已解除：${input.conflictId}`, {
      location: "resolve.conflictId",
      conflictId: input.conflictId
    });
  }
  const chosen = conflict.sources.find((record) => sourceMatches(record.source, input.source));
  if (!chosen) {
    throw new ValidationError("UNKNOWN_CONFLICT_SOURCE",
      `冲突保留的来源中找不到 ${input.source?.type}:${input.source?.id ?? ""}`, {
        location: "resolve.source",
        availableSources: conflict.sources.map((record) => record.source)
      });
  }
  if (conflict.type === "role_conflict") {
    const removed = store.state.assignments.filter((record) =>
      record.memberId === conflict.memberId && !sourceMatches(record.source, chosen.source));
    store.state.assignments = store.state.assignments.filter((record) =>
      !removed.some((removeRecord) => removeRecord.id === record.id));
    const resolutionEvent = {
      conflictId: conflict.id,
      retainedSource: chosen.source,
      retainedContent: chosen.content,
      removedSources: removed.map((record) => ({ source: record.source, content: record.content })),
      resolvedAt: at
    };
    const result = store.reconcile(`人工解除角色冲突 ${conflict.id}`, at);
    store.emit("conflict_resolved", resolutionEvent, at);
    return result;
  }
  const removed = store.state.directives.filter((record) =>
    record.memberId === conflict.memberId && record.scopeId === conflict.scopeId
    && !sourceMatches(record.source, chosen.source));
  store.state.directives = store.state.directives.filter((record) =>
    !removed.some((removeRecord) => removeRecord.id === record.id));
  const result = store.reconcile(`人工解除范围冲突 ${conflict.id}`, at);
  store.emit("conflict_resolved", {
    conflictId: conflict.id,
    retainedSource: chosen.source,
    retainedContent: chosen.content,
    removedSources: removed.map((record) => ({ source: record.source, content: record.content })),
    resolvedAt: at
  }, at);
  return result;
}

function sourceMatches(actual, requested) {
  return actual && requested && actual.type === requested.type && actual.id === requested.id;
}

function getSession(state, pageId) {
  const session = state.pageSessions.find((page) => page.id === pageId);
  if (!session) {
    throw new ValidationError("UNKNOWN_PAGE_SESSION", `页面会话不存在：${pageId}`, { pageId });
  }
  return session;
}

function currentInvalidMap(session) {
  return new Map(session.invalidations.map((entry) => [entry.itemId, entry]));
}

export function openPage(store, input, at = new Date().toISOString()) {
  const state = store.state;
  requireMember(state, input.memberId);
  if (!PAGES[input.page]) {
    throw new ValidationError("UNKNOWN_PAGE", `页面不存在：${input.page}`, { location: "openPage.page" });
  }
  const access = evaluateAccess(state, input.memberId, at);
  if (access.status !== "active" || !access.pages.includes(input.page)) {
    throw new ValidationError("PAGE_FORBIDDEN",
      access.status === "conflict"
        ? `成员 ${input.memberId} 存在授权冲突，不能打开页面`
        : `当前角色不能打开页面 ${input.page}`,
      { conflictIds: access.conflictIds, snapshot: access }
    );
  }
  const session = {
    id: id("page"),
    memberId: input.memberId,
    page: input.page,
    label: input.label || `${state.members.find((m) => m.id === input.memberId).name} / ${PAGES[input.page].name}`,
    openedAt: at,
    loadedAt: null,
    loadedItems: [],
    snapshot: null,
    snapshotHistory: [],
    invalidations: [],
    invalidationHistory: [],
    operations: []
  };
  state.pageSessions.push(session);
  reconcileOnOpen(store, session, at);
  loadPageData(store, { pageId: session.id }, at);
  store.emit("page_opened", { pageId: session.id, memberId: input.memberId, page: input.page }, at);
  return session;
}

function reconcileOnOpen(store, session, at) {
  const access = evaluateAccess(store.state, session.memberId, at);
  session.snapshot = { ...access, id: id("snapshot"), openedAt: session.openedAt };
  session.snapshotHistory.push({
    replacedAt: at,
    previousSnapshotId: null,
    previousEffectiveAt: null,
    previousRoleId: null,
    nextSnapshotId: session.snapshot.id
  });
}

export function loadPageData(store, input, at = new Date().toISOString()) {
  const state = store.state;
  const session = getSession(state, input.pageId);
  if (session.snapshot.status !== "active" || !session.snapshot.pages.includes(session.page)) {
    throw new ValidationError("STALE_PAGE",
      "页面当前授权已失效，不能继续加载新数据；已加载数据已保留并标记", {
        pageId: session.id,
        snapshotId: session.snapshot.id,
        conflictIds: session.snapshot.conflictIds
      });
  }
  const available = ITEMS.filter((item) => item.page === session.page
    && session.snapshot.accessibleScopes.includes(item.scopeId));
  const known = new Set(session.loadedItems.map((item) => item.id));
  const appended = available.filter((item) => !known.has(item.id));
  session.loadedItems.push(...appended.map((item) => ({ ...item, loadedAt: at })));
  session.loadedAt = at;
  store.emit("data_loaded", {
    pageId: session.id,
    appendedItemIds: appended.map((item) => item.id),
    snapshotId: session.snapshot.id
  }, at);
  return session;
}

export function startOperation(store, input, at = new Date().toISOString()) {
  const state = store.state;
  const session = getSession(state, input.pageId);
  const item = session.loadedItems.find((record) => record.id === input.itemId);
  if (!item) {
    throw new ValidationError("ITEM_NOT_LOADED", "只能对页面已加载的数据发起操作", {
      pageId: session.id,
      itemId: input.itemId
    });
  }
  const invalid = currentInvalidMap(session).get(item.id);
  if (invalid) {
    throw new ValidationError("ITEM_INVALID",
      `数据 ${item.id} 已在快照 ${session.snapshot.id} 中失效，禁止继续提交`, {
        invalidation: invalid
      });
  }
  const canAction = session.snapshot.status === "active"
    && session.snapshot.grants.some((grant) =>
      grant.page === session.page && grant.action === input.action
      && scopeClosure([grant.scopeId], state.edges).has(item.scopeId));
  if (!canAction) {
    throw new ValidationError("ACTION_FORBIDDEN",
      `当前快照不允许 ${session.page}.${input.action} @ ${item.scopeId}`, {
        snapshotId: session.snapshot.id
      });
  }
  const operation = {
    id: id("op"),
    itemId: item.id,
    itemTitle: item.title,
    scopeId: item.scopeId,
    action: input.action,
    status: "awaiting_confirmation",
    createdAt: at,
    blockedAt: null,
    blockReason: null,
    confirmedAt: null,
    evidence: {
      memberId: session.memberId,
      pageId: session.id,
      page: session.page,
      snapshotId: session.snapshot.id,
      snapshotEffectiveAt: session.snapshot.effectiveAt,
      roleId: session.snapshot.roleId,
      roleName: session.snapshot.role?.name ?? null,
      policyVersion: session.snapshot.policyVersion,
      itemSnapshot: { ...item },
      form: input.form ?? { note: "" }
    }
  };
  session.operations.unshift(operation);
  store.emit("operation_started", { pageId: session.id, operationId: operation.id }, at);
  return operation;
}

export function confirmOperation(store, input, at = new Date().toISOString()) {
  const session = getSession(store.state, input.pageId);
  const operation = session.operations.find((record) => record.id === input.operationId);
  if (!operation) {
    throw new ValidationError("UNKNOWN_OPERATION", `操作不存在：${input.operationId}`, {
      pageId: session.id,
      location: "confirm.operationId"
    });
  }
  if (operation.status === "pending_review") {
    throw new ValidationError("OPERATION_PENDING_REVIEW",
      `旧权限下发起的操作 ${operation.id} 已被收窄，保留为待处理，不能按旧授权确认生效`, {
        operationId: operation.id,
        blockedAt: operation.blockedAt,
        reason: operation.blockReason,
        evidenceSnapshotId: operation.evidence.snapshotId
      });
  }
  if (operation.status !== "awaiting_confirmation") {
    throw new ValidationError("OPERATION_NOT_CONFIRMABLE",
      `操作状态 ${operation.status} 不能确认`, { status: operation.status });
  }
  operation.status = "confirmed";
  operation.confirmedAt = at;
  operation.evidence.confirmedSnapshotId = session.snapshot.id;
  store.emit("operation_confirmed", { pageId: session.id, operationId: operation.id }, at);
  return operation;
}

export function resolvePendingOperation(store, input, at = new Date().toISOString()) {
  const session = getSession(store.state, input.pageId);
  const operation = session.operations.find((record) => record.id === input.operationId);
  if (!operation) {
    throw new ValidationError("UNKNOWN_OPERATION", `操作不存在：${input.operationId}`, {
      pageId: session.id
    });
  }
  if (operation.status !== "pending_review") {
    throw new ValidationError("OPERATION_NOT_PENDING",
      `只有 pending_review 可人工处置；当前为 ${operation.status}`, { status: operation.status });
  }
  const decision = input.decision === "retry" ? "retried_under_new_snapshot"
    : input.decision === "discard" ? "discarded" : "rejected";
  operation.status = decision;
  operation.reviewedAt = at;
  operation.reviewerNote = input.note || "";
  operation.evidence.resolutionSnapshotId = session.snapshot.id;
  store.emit("pending_operation_resolved", {
    pageId: session.id,
    operationId: operation.id,
    decision
  }, at);
  return operation;
}
