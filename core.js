// Pure permission-domain logic. No HTTP or browser globals are used here.

export const PAGES = [
  { id: "customers", name: "客户事项", actions: [
    { id: "customers:view", name: "查看客户事项" },
    { id: "customers:approve", name: "审批客户事项" },
    { id: "customers:export", name: "导出客户数据" }
  ]},
  { id: "finance", name: "财务凭证", actions: [
    { id: "finance:view", name: "查看凭证" },
    { id: "finance:post", name: "记账确认" }
  ]},
  { id: "admin", name: "管理后台", actions: [
    { id: "admin:manage", name: "维护成员与授权" }
  ]}
];

export const PAGE_MAP = new Map(PAGES.map(page => [page.id, page]));
export const ACTION_MAP = new Map(PAGES.flatMap(page => page.actions.map(action => [action.id, { ...action, pageId: page.id }])));

export class ValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "ValidationError";
    this.code = "VALIDATION_ERROR";
    this.details = details;
  }
}

export class PermissionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "PermissionError";
    this.code = "PERMISSION_DENIED";
    this.details = details;
  }
}

const deepClone = value => JSON.parse(JSON.stringify(value));

export function createInitialState(now = Date.now) {
  return {
    version: 1,
    sequence: 0,
    now,
    members: [],
    roles: [],
    scopes: [],
    claims: [],
    records: [],
    sessions: [],
    conflicts: [],
    resolutions: {},
    events: []
  };
}

export function seedState(now = Date.now) {
  const state = createInitialState(now);
  state.roles = [
    { id: "role-ops", name: "运营专员", pages: ["customers"], actions: ["customers:view", "customers:approve"], updatedAt: now() },
    { id: "role-finance", name: "财务专员", pages: ["customers", "finance"], actions: ["customers:view", "finance:view", "finance:post"], updatedAt: now() },
    { id: "role-admin", name: "管理员", pages: ["customers", "finance", "admin"], actions: ["customers:view", "customers:approve", "customers:export", "finance:view", "finance:post", "admin:manage"], updatedAt: now() },
    { id: "role-viewer", name: "只读成员", pages: ["customers"], actions: ["customers:view"], updatedAt: now() }
  ];
  state.scopes = [
    { id: "scope-china", name: "全国", includes: [], updatedAt: now() },
    { id: "scope-east", name: "华东", includes: ["scope-shanghai"], updatedAt: now() },
    { id: "scope-shanghai", name: "上海", includes: [], updatedAt: now() },
    { id: "scope-budget", name: "预算内凭证", includes: [], updatedAt: now() }
  ];
  state.members = [
    { id: "u-li", name: "李雯", createdAt: now() },
    { id: "u-wang", name: "王磊", createdAt: now() },
    { id: "u-zhao", name: "赵宁", createdAt: now() }
  ];
  state.records = [
    { id: "rec-shanghai-approval", title: "上海客户升级审批", pageId: "customers", scopeId: "scope-shanghai", updatedAt: now() },
    { id: "rec-east-export", title: "华东客户名单导出", pageId: "customers", scopeId: "scope-east", updatedAt: now() },
    { id: "rec-budget-voucher", title: "预算内采购凭证", pageId: "finance", scopeId: "scope-budget", updatedAt: now() }
  ];
  addSeedClaim(state, { memberId: "u-li", kind: "role", valueId: "role-ops", sourceId: "src-hr", sourceName: "HR 主数据" });
  addSeedClaim(state, { memberId: "u-li", kind: "scope", valueId: "scope-shanghai", sourceId: "src-hr", sourceName: "HR 主数据" });
  addSeedClaim(state, { memberId: "u-wang", kind: "role", valueId: "role-finance", sourceId: "src-hr", sourceName: "HR 主数据" });
  addSeedClaim(state, { memberId: "u-wang", kind: "scope", valueId: "scope-budget", sourceId: "src-hr", sourceName: "HR 主数据" });
  addSeedClaim(state, { memberId: "u-zhao", kind: "role", valueId: "role-admin", sourceId: "src-hr", sourceName: "HR 主数据" });
  addSeedClaim(state, { memberId: "u-zhao", kind: "scope", valueId: "scope-china", sourceId: "src-hr", sourceName: "HR 主数据" });

  const first = openSessionInternal(state, "u-li", "customers", "页签 A：客户队列");
  loadSessionRecords(state, first);
  const second = openSessionInternal(state, "u-li", "customers", "页签 B：批量客户");
  loadSessionRecords(state, second);
  createOperationInternal(state, second.id, "rec-shanghai-approval", "customers:approve");
  state.events = [];
  return state;
}

function addSeedClaim(state, input) {
  const id = `claim-${input.memberId}-${input.kind}-${state.claims.filter(c => c.memberId === input.memberId && c.kind === input.kind).length + 1}`;
  state.claims.push({ id, ...input, createdAt: state.now(), updatedAt: state.now() });
}

function nextId(state, prefix) {
  state.sequence += 1;
  return `${prefix}-${state.sequence}`;
}

function fail(message, details) {
  throw new ValidationError(message, details);
}

export function validateConfiguration(state) {
  const details = [];
  const add = (kind, path, message, extra = {}) => details.push({ kind, path, message, ...extra });
  const seen = new Set();
  for (const member of state.members) {
    if (seen.has(member.id)) add("duplicate-member-id", `members[${member.id}]`, `成员标识 ${member.id} 重复`);
    seen.add(member.id);
  }
  const roleIds = new Set();
  const roleSeen = new Set();
  for (const role of state.roles) {
    if (roleSeen.has(role.id)) add("duplicate-role-id", `roles[${role.id}]`, `角色标识 ${role.id} 重复`);
    roleSeen.add(role.id); roleIds.add(role.id);
    for (const pageId of role.pages ?? []) if (!PAGE_MAP.has(pageId)) add("unknown-page", `roles[${role.id}].pages`, `角色 ${role.id} 引用未登记页面 ${pageId}`, { reference: pageId });
    for (const actionId of role.actions ?? []) {
      const action = ACTION_MAP.get(actionId);
      if (!action) add("unknown-action", `roles[${role.id}].actions`, `角色 ${role.id} 引用未登记操作 ${actionId}`, { reference: actionId });
      else if (!(role.pages ?? []).includes(action.pageId)) add("action-without-page", `roles[${role.id}].actions`, `操作 ${actionId} 所属页面未在角色 ${role.id} 的页面中`, { reference: action.pageId });
    }
  }
  const scopeIds = new Set();
  const scopeSeen = new Set();
  for (const scope of state.scopes) {
    if (scopeSeen.has(scope.id)) add("duplicate-scope-id", `scopes[${scope.id}]`, `授权范围标识 ${scope.id} 重复`);
    scopeSeen.add(scope.id); scopeIds.add(scope.id);
  }
  const scopeMap = new Map(state.scopes.map(scope => [scope.id, scope]));
  const reported = new Set();
  const rotateCycle = nodes => {
    const firstIndex = nodes.indexOf([...nodes].sort()[0]);
    return [...nodes.slice(firstIndex), ...nodes.slice(0, firstIndex), nodes[firstIndex]];
  };
  const findBackPath = (start, target, seen = new Set()) => {
    if (start === target) return [];
    if (seen.has(start)) return null;
    seen.add(start);
    for (const child of scopeMap.get(start)?.includes ?? []) {
      if (child === target) return [child];
      if (scopeMap.has(child)) {
        const rest = findBackPath(child, target, seen);
        if (rest) return [child, ...rest];
      }
    }
    return null;
  };
  for (const scope of state.scopes) {
    for (const [index, child] of (scope.includes ?? []).entries()) {
      const path = `scopes[${scope.id}].includes[${index}]`;
      if (!scopeMap.has(child)) {
        const key = `missing:${[scope.id, child].join("|")}`;
        if (!reported.has(key)) {
          reported.add(key);
          add("unknown-scope", path, `授权范围引用不存在：${scope.id} -> ${child}`, { chain: [scope.id, child], reference: child });
        }
        continue;
      }
      const backPath = findBackPath(child, scope.id);
      if (backPath) {
        const fullPath = [scope.id, child, ...backPath];
        const nodes = [...new Set(fullPath.slice(0, -1))];
        const key = `cycle:${[...nodes].sort().join("|")}`;
        if (!reported.has(key)) {
          reported.add(key);
          const chain = rotateCycle(nodes);
          add("scope-cycle", path, `授权范围继承成环：${chain.join(" -> ")}`, { chain });
        }
      }
    }
  }
  for (const [index, record] of state.records.entries()) {
    if (!PAGE_MAP.has(record.pageId)) add("unknown-page", `records[${index}].pageId`, `事项 ${record.id} 引用未登记页面 ${record.pageId}`);
    if (!scopeIds.has(record.scopeId)) add("unknown-scope", `records[${index}].scopeId`, `事项 ${record.id} 引用不存在范围 ${record.scopeId}`, { chain: [record.scopeId] });
  }
  const memberIds = new Set(state.members.map(member => member.id));
  for (const [index, claim] of state.claims.entries()) {
    const base = `claims[${index}:${claim.id}]`;
    if (!memberIds.has(claim.memberId)) add("unknown-member", `${base}.memberId`, `授权来源引用未登记成员 ${claim.memberId}`);
    if (claim.kind === "role" && !roleIds.has(claim.valueId)) add("unknown-role", `${base}.valueId`, `位置 ${base}.valueId 引用未登记角色 ${claim.valueId}`, { reference: claim.valueId });
    if (claim.kind === "scope" && !scopeIds.has(claim.valueId)) add("unknown-scope", `${base}.valueId`, `位置 ${base}.valueId 引用不存在范围 ${claim.valueId}`, { chain: [claim.valueId], reference: claim.valueId });
    if (!["role", "scope"].includes(claim.kind)) add("unknown-claim-kind", `${base}.kind`, `授权类型必须是 role 或 scope`);
  }
  if (details.length) throw new ValidationError("配置校验未通过", details);
}

export function scopeClosure(state, scopeId, seen = new Set()) {
  if (!scopeId || seen.has(scopeId)) return [...seen];
  seen.add(scopeId);
  const scope = state.scopes.find(item => item.id === scopeId);
  for (const child of scope?.includes ?? []) scopeClosure(state, child, seen);
  return [...seen];
}

function describeClaims(state, claims, kind) {
  const catalog = kind === "role"
    ? new Map(state.roles.map(item => [item.id, item.name]))
    : new Map(state.scopes.map(item => [item.id, item.name]));
  return claims.map(claim => ({
    claimId: claim.id,
    sourceId: claim.sourceId,
    sourceName: claim.sourceName,
    valueId: claim.valueId,
    valueName: catalog.get(claim.valueId) ?? "已失效引用",
    updatedAt: claim.updatedAt
  }));
}

export function reconcileConflicts(state) {
  const activeIds = new Set();
  for (const member of state.members) {
    for (const kind of ["role", "scope"]) {
      const claims = state.claims.filter(claim => claim.memberId === member.id && claim.kind === kind);
      const values = new Set(claims.map(claim => claim.valueId));
      const id = `conflict-${member.id}-${kind}`;
      if (values.size > 1) {
        activeIds.add(id);
        const sources = describeClaims(state, claims, kind);
        const previous = state.conflicts.find(conflict => conflict.id === id);
        const resolution = state.resolutions[id];
        const winnerPresent = resolution && claims.some(claim => claim.id === resolution.winningClaimId);
        const status = winnerPresent ? "resolved" : "open";
        state.conflicts = state.conflicts.filter(conflict => conflict.id !== id);
        state.conflicts.push({
          id, memberId: member.id, memberName: member.name, kind,
          kindName: kind === "role" ? "角色" : "授权范围", sources,
          summary: `${member.name} 被 ${sources.map(s => s.sourceName).join("、")} 给出互相矛盾的${kind === "role" ? "角色" : "范围"}：${sources.map(s => `${s.sourceName}→${s.valueName}`).join("；")}`,
          status, createdAt: previous?.createdAt ?? state.now(), updatedAt: state.now(),
          resolvedAt: status === "resolved" ? previous.resolvedAt ?? state.now() : null
        });
      }
    }
  }
  for (const conflict of state.conflicts) {
    if (conflict.status === "resolved" && activeIds.has(conflict.id)) {
      continue;
    }
    if (!activeIds.has(conflict.id) && ["open", "resolved"].includes(conflict.status)) {
      conflict.status = "auto-resolved";
      conflict.updatedAt = state.now();
      conflict.resolvedAt = state.now();
      conflict.summary += "（当前矛盾已消失）";
    }
  }
}

function winningClaim(state, memberId, kind) {
  const claims = state.claims.filter(claim => claim.memberId === memberId && claim.kind === kind);
  const values = new Set(claims.map(claim => claim.valueId));
  const conflictId = `conflict-${memberId}-${kind}`;
  if (values.size <= 1) return claims[0] ?? null;
  const conflict = state.conflicts.find(item => item.id === conflictId);
  const resolution = state.resolutions[conflictId];
  if (conflict?.status === "resolved" && resolution) {
    return claims.find(claim => claim.id === resolution.winningClaimId) ?? null;
  }
  return null;
}

export function getEffectiveAccess(state, memberId) {
  const member = state.members.find(item => item.id === memberId);
  if (!member) return null;
  const roleClaim = winningClaim(state, memberId, "role");
  const scopeClaim = winningClaim(state, memberId, "scope");
  const role = roleClaim ? state.roles.find(item => item.id === roleClaim.valueId) ?? null : null;
  const scopeIds = scopeClaim ? scopeClosure(state, scopeClaim.valueId) : [];
  const conflictIds = state.conflicts.filter(c => c.memberId === memberId && c.status === "open").map(c => c.id);
  return {
    memberId,
    memberName: member.name,
    roleId: role?.id ?? null,
    roleName: role?.name ?? "冲突未解决，暂不生效",
    roleClaimId: roleClaim?.id ?? null,
    roleUpdatedAt: roleClaim?.updatedAt ?? null,
    pages: role?.pages ?? [],
    actions: role?.actions ?? [],
    rootScopeId: scopeClaim?.valueId ?? null,
    scopeIds,
    scopeClaimId: scopeClaim?.id ?? null,
    scopeUpdatedAt: scopeClaim?.updatedAt ?? null,
    conflictIds,
    blockedByConflict: conflictIds.length > 0,
    signature: JSON.stringify({
      roleId: role?.id ?? null,
      roleVersion: role?.updatedAt ?? null,
      scopeIds,
      scopeVersion: Math.max(0, ...scopeIds.map(id => state.scopes.find(scope => scope.id === id)?.updatedAt ?? 0)),
      conflictIds
    })
  };
}

export function canAccessPage(access, pageId) {
  return access && !access.blockedByConflict && access.pages.includes(pageId);
}

export function canPerformAction(access, actionId) {
  const action = ACTION_MAP.get(actionId);
  return Boolean(access && !access.blockedByConflict && action && access.pages.includes(action.pageId) && access.actions.includes(actionId));
}

export function canAccessRecord(access, record) {
  return canAccessPage(access, record.pageId) && access.scopeIds.includes(record.scopeId);
}

function snapshotFromAccess(state, access, reason) {
  const role = state.roles.find(item => item.id === access.roleId);
  return {
    revision: 0,
    effectiveAt: state.now(),
    roleId: access.roleId,
    roleName: access.roleName,
    roleVersion: role?.updatedAt ?? null,
    roleClaimId: access.roleClaimId,
    scopeClaimId: access.scopeClaimId,
    rootScopeId: access.rootScopeId,
    scopeIds: [...access.scopeIds],
    pages: [...access.pages],
    actions: [...access.actions],
    conflictIds: [...access.conflictIds],
    reason
  };
}

function recordStatus(state, access, record) {
  if (access.blockedByConflict) {
    return { status: "invalid", reasonCode: "CONFLICT", reason: `成员存在未解决的${access.conflictIds.length}项授权冲突，旧数据不能继续依据新权限提交。` };
  }
  if (!canAccessPage(access, record.pageId)) {
    return { status: "invalid", reasonCode: "PAGE_REVOKED", reason: `新角色 ${access.roleName} 已不能访问页面 ${PAGE_MAP.get(record.pageId)?.name ?? record.pageId}。` };
  }
  if (!access.scopeIds.includes(record.scopeId)) {
    const scope = state.scopes.find(item => item.id === record.scopeId);
    return { status: "invalid", reasonCode: "SCOPE_NARROWED", reason: `当前授权范围不再包含${scope?.name ?? record.scopeId}（事项范围 ${record.scopeId} 不在新范围闭包内）。` };
  }
  return { status: "valid", reasonCode: null, reason: "" };
}

function reevaluateOperation(state, operation, access, reason) {
  if (["confirmed", "canceled"].includes(operation.status)) return operation.status;
  const action = ACTION_MAP.get(operation.actionId);
  const record = state.records.find(item => item.id === operation.recordId);
  let blocked = false;
  let code = "";
  let detail = "";
  if (access.blockedByConflict) {
    blocked = true; code = "CONFLICT"; detail = "授权冲突未解决，操作不能在新权限下确认。";
  } else if (!action || !access.pages.includes(action.pageId)) {
    blocked = true; code = "PAGE_REVOKED"; detail = `页面 ${action?.pageId ?? "未知"} 已不在当前角色内。`;
  } else if (!access.actions.includes(operation.actionId)) {
    blocked = true; code = "ACTION_REVOKED"; detail = `新角色 ${access.roleName} 已不能执行 ${action?.name ?? operation.actionId}。`;
  } else if (!record || !access.scopeIds.includes(record.scopeId)) {
    blocked = true; code = "SCOPE_NARROWED"; detail = "事项所属范围已不在当前授权闭包内。";
  }
  if (blocked && operation.status === "awaiting-confirmation") {
    operation.status = "blocked-pending";
    operation.blockedAt = state.now();
    operation.blockReasonCode = code;
    operation.blockReason = detail;
    operation.blockedAtVersion = state.version;
    operation.blockedReasonEvent = reason;
  }
  return operation.status;
}

function convergeSession(state, session, access, reason) {
  const oldSnapshot = session.snapshots[session.snapshots.length - 1];
  const changed = !oldSnapshot || oldSnapshot.signature !== access.signature;
  if (changed) {
    const snapshot = snapshotFromAccess(state, access, reason);
    snapshot.revision = oldSnapshot ? oldSnapshot.revision + 1 : 1;
    snapshot.signature = access.signature;
    session.snapshots.push(snapshot);
    session.currentRevision = snapshot.revision;
    session.lastConvergedAt = state.now();
    session.lastChangeReason = reason;
  }
  const live = session.snapshots[session.snapshots.length - 1];
  for (const item of session.loadedRecords) {
    const record = state.records.find(r => r.id === item.recordId);
    const result = record ? recordStatus(state, access, record) : { status: "invalid", reasonCode: "RECORD_DELETED", reason: "事项已不存在。" };
    if (item.status !== result.status || item.invalidReasonCode !== result.reasonCode) {
      item.status = result.status;
      item.invalidReasonCode = result.reasonCode;
      item.invalidReason = result.reason;
      item.invalidSince = result.status === "invalid" ? (item.invalidSince ?? state.now()) : null;
      item.invalidBasis = result.status === "invalid"
        ? `快照修订 ${live.revision}；生效时刻 ${new Date(live.effectiveAt).toISOString()}；当前角色 ${live.roleName}；范围闭包 ${live.scopeIds.join(", ")}；依据编码 ${result.reasonCode}`
        : null;
    } else if (result.status === "invalid") {
      item.invalidBasis = `快照修订 ${live.revision}；生效时刻 ${new Date(live.effectiveAt).toISOString()}；当前角色 ${live.roleName}；范围闭包 ${live.scopeIds.join(", ")}；依据编码 ${result.reasonCode}`;
    }
  }
  for (const operation of session.operations) {
    reevaluateOperation(state, operation, access, reason);
  }
  return changed;
}

export function convergeSessions(state, reason, memberIds = null) {
  const beforeSignatures = new Map(state.sessions.map(session => {
    const access = getEffectiveAccess(state, session.memberId);
    return [session.id, access?.signature ?? ""];
  }));
  const affected = [];
  for (const session of state.sessions) {
    if (memberIds && !memberIds.includes(session.memberId)) continue;
    const access = getEffectiveAccess(state, session.memberId);
    if (!access) continue;
    const changed = convergeSession(state, session, access, reason);
    if (changed || memberIds) {
      affected.push({ sessionId: session.id, memberId: session.memberId, pageId: session.pageId, changed });
    }
  }
  return { affected, beforeSignatures };
}

function snapshotMap(state) {
  return new Map(state.sessions.map(session => {
    const access = getEffectiveAccess(state, session.memberId);
    return [session.id, { signature: access?.signature ?? "", access }];
  }));
}

function commitChange(state, before, type, summary, candidateMemberIds = null) {
  validateConfiguration(state);
  reconcileConflicts(state);
  state.version += 1;
  const affected = [];
  for (const session of state.sessions) {
    if (candidateMemberIds && !candidateMemberIds.includes(session.memberId)) continue;
    const access = getEffectiveAccess(state, session.memberId);
    if (!access) continue;
    const previous = before.get(session.id);
    const changed = !previous || previous.signature !== access.signature;
    convergeSession(state, session, access, summary);
    affected.push({
      sessionId: session.id, memberId: session.memberId, memberName: session.memberName,
      pageId: session.pageId, title: session.title, changed,
      oldSignature: previous?.signature ?? null, newSignature: access.signature
    });
  }
  const event = {
    id: nextId(state, "event"), version: state.version, type, summary, at: state.now(),
    affectedPages: affected.filter(item => item.changed), candidates: affected
  };
  state.events.unshift(event);
  return { event, affected };
}

function mutateConfiguration(state, type, summary, candidateMemberIds, mutator) {
  const before = snapshotMap(state);
  const rollback = deepClone({
    sequence: state.sequence, members: state.members, roles: state.roles, scopes: state.scopes,
    claims: state.claims, conflicts: state.conflicts, resolutions: state.resolutions
  });
  try {
    mutator();
    return commitChange(state, before, type, summary, candidateMemberIds);
  } catch (error) {
    Object.assign(state, rollback);
    throw error;
  }
}

function requireFields(input, fields) {
  const missing = fields.filter(field => input[field] === undefined || input[field] === null || input[field] === "");
  if (missing.length) fail(`缺少字段：${missing.join("、")}`, missing.map(path => ({ kind: "missing-field", path, message: "该字段必填" })));
}

export function addMember(state, input) {
  requireFields(input, ["id", "name", "roleId", "scopeId", "sourceName"]);
  return mutateConfiguration(state, "member.added", `新增成员 ${input.name}`, [input.id], () => {
    if (state.members.some(member => member.id === input.id)) fail(`成员标识 ${input.id} 重复`, [{ kind: "duplicate-member-id", path: "member.id", message: "成员标识必须唯一" }]);
    state.members.push({ id: input.id, name: input.name, createdAt: state.now() });
    state.claims.push({ id: nextId(state, "claim"), memberId: input.id, kind: "role", valueId: input.roleId, sourceId: input.sourceId ?? "admin", sourceName: input.sourceName, createdAt: state.now(), updatedAt: state.now() });
    state.claims.push({ id: nextId(state, "claim"), memberId: input.id, kind: "scope", valueId: input.scopeId, sourceId: input.sourceId ?? "admin", sourceName: input.sourceName, createdAt: state.now(), updatedAt: state.now() });
  });
}

export function upsertRole(state, input) {
  requireFields(input, ["id", "name", "pages", "actions"]);
  const candidateMembers = new Set(state.claims.filter(claim => claim.kind === "role" && claim.valueId === input.id).map(claim => claim.memberId));
  return mutateConfiguration(state, "role.updated", `管理员调整角色 ${input.name}`, [...candidateMembers], () => {
    const existing = state.roles.find(role => role.id === input.id);
    if (existing) Object.assign(existing, { name: input.name, pages: [...input.pages], actions: [...input.actions], updatedAt: state.now() });
    else state.roles.push({ id: input.id, name: input.name, pages: [...input.pages], actions: [...input.actions], updatedAt: state.now() });
  });
}

export function upsertScope(state, input) {
  requireFields(input, ["id", "name", "includes"]);
  // Scope definitions can sit at any point in an inheritance graph. Compare
  // all sessions after the change and write snapshots only where the signature
  // actually differs.
  return mutateConfiguration(state, "scope.updated", `管理员调整授权范围 ${input.name}`, null, () => {
    const existing = state.scopes.find(scope => scope.id === input.id);
    if (existing) Object.assign(existing, { name: input.name, includes: [...input.includes], updatedAt: state.now() });
    else state.scopes.push({ id: input.id, name: input.name, includes: [...input.includes], updatedAt: state.now() });
  });
}

export function addClaim(state, input) {
  requireFields(input, ["memberId", "kind", "valueId", "sourceName"]);
  const sourceId = input.sourceId ?? "external";
  const existing = state.claims.find(claim =>
    claim.memberId === input.memberId && claim.kind === input.kind && claim.sourceId === sourceId
  );
  const label = input.kind === "role" ? "角色" : "授权范围";
  const summary = existing
    ? `${input.sourceName} 将成员授权调整为${label} ${input.valueId}`
    : `${input.sourceName} 对成员给出新的${label}来源`;
  return mutateConfiguration(state, existing ? "claim.updated" : "claim.added", summary, [input.memberId], () => {
    if (existing) {
      existing.valueId = input.valueId;
      existing.sourceName = input.sourceName;
      existing.updatedAt = state.now();
    } else {
      state.claims.push({
        id: input.id ?? nextId(state, "claim"), memberId: input.memberId, kind: input.kind,
        valueId: input.valueId, sourceId, sourceName: input.sourceName,
        createdAt: state.now(), updatedAt: state.now()
      });
    }
  });
}

export function resolveConflict(state, input) {
  requireFields(input, ["conflictId", "winningClaimId", "decidedBy", "note"]);
  const conflict = state.conflicts.find(item => item.id === input.conflictId);
  if (!conflict) fail("冲突不存在", [{ kind: "unknown-conflict", path: "conflictId", message: input.conflictId }]);
  const winningClaim = state.claims.find(claim => claim.id === input.winningClaimId && claim.memberId === conflict.memberId && claim.kind === conflict.kind);
  if (!winningClaim) fail("所选来源不属于该成员冲突", [{ kind: "invalid-winner", path: "winningClaimId", message: "必须选择冲突双方中的一条授权" }]);
  return mutateConfiguration(state, "conflict.resolved", `${input.decidedBy} 裁定 ${conflict.memberName} 的${conflict.kindName}以 ${winningClaim.sourceName} 为准`, [conflict.memberId], () => {
    state.resolutions[input.conflictId] = {
      conflictId: input.conflictId, winningClaimId: input.winningClaimId,
      decidedBy: input.decidedBy, note: input.note, at: state.now()
    };
  });
}

function openSessionInternal(state, memberId, pageId, title) {
  const member = state.members.find(item => item.id === memberId);
  if (!member) fail("成员不存在", [{ kind: "unknown-member", path: "memberId", message: memberId }]);
  if (!PAGE_MAP.has(pageId)) fail("页面不存在", [{ kind: "unknown-page", path: "pageId", message: pageId }]);
  const access = getEffectiveAccess(state, memberId);
  const session = {
    id: nextId(state, "session"), memberId, memberName: member.name, pageId,
    title: title || `${PAGE_MAP.get(pageId).name} #${state.sessions.length + 1}`,
    openedAt: state.now(), currentRevision: 0, lastConvergedAt: state.now(),
    lastChangeReason: "页面打开", snapshots: [], loadedRecords: [], operations: []
  };
  state.sessions.push(session);
  const snapshot = snapshotFromAccess(state, access, "页面打开时创建授权快照");
  snapshot.revision = 1;
  snapshot.signature = access.signature;
  session.snapshots.push(snapshot);
  session.currentRevision = 1;
  return session;
}

function loadSessionRecords(state, session) {
  const access = getEffectiveAccess(state, session.memberId);
  for (const record of state.records.filter(item => item.pageId === session.pageId)) {
    const result = recordStatus(state, access, record);
    session.loadedRecords.push({
      recordId: record.id, title: record.title, pageId: record.pageId, scopeId: record.scopeId,
      loadedAt: state.now(), status: result.status, invalidReasonCode: result.reasonCode,
      invalidReason: result.reason, invalidSince: result.status === "invalid" ? state.now() : null,
      invalidBasis: result.status === "invalid" ? `快照修订 ${session.currentRevision}；角色 ${access.roleName}；范围闭包 ${access.scopeIds.join(", ")}` : null
    });
  }
}

export function openSession(input, state) {
  requireFields(input, ["memberId", "pageId"]);
  const session = openSessionInternal(state, input.memberId, input.pageId, input.title);
  loadSessionRecords(state, session);
  return { session: sessionView(state, session) };
}

export function initiateOperation(state, input) {
  requireFields(input, ["sessionId", "recordId", "actionId"]);
  const session = state.sessions.find(item => item.id === input.sessionId);
  if (!session) throw new PermissionError("页面不存在或已关闭", { reason: "UNKNOWN_SESSION" });
  const loaded = session.loadedRecords.find(item => item.recordId === input.recordId);
  if (!loaded) throw new PermissionError("该事项尚未加载到此页面", { reason: "RECORD_NOT_LOADED" });
  if (loaded.status === "invalid") throw new PermissionError("该数据已在新权限下失效，不能继续提交", { reason: loaded.invalidReasonCode, basis: loaded.invalidBasis });
  const access = getEffectiveAccess(state, session.memberId);
  const record = state.records.find(item => item.id === input.recordId);
  if (!canPerformAction(access, input.actionId) || ACTION_MAP.get(input.actionId)?.pageId !== session.pageId) {
    throw new PermissionError(`当前角色不允许执行 ${ACTION_MAP.get(input.actionId)?.name ?? input.actionId}`, { reason: "ACTION_DENIED", snapshotRevision: session.currentRevision });
  }
  if (!canAccessRecord(access, record)) throw new PermissionError("当前授权范围不包含该事项", { reason: "SCOPE_DENIED" });
  const operation = {
    id: nextId(state, "operation"), sessionId: session.id, recordId: input.recordId,
    recordTitle: loaded.title, actionId: input.actionId, actionName: ACTION_MAP.get(input.actionId).name,
    initiatedAt: state.now(), initiatedAtVersion: state.version,
    initiatedSnapshotRevision: session.currentRevision,
    oldRoleId: access.roleId, oldRoleName: access.roleName, oldScopeIds: [...access.scopeIds],
    payload: input.payload ?? {}, status: "awaiting-confirmation", evidence: input.evidence ?? "用户在旧页面点击操作，服务端保留原始请求等待确认。"
  };
  session.operations.push(operation);
  return { operation: deepClone(operation) };
}

export function confirmOperation(state, input) {
  requireFields(input, ["operationId"]);
  const operation = state.sessions.flatMap(session => session.operations.map(op => [session, op])).find(([, op]) => op.id === input.operationId);
  if (!operation) throw new PermissionError("待处理操作不存在", { reason: "UNKNOWN_OPERATION" });
  const [session, op] = operation;
  if (op.status === "confirmed") throw new PermissionError("该操作已生效，不能重复确认", { reason: "ALREADY_CONFIRMED" });
  if (op.status === "canceled") throw new PermissionError("该操作已取消", { reason: "CANCELED" });
  const access = getEffectiveAccess(state, session.memberId);
  const record = state.records.find(item => item.id === op.recordId);
  const denied = !canPerformAction(access, op.actionId) || !record || !canAccessRecord(access, record);
  if (denied) {
    reevaluateOperation(state, op, access, "用户尝试确认");
    throw new PermissionError(op.blockReason ?? "权限已收窄，操作被拒绝并保留为待处理", { reason: op.blockReasonCode, operation: sessionView(state, session).operations.find(item => item.id === op.id) });
  }
  op.status = "confirmed";
  op.confirmedAt = state.now();
  op.confirmedAtVersion = state.version;
  op.confirmedSnapshotRevision = session.currentRevision;
  return { operation: deepClone(op) };
}

export function cancelOperation(state, input) {
  requireFields(input, ["operationId"]);
  const found = state.sessions.flatMap(session => session.operations.map(op => [session, op])).find(([, op]) => op.id === input.operationId);
  if (!found) fail("操作不存在", [{ kind: "unknown-operation", path: "operationId", message: input.operationId }]);
  const [, op] = found;
  op.status = "canceled";
  op.canceledAt = state.now();
  return { operation: deepClone(op) };
}

export function sessionView(state, session) {
  const snapshot = session.snapshots[session.snapshots.length - 1];
  const invalidRecords = session.loadedRecords.filter(item => item.status === "invalid");
  const pendingOperations = session.operations.filter(op => ["awaiting-confirmation", "blocked-pending"].includes(op.status));
  return {
    ...deepClone(session),
    currentSnapshot: deepClone(snapshot),
    invalidCount: invalidRecords.length,
    invalidRecords: deepClone(invalidRecords),
    pendingOperationCount: pendingOperations.length,
    blockedOperationCount: pendingOperations.filter(op => op.status === "blocked-pending").length
  };
}

export function getViewModel(state) {
  validateConfiguration(state);
  return {
    generatedAt: state.now(),
    version: state.version,
    pages: PAGES,
    actions: [...ACTION_MAP.values()],
    members: state.members.map(member => {
      const access = getEffectiveAccess(state, member.id);
      const claims = state.claims.filter(claim => claim.memberId === member.id);
      return { ...deepClone(member), access: deepClone(access), claims: deepClone(claims) };
    }),
    roles: deepClone(state.roles),
    scopes: state.scopes.map(scope => ({ ...deepClone(scope), closure: scopeClosure(state, scope.id) })),
    records: deepClone(state.records),
    sessions: state.sessions.map(session => sessionView(state, session)),
    conflicts: deepClone(state.conflicts),
    resolutions: deepClone(state.resolutions),
    events: deepClone(state.events.slice(0, 12))
  };
}

export function createWorkbench(nowImpl = Date.now) {
  const state = seedState(nowImpl);
  return {
    state,
    getViewModel: () => getViewModel(state),
    addMember: input => addMember(state, input),
    upsertRole: input => upsertRole(state, input),
    upsertScope: input => upsertScope(state, input),
    addClaim: input => addClaim(state, input),
    resolveConflict: input => resolveConflict(state, input),
    openSession: input => openSession(input, state),
    initiateOperation: input => initiateOperation(state, input),
    confirmOperation: input => confirmOperation(state, input),
    cancelOperation: input => cancelOperation(state, input)
  };
}

export { createOperationInternal as _createOperationInternal };
function createOperationInternal(state, sessionId, recordId, actionId) {
  const session = state.sessions.find(item => item.id === sessionId);
  return initiateOperation(state, { sessionId, recordId, actionId, evidence: "验收场景：权限收窄前已发起，尚未确认。" }).operation;
}
