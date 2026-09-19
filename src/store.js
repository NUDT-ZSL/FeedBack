import {
  buildConflicts,
  clone,
  evaluateAccess,
  pathsToScope,
  scopeClosure
} from "./domain.js";
import {
  INITIAL_ASSIGNMENTS,
  INITIAL_EDGES,
  INITIAL_MEMBERS,
  INITIAL_ROLES,
  ITEMS,
  PAGES,
  SCOPES
} from "./data.js";

let sequence = 1;
const nextId = (prefix) => `${prefix}-${Date.now().toString(36)}-${sequence++}`;

export class ValidationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ValidationError";
    this.code = code;
    this.details = details;
  }
}

function itemAccessReason(access, item, previous) {
  if (access.status === "conflict") {
    return { code: "member_conflict", basis: `成员存在角色/范围冲突：${access.conflictIds.join(", ")}` };
  }
  if (access.contestedScopes.includes(item.scopeId)) {
    return { code: "scope_conflict", basis: `范围 ${item.scopeId} 被 allow/deny 双向冻结` };
  }
  if (access.deniedScopes.includes(item.scopeId)) {
    return { code: "explicit_deny", basis: `范围 ${item.scopeId} 在新授权中被明确拒绝` };
  }
  if (!access.accessibleScopes.includes(item.scopeId)) {
    const oldBasis = previous?.scopeBasis?.[item.scopeId]?.[0];
    return {
      code: "scope_narrowed",
      basis: oldBasis
        ? `旧快照（${previous.id}，角色 ${oldBasis.roleName}）对 ${oldBasis.rootScopeId} 的授权不再覆盖 ${item.scopeId}`
        : `当前角色范围不再覆盖 ${item.scopeId}`
    };
  }
  return null;
}

export function reconcileSession(store, page, at) {
  const access = evaluateAccess(store.state, page.memberId, at);
  const previous = page.snapshot;
  const changed = !previous
    || previous.roleId !== access.roleId
    || previous.status !== access.status
    || JSON.stringify(previous.pages) !== JSON.stringify(access.pages)
    || JSON.stringify(previous.grants) !== JSON.stringify(access.grants)
    || JSON.stringify(previous.accessibleScopes) !== JSON.stringify(access.accessibleScopes)
    || JSON.stringify(previous.deniedScopes) !== JSON.stringify(access.deniedScopes)
    || JSON.stringify(previous.contestedScopes) !== JSON.stringify(access.contestedScopes);

  if (changed) {
    page.snapshotHistory.push({
      replacedAt: at,
      previousSnapshotId: page.snapshot?.id ?? null,
      previousEffectiveAt: page.snapshot?.effectiveAt ?? null,
      previousRoleId: page.snapshot?.roleId ?? null,
      nextSnapshotId: null
    });
    page.snapshot = { ...clone(access), id: nextId("snapshot"), openedAt: page.openedAt };
    const lastHistory = page.snapshotHistory[page.snapshotHistory.length - 1];
    if (lastHistory) lastHistory.nextSnapshotId = page.snapshot.id;
  }

  const invalidations = [];
  const pageAccessible = access.status === "active" && access.pages.includes(page.page);
  if (!pageAccessible) {
    for (const item of page.loadedItems) {
      invalidations.push({
        itemId: item.id,
        scopeId: item.scopeId,
        code: access.status === "conflict" ? "member_conflict" : "page_revoked",
        basis: access.status === "conflict"
          ? "成员授权来源冲突，页面无法收敛到单一生效角色"
          : `角色 ${access.role?.name ?? "空"} 不再包含页面 ${PAGES[page.page].name}`,
        detectedAt: at,
        snapshotId: page.snapshot.id
      });
    }
  } else {
    for (const item of page.loadedItems) {
    const reason = itemAccessReason(access, item, previous);
      if (reason) {
        invalidations.push({
          itemId: item.id,
          scopeId: item.scopeId,
          code: reason.code,
          basis: reason.basis,
          detectedAt: at,
          snapshotId: page.snapshot.id
        });
      }
    }
  }

  page.invalidationHistory.push(...page.invalidations
    .filter((old) => !invalidations.some((entry) => entry.itemId === old.itemId))
    .map((entry) => ({ ...entry, resolvedAt: at, resolution: "新快照重新授予访问" })));
  page.invalidations = invalidations;

  for (const operation of page.operations) {
    if (!["awaiting_confirmation", "pending_review"].includes(operation.status)) continue;
    const item = page.loadedItems.find((record) => record.id === operation.itemId);
    const missingPage = !pageAccessible;
    const matchingGrants = access.grants.filter((grant) =>
      grant.page === page.page && grant.action === operation.action);
    const missingAction = pageAccessible && !matchingGrants.length;
    const missingGrantScope = pageAccessible && matchingGrants.length > 0
      && !matchingGrants.some((grant) => scopeClosure([grant.scopeId], store.state.edges).has(item.scopeId));
    const missingData = item && itemAccessReason(access, item, previous);
    const invalidatedNow = page.invalidations.some((entry) => entry.itemId === operation.itemId);
    if (missingPage || missingAction || missingGrantScope || missingData || invalidatedNow) {
      operation.status = "pending_review";
      operation.blockedAt = at;
      operation.blockReason = missingPage
        ? (access.status === "conflict"
          ? "成员授权冲突，页面入口已冻结"
          : `页面 ${page.page} 已从角色中移除`)
        : missingAction
          ? `操作 ${page.page}.${operation.action} 已从角色 ${access.role?.name ?? "空"} 中移除`
          : missingGrantScope
            ? `角色 ${access.role?.name} 仍可 ${page.page}.${operation.action}，但授权范围不再覆盖 ${item.scopeId}`
          : missingData.basis;
      operation.evidence.snapshotIdAtSubmit = operation.evidence.snapshotIdAtSubmit ?? operation.evidence.snapshotId;
      operation.evidence.blockedSnapshotId = page.snapshot.id;
    }
  }
  return changed;
}

export function createStore() {
  const state = {
    pages: PAGES,
    scopes: clone(SCOPES),
    items: clone(ITEMS),
    roles: clone(INITIAL_ROLES),
    members: clone(INITIAL_MEMBERS),
    edges: clone(INITIAL_EDGES),
    assignments: clone(INITIAL_ASSIGNMENTS),
    directives: [],
    conflicts: [],
    pageSessions: [],
    events: [],
    policyVersion: 1
  };
  state.conflicts = buildConflicts(state.assignments, state.directives);

  const listeners = new Set();
  const store = {
    state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(type, payload = {}, at = new Date().toISOString()) {
      const event = { id: nextId("evt"), at, type, ...clone(payload) };
      state.events.unshift(event);
      state.events = state.events.slice(0, 200);
      for (const listener of listeners) listener(event);
      return event;
    },
    snapshot() {
      return clone(state);
    },
    refreshConflicts() {
      state.conflicts = buildConflicts(state.assignments, state.directives);
    },
    reconcile(reason, at = new Date().toISOString()) {
      state.policyVersion += 1;
      state.conflicts = buildConflicts(state.assignments, state.directives);
      const affected = [];
      for (const page of state.pageSessions) {
        const before = JSON.stringify({
          snapshot: page.snapshot,
          invalidations: page.invalidations,
          operations: page.operations
        });
        const changed = reconcileSession(store, page, at);
        const after = JSON.stringify({
          snapshot: page.snapshot,
          invalidations: page.invalidations,
          operations: page.operations
        });
        if (changed || before !== after) {
          affected.push(page.id);
        }
      }
      const event = this.emit("policy_reconciled", {
        reason,
        policyVersion: state.policyVersion,
        affectedPageIds: affected
      }, at);
      return { affectedPageIds: affected, event };
    }
  };
  return store;
}
