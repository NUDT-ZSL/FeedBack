const ROLE_CONFLICT = "role_conflict";
const SCOPE_CONFLICT = "scope_conflict";

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function nowIso(clock = () => new Date().toISOString()) {
  return clock();
}

function adjacency(edges) {
  const map = new Map();
  for (const edge of edges) {
    if (!map.has(edge.parent)) map.set(edge.parent, new Set());
    map.get(edge.parent).add(edge.child);
  }
  return map;
}

export function findCycle(edges) {
  const next = adjacency(edges);
  const color = new Map();
  const stack = [];
  function visit(node) {
    color.set(node, "entered");
    stack.push(node);
    for (const child of next.get(node) ?? []) {
      if (color.get(child) === "entered") {
        const start = stack.indexOf(child);
        return [...stack.slice(start), child];
      }
      if (!color.has(child)) {
        const cycle = visit(child);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    color.set(node, "done");
    return null;
  }
  const nodes = new Set(edges.flatMap((edge) => [edge.parent, edge.child]));
  for (const node of nodes) {
    if (!color.has(node)) {
      const cycle = visit(node);
      if (cycle) return cycle;
    }
  }
  return null;
}

export function scopeClosure(startIds, edges) {
  const next = adjacency(edges);
  const result = new Set();
  const queue = [...new Set(startIds)];
  while (queue.length) {
    const node = queue.shift();
    if (result.has(node)) continue;
    result.add(node);
    queue.push(...(next.get(node) ?? []));
  }
  return result;
}

export function pathsToScope(target, edges) {
  const parents = new Map();
  for (const edge of edges) {
    if (!parents.has(edge.child)) parents.set(edge.child, new Set());
    parents.get(edge.child).add(edge.parent);
  }
  const paths = [];
  const walk = (node, path) => {
    const upstream = [...(parents.get(node) ?? [])].sort();
    if (!upstream.length) paths.push([...path].reverse());
    for (const parent of upstream) {
      if (path.includes(parent)) continue;
      walk(parent, [parent, ...path]);
    }
  };
  walk(target, [target]);
  return paths.sort((a, b) => a.join(">").localeCompare(b.join(">")));
}

function sourceKey(source) {
  return `${source.type}:${source.id ?? source.name ?? ""}`;
}

function makeConflictId(type, memberId, parts) {
  const stable = [type, memberId, ...parts].sort().join("|");
  let hash = 5381;
  for (const char of stable) {
    hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
  }
  return `${type}-${memberId}-${hash.toString(36)}`;
}

export function buildConflicts(assignments, directives) {
  const conflicts = [];
  const roleGroups = new Map();
  for (const assignment of assignments) {
    if (!roleGroups.has(assignment.memberId)) roleGroups.set(assignment.memberId, []);
    roleGroups.get(assignment.memberId).push(assignment);
  }
  for (const [memberId, group] of roleGroups) {
    const distinct = new Map();
    for (const item of group) {
      if (!distinct.has(item.roleId)) distinct.set(item.roleId, item);
    }
    if (distinct.size > 1) {
      const sources = group.map((item) => ({
        source: item.source,
        roleId: item.roleId,
        content: item.content
      }));
      conflicts.push({
        id: makeConflictId(ROLE_CONFLICT, memberId,
          group.map((item) => `${sourceKey(item.source)}:${item.roleId}`)),
        type: ROLE_CONFLICT,
        memberId,
        sources,
        content: sources.map((item) => `${item.source.label}→${item.roleId}`).join(" vs "),
        message: `成员 ${memberId} 同时被 ${sources
          .map((item) => `${item.source.label} 授予 ${item.roleId}`)
          .join("、")}，双方角色均已保留，当前不静默择一。`
      });
    }
  }

  const scopeGroups = new Map();
  for (const directive of directives) {
    const key = `${directive.memberId}\u0000${directive.scopeId}`;
    if (!scopeGroups.has(key)) scopeGroups.set(key, []);
    scopeGroups.get(key).push(directive);
  }
  for (const [key, group] of scopeGroups) {
    if (new Set(group.map((item) => item.effect)).size < 2) continue;
    const [memberId, scopeId] = key.split("\u0000");
    const sources = group.map((item) => ({
      source: item.source,
      effect: item.effect,
      content: item.content
    }));
    conflicts.push({
      id: makeConflictId(SCOPE_CONFLICT, memberId,
        group.map((item) => `${sourceKey(item.source)}:${item.scopeId}:${item.effect}`)),
      type: SCOPE_CONFLICT,
      memberId,
      scopeId,
      sources,
      content: sources.map((item) => `${item.source.label}:${item.effect} ${item.scopeId}`).join(" vs "),
      message: `成员 ${memberId} 在范围 ${scopeId} 同时收到 ${sources
        .map((item) => `${item.source.label} 的 ${item.effect}`)
        .join("、")}；矛盾范围已冻结并保留双方依据。`
    });
  }
  return conflicts;
}

export function evaluateAccess(state, memberId, at = new Date().toISOString()) {
  const memberAssignments = state.assignments.filter((item) => item.memberId === memberId);
  const memberConflicts = state.conflicts.filter((item) => item.memberId === memberId);
  const roleConflict = memberConflicts.some((item) => item.type === ROLE_CONFLICT);
  const roleIds = [...new Set(memberAssignments.map((item) => item.roleId))].sort();
  if (roleConflict || roleIds.length !== 1) {
    return {
      effectiveAt: at,
      policyVersion: state.policyVersion,
      memberId,
      roleId: null,
      role: null,
      roleSources: memberAssignments.map((item) => item.source),
      pages: [],
      grants: [],
      accessibleScopes: [],
      deniedScopes: [],
      contestedScopes: [],
      conflictIds: memberConflicts.map((item) => item.id),
      status: "conflict"
    };
  }

  const role = state.roles[roleIds[0]];
  const grants = role.grants.map((grant) => ({ ...grant }));
  const pages = [...new Set(grants.map((grant) => grant.page))].sort();
  const allowed = scopeClosure(grants.map((grant) => grant.scopeId), state.edges);
  const memberDirectives = state.directives.filter((item) => item.memberId === memberId);
  const contested = scopeClosure(
    memberConflicts.filter((item) => item.type === SCOPE_CONFLICT).map((item) => item.scopeId),
    state.edges
  );
  const denied = scopeClosure(
    memberDirectives
      .filter((item) => item.effect === "deny" && !contested.has(item.scopeId))
      .map((item) => item.scopeId),
    state.edges
  );
  const accessible = [...allowed].filter((scopeId) =>
    !denied.has(scopeId) && !contested.has(scopeId)).sort();
  const basis = new Map();
  for (const grant of grants) {
    for (const scopeId of scopeClosure([grant.scopeId], state.edges)) {
      if (!basis.has(scopeId)) basis.set(scopeId, []);
      basis.get(scopeId).push({
        roleId: role.id,
        roleName: role.name,
        grant: `${grant.page}.${grant.action}`,
        rootScopeId: grant.scopeId
      });
    }
  }
  return {
    effectiveAt: at,
    policyVersion: state.policyVersion,
    memberId,
    roleId: role.id,
    role: clone(role),
    roleSources: memberAssignments.map((item) => item.source),
    pages,
    grants,
    accessibleScopes: accessible,
    deniedScopes: [...denied].sort(),
    contestedScopes: [...contested].sort(),
    scopeBasis: Object.fromEntries([...basis.entries()].sort()),
    conflictIds: memberConflicts.map((item) => item.id),
    status: "active"
  };
}
