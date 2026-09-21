(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ContextEngine = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const KINDS = ["material", "todo", "idea", "progress"];
  const STATUSES = ["active", "completed", "cancelled", "retired"];
  const DAY_MS = 24 * 60 * 60 * 1000;

  function createId(prefix) {
    const random = globalThis.crypto && globalThis.crypto.randomUUID
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(16).slice(2, 10);
    return `${prefix}_${Date.now().toString(36)}_${random}`;
  }

  function createState(now = new Date().toISOString()) {
    return {
      schemaVersion: 1,
      activities: {},
      activityOrder: [],
      entries: {},
      conflicts: {},
      seq: 0,
      computed: {},
      createdAt: now,
      updatedAt: now
    };
  }

  function requireActivity(state, activityId) {
    const activity = state.activities[activityId];
    if (!activity) throw new Error(`活动不存在：${activityId}`);
    return activity;
  }

  function requireEntry(state, entryId) {
    const entry = state.entries[entryId];
    if (!entry) throw new Error(`上下文条目不存在：${entryId}`);
    return entry;
  }

  function addActivity(state, input, now = new Date().toISOString()) {
    const id = input.id || createId("act");
    if (state.activities[id]) throw new Error(`活动 ID 已存在：${id}`);
    const activity = {
      id,
      title: String(input.title || "未命名活动").trim(),
      goal: String(input.goal || "").trim(),
      createdAt: now,
      updatedAt: now
    };
    state.activities[id] = activity;
    state.activityOrder.push(id);
    recomputeAffected(state, [id], now);
    state.updatedAt = now;
    return activity;
  }

  function updateActivity(state, activityId, patch, now = new Date().toISOString()) {
    const activity = requireActivity(state, activityId);
    if (patch.title !== undefined) activity.title = String(patch.title).trim() || activity.title;
    if (patch.goal !== undefined) activity.goal = String(patch.goal).trim();
    activity.updatedAt = now;
    state.updatedAt = now;
    return activity;
  }

  function normalizeDeps(value) {
    const deps = Array.isArray(value) ? value : [];
    return [...new Set(deps.map(String).filter(Boolean))];
  }

  function revision(entry, action, patch, now) {
    entry.revisions.push({
      at: now,
      action,
      patch: JSON.parse(JSON.stringify(patch || {})),
      previous: {
        title: entry.title,
        content: entry.content,
        kind: entry.kind,
        source: entry.source,
        validUntil: entry.validUntil,
        dependsOn: [...entry.dependsOn],
        status: entry.status
      }
    });
  }

  function entriesByActivity(state, activityId) {
    return Object.values(state.entries).filter((entry) => entry.activityId === activityId);
  }

  function affectedOwners(state, seedIds) {
    const reverse = new Map();
    Object.values(state.entries).forEach((entry) => {
      entry.dependsOn.forEach((dep) => {
        if (!reverse.has(dep)) reverse.set(dep, []);
        reverse.get(dep).push(entry.id);
      });
    });
    const seen = new Set();
    const stack = [...seedIds];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      (reverse.get(id) || []).forEach((child) => stack.push(child));
    }
    return [...seen]
      .map((id) => state.entries[id] && state.entries[id].activityId)
      .filter(Boolean);
  }

  function addEntry(state, input, now = new Date().toISOString()) {
    requireActivity(state, input.activityId);
    const kind = KINDS.includes(input.kind) ? input.kind : "idea";
    const id = input.id || createId("entry");
    if (state.entries[id]) throw new Error(`条目 ID 已存在：${id}`);
    const entry = {
      id,
      activityId: input.activityId,
      title: String(input.title || "未命名条目").trim(),
      content: String(input.content || "").trim(),
      kind,
      source: String(input.source || "手动记录").trim(),
      validUntil: input.validUntil || null,
      dependsOn: normalizeDeps(input.dependsOn),
      status: STATUSES.includes(input.status) ? input.status : "active",
      createdAt: now,
      updatedAt: now,
      revisions: []
    };
    state.entries[id] = entry;
    recomputeAffected(state, [...new Set(affectedOwners(state, [id]))], now);
    state.updatedAt = now;
    return entry;
  }

  function updateEntry(state, entryId, patch, now = new Date().toISOString()) {
    const entry = requireEntry(state, entryId);
    const oldOwners = affectedOwners(state, [entryId]);
    revision(entry, "update", patch, now);
    if (patch.title !== undefined) entry.title = String(patch.title).trim() || entry.title;
    if (patch.content !== undefined) entry.content = String(patch.content).trim();
    if (KINDS.includes(patch.kind)) entry.kind = patch.kind;
    if (patch.source !== undefined) entry.source = String(patch.source).trim();
    if (Object.prototype.hasOwnProperty.call(patch, "validUntil")) {
      entry.validUntil = patch.validUntil || null;
    }
    if (patch.dependsOn !== undefined) entry.dependsOn = normalizeDeps(patch.dependsOn);
    if (STATUSES.includes(patch.status)) entry.status = patch.status;
    entry.updatedAt = now;
    const owners = new Set([...oldOwners, ...affectedOwners(state, [entryId]), entry.activityId]);
    recomputeAffected(state, [...owners], now);
    state.updatedAt = now;
    return entry;
  }

  function addConflict(state, input, now = new Date().toISOString()) {
    const a = requireEntry(state, input.entryAId);
    const b = requireEntry(state, input.entryBId);
    if (a.activityId !== b.activityId) throw new Error("只能标记同一活动内的上下文冲突");
    if (a.id === b.id) throw new Error("条目不能与自身构成冲突");
    const pair = [a.id, b.id].sort().join("|");
    const duplicate = Object.values(state.conflicts).some((conflict) =>
      conflict.status === "open" &&
      [conflict.entryAId, conflict.entryBId].sort().join("|") === pair);
    if (duplicate) throw new Error("这两个条目已有待裁决冲突");
    const id = input.id || createId("conflict");
    const conflict = {
      id,
      activityId: a.activityId,
      entryAId: a.id,
      entryBId: b.id,
      note: String(input.note || "").trim(),
      status: "open",
      resolution: null,
      createdAt: now,
      updatedAt: now
    };
    state.conflicts[id] = conflict;
    recomputeAffected(state, [...new Set(affectedOwners(state, [a.id, b.id]))], now);
    state.updatedAt = now;
    return conflict;
  }

  function resolveConflict(state, conflictId, input, now = new Date().toISOString()) {
    const conflict = state.conflicts[conflictId];
    if (!conflict) throw new Error(`冲突不存在：${conflictId}`);
    if (conflict.status !== "open") throw new Error("只能裁决待处理冲突");
    const choice = ["A", "B", "both", "neither"].includes(input.choice) ? input.choice : null;
    if (!choice) throw new Error("裁决必须是 A、B、both 或 neither");
    conflict.status = "resolved";
    conflict.resolution = {
      choice,
      rationale: String(input.rationale || "").trim(),
      at: now
    };
    conflict.updatedAt = now;
    const a = requireEntry(state, conflict.entryAId);
    const b = requireEntry(state, conflict.entryBId);
    [a, b].forEach((entry) => {
      entry.conflictOutcome = { conflictId: conflict.id, choice, at: now };
      entry.updatedAt = now;
    });
    const losers = choice === "A" ? [b] : choice === "B" ? [a] : choice === "neither" ? [a, b] : [];
    losers.forEach((entry) => {
      revision(entry, "conflict-rejected", { conflictId: conflict.id, choice }, now);
    });
    recomputeAffected(state, [...new Set(affectedOwners(state, [a.id, b.id]))], now);
    state.updatedAt = now;
    return conflict;
  }

  function reopenConflict(state, conflictId, rationale, now = new Date().toISOString()) {
    const conflict = state.conflicts[conflictId];
    if (!conflict) throw new Error(`冲突不存在：${conflictId}`);
    const a = requireEntry(state, conflict.entryAId);
    const b = requireEntry(state, conflict.entryBId);
    conflict.status = "open";
    conflict.resolution = null;
    conflict.note = [conflict.note, rationale ? `重新打开：${rationale}` : ""].filter(Boolean).join("\n");
    conflict.updatedAt = now;
    [a, b].forEach((entry) => {
      delete entry.conflictOutcome;
      entry.updatedAt = now;
    });
    recomputeAffected(state, [...new Set(affectedOwners(state, [a.id, b.id]))], now);
    state.updatedAt = now;
    return conflict;
  }

  function freshness(entry, nowIso) {
    if (!entry.validUntil) return { level: "open", label: "长期有效" };
    const diff = new Date(entry.validUntil).getTime() - new Date(nowIso).getTime();
    if (Number.isNaN(diff)) return { level: "unknown", label: "时效无效" };
    if (diff < 0) return { level: "expired", label: `已过期 ${formatAge(-diff)}` };
    if (diff <= DAY_MS) return { level: "due-soon", label: `${formatAge(diff)}内到期` };
    return { level: "fresh", label: `${formatAge(diff)}内有效` };
  }

  function formatAge(ms) {
    const hours = Math.floor(ms / (60 * 60 * 1000));
    if (hours < 24) return `${Math.max(1, hours)}小时`;
    return `${Math.floor(hours / 24)}天`;
  }

  function isRejectedByConflict(entry, state) {
    const outcome = entry.conflictOutcome;
    if (!outcome) return false;
    const conflict = state.conflicts[outcome.conflictId];
    if (!conflict || conflict.status !== "resolved") return false;
    if (outcome.choice === "A") return entry.id === conflict.entryBId;
    if (outcome.choice === "B") return entry.id === conflict.entryAId;
    return outcome.choice === "neither";
  }

  function activeEntries(state) {
    return Object.values(state.entries).filter((entry) => entry.status === "active");
  }

  function findCycles(nodes, edges) {
    let index = 0;
    const stack = [];
    const indices = new Map();
    const low = new Map();
    const onStack = new Set();
    const components = [];

    function visit(node) {
      indices.set(node, index);
      low.set(node, index);
      index += 1;
      stack.push(node);
      onStack.add(node);
      (edges.get(node) || []).forEach((next) => {
        if (!indices.has(next)) {
          visit(next);
          low.set(node, Math.min(low.get(node), low.get(next)));
        } else if (onStack.has(next)) {
          low.set(node, Math.min(low.get(node), indices.get(next)));
        }
      });
      if (low.get(node) === indices.get(node)) {
        const component = [];
        let current;
        do {
          current = stack.pop();
          onStack.delete(current);
          component.push(current);
        } while (current !== node);
        if (component.length > 1 || (edges.get(node) || []).includes(node)) components.push(component);
      }
    }

    nodes.forEach((node) => {
      if (!indices.has(node)) visit(node);
    });
    return components;
  }

  function buildAnalysis(state, nowIso = new Date().toISOString()) {
    const active = activeEntries(state);
    const activeIds = new Set(active.map((entry) => entry.id));
    const edges = new Map(active.map((entry) => [entry.id, entry.dependsOn.filter((dep) => activeIds.has(dep))]));
    const cycleGroups = findCycles(active.map((entry) => entry.id), edges);
    const cycleEntryIds = new Set(cycleGroups.flat());
    const trustReasons = new Map();

    function addReason(activityId, reason) {
      if (!trustReasons.has(activityId)) trustReasons.set(activityId, []);
      trustReasons.get(activityId).push(reason);
    }

    active.forEach((entry) => {
      entry.dependsOn.forEach((dep) => {
        const target = state.entries[dep];
        if (!target) {
          addReason(entry.activityId, {
            code: "missing-dependency",
            severity: "untrusted",
            entryId: entry.id,
            dependencyId: dep,
            message: `「${entry.title}」依赖缺失条目 ${dep}，恢复顺序不可信`
          });
        } else if (target.activityId !== entry.activityId) {
          addReason(entry.activityId, {
            code: "cross-activity-dependency",
            severity: "warning",
            entryId: entry.id,
            dependencyId: dep,
            activityId: target.activityId,
            message: `「${entry.title}」依赖另一活动「${state.activities[target.activityId]?.title || target.activityId}」`
          });
        }
        if (target && target.status !== "active") {
          addReason(entry.activityId, {
            code: "inactive-dependency",
            severity: "untrusted",
            entryId: entry.id,
            dependencyId: dep,
            message: `「${entry.title}」依赖的「${target.title}」已 ${statusLabel(target.status)}`
          });
        }
        if (target && isRejectedByConflict(target, state)) {
          addReason(entry.activityId, {
            code: "rejected-dependency",
            severity: "untrusted",
            entryId: entry.id,
            dependencyId: dep,
            message: `「${entry.title}」依赖了冲突裁决中被否定的「${target.title}」`
          });
        }
      });
      if (cycleEntryIds.has(entry.id)) {
        addReason(entry.activityId, {
          code: "dependency-cycle",
          severity: "untrusted",
          entryId: entry.id,
          cycleIds: cycleGroups.find((group) => group.includes(entry.id)),
          message: `「${entry.title}」位于依赖闭环中，不能确定先后关系`
        });
      }
    });

    const analyses = {};
    state.activityOrder.forEach((activityId) => {
      analyses[activityId] = deriveActivity(state, activityId, {
        nowIso,
        reasons: trustReasons.get(activityId) || [],
        cycleEntryIds
      });
    });
    return { activities: analyses };
  }

  function statusLabel(status) {
    return { active: "有效", completed: "完成", cancelled: "取消", retired: "归档" }[status] || status;
  }

  function deriveActivity(state, activityId, context) {
    const nowIso = context.nowIso;
    const all = entriesByActivity(state, activityId);
    const openConflicts = Object.values(state.conflicts).filter((conflict) =>
      conflict.activityId === activityId && conflict.status === "open");
    const conflictEntryIds = new Set(openConflicts.flatMap((conflict) => [conflict.entryAId, conflict.entryBId]));
    const severeReasons = context.reasons.filter((reason) => reason.severity === "untrusted");
    const active = all.filter((entry) => entry.status === "active");
    const rejected = active.filter((entry) => isRejectedByConflict(entry, state));
    const usable = active.filter((entry) =>
      !isRejectedByConflict(entry, state) && !context.cycleEntryIds.has(entry.id));

    const decorate = (entry) => ({
      entry,
      freshness: freshness(entry, nowIso),
      conflict: openConflicts.find((conflict) =>
        conflict.entryAId === entry.id || conflict.entryBId === entry.id) || null
    });

    const result = {
      activityId,
      status: "ready",
      title: state.activities[activityId]?.title || activityId,
      reasons: context.reasons,
      openConflicts,
      activeEntries: active.map(decorate),
      rejectedEntries: rejected.map(decorate),
      anchors: [],
      steps: [],
      blockedEntries: [...conflictEntryIds].map((id) => state.entries[id]).filter(Boolean).map(decorate),
      warnings: []
    };

    if (severeReasons.length) result.status = "untrusted";
    if (openConflicts.length && result.status !== "untrusted") result.status = "conflict";

    if (result.status === "ready") {
      const ordered = topological(usable, state, context.cycleEntryIds);
      const progress = ordered.filter((entry) => entry.kind === "progress");
      const actions = ordered.filter((entry) => entry.kind !== "progress");
      result.anchors = progress.slice(0, 3).map(decorate);
      result.steps = actions.map((entry, index) => {
        const item = decorate(entry);
        item.step = index + 1;
        return item;
      });
      const expired = result.steps.filter((item) => item.freshness.level === "expired");
      const dueSoon = result.steps.filter((item) => item.freshness.level === "due-soon");
      if (expired.length) result.warnings.push(`${expired.length} 条依据已过期，续接前应先核对`);
      if (dueSoon.length) result.warnings.push(`${dueSoon.length} 条依据即将到期`);
      const external = context.reasons.filter((reason) => reason.code === "cross-activity-dependency");
      if (external.length) result.warnings.push("存在跨活动前置，切换前请确认上游活动");
    }
    return result;
  }

  function topological(entries, state, cycleEntryIds) {
    const ids = new Set(entries.map((entry) => entry.id));
    const indegree = new Map([...ids].map((id) => [id, 0]));
    const children = new Map([...ids].map((id) => [id, []]));
    entries.forEach((entry) => {
      entry.dependsOn.forEach((dep) => {
        if (ids.has(dep) && !cycleEntryIds.has(dep)) {
          indegree.set(entry.id, indegree.get(entry.id) + 1);
          children.get(dep).push(entry.id);
        }
      });
    });
    const kindRank = { progress: 0, todo: 1, material: 2, idea: 3 };
    const ready = entries
      .filter((entry) => indegree.get(entry.id) === 0)
      .sort(compareCandidates);
    const ordered = [];
    while (ready.length) {
      const entry = ready.shift();
      ordered.push(entry);
      children.get(entry.id).forEach((childId) => {
        indegree.set(childId, indegree.get(childId) - 1);
        if (indegree.get(childId) === 0) {
          ready.push(state.entries[childId]);
          ready.sort(compareCandidates);
        }
      });
    }
    return ordered;

    function compareCandidates(a, b) {
      const rank = kindRank[a.kind] - kindRank[b.kind];
      if (rank) return rank;
      const timeA = a.validUntil ? new Date(a.validUntil).getTime() : Infinity;
      const timeB = b.validUntil ? new Date(b.validUntil).getTime() : Infinity;
      if (timeA !== timeB) return timeA - timeB;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    }
  }

  function deriveAll(state, nowIso = new Date().toISOString()) {
    return buildAnalysis(state, nowIso);
  }

  function recomputeAffected(state, activityIds, nowIso = new Date().toISOString()) {
    const unique = [...new Set(activityIds.filter((id) => state.activities[id]))];
    const full = buildAnalysis(state, nowIso);
    unique.forEach((activityId) => {
      state.computed[activityId] = full.activities[activityId];
    });
    return unique.map((activityId) => state.computed[activityId]);
  }

  function incrementalMatchesFull(state, nowIso = new Date().toISOString()) {
    const full = buildAnalysis(state, nowIso);
    return Object.keys(full.activities).every((activityId) => {
      const cached = state.computed[activityId];
      return cached && JSON.stringify(cached) === JSON.stringify(full.activities[activityId]);
    });
  }

  return {
    KINDS,
    STATUSES,
    createState,
    addActivity,
    updateActivity,
    addEntry,
    updateEntry,
    addConflict,
    resolveConflict,
    reopenConflict,
    deriveActivity: (state, activityId, nowIso = new Date().toISOString()) =>
      buildAnalysis(state, nowIso).activities[activityId],
    deriveAll,
    recomputeAffected,
    incrementalMatchesFull,
    affectedOwners
  };
});
