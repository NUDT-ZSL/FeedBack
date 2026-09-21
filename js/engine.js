(function initEngine(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.ResumeEngine = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createEngine() {
  "use strict";

  const TYPE_WEIGHT = new Map([
    ["todo", 40],
    ["material", 32],
    ["progress", 30],
    ["idea", 24]
  ]);

  const TYPE_LABEL = {
    todo: "待办",
    material: "素材",
    idea: "想法",
    progress: "进度"
  };

  function asTime(value) {
    if (!value) return null;
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : time;
  }

  function stableClone(value) {
    if (Array.isArray(value)) {
      return value
        .map(stableClone)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    if (value && typeof value === "object") {
      return Object.keys(value)
        .sort()
        .reduce((result, key) => {
          result[key] = stableClone(value[key]);
          return result;
        }, {});
    }
    return value;
  }

  function getActivity(state, activityId) {
    return (state.activities || []).find((activity) => activity.id === activityId) || null;
  }

  function getEntry(state, entryId) {
    return (state.entries || []).find((entry) => entry.id === entryId) || null;
  }

  function getActivityEntries(state, activityId) {
    return (state.entries || []).filter((entry) => entry.activityId === activityId);
  }

  function getActivityConflicts(state, activityId) {
    return (state.conflicts || []).filter((conflict) => conflict.activityId === activityId);
  }

  function addIssue(issues, code, severity, message, involvedEntryIds) {
    const ids = [...new Set(involvedEntryIds || [])].filter(Boolean);
    const key = code + ":" + ids.sort().join("|");
    if (!issues.some((issue) => issue.key === key)) {
      issues.push({ key, code, severity, message, involvedEntryIds: ids });
    }
  }

  function inspectDependencies(entries, issues, entryMap) {
    const entryIds = new Set(entries.map((entry) => entry.id));
    const adjacency = new Map(entries.map((entry) => [entry.id, []]));
    const suspicious = new Set();
    const missingEdgeEntries = [];

    entries.forEach((entry) => {
      const dependencies = [...new Set(entry.dependsOn || [])];
      dependencies.forEach((targetId) => {
        if (!entryMap.has(targetId)) {
          missingEdgeEntries.push({ entry, targetId });
          return;
        }
        const target = entryMap.get(targetId);
        if (target.activityId !== entry.activityId || !entryIds.has(targetId)) {
          addIssue(
            issues,
            "cross-activity-dependency",
            "error",
            "条目《" + entry.title + "》依赖了其他活动的《" + target.title + "》，恢复结论不可信。",
            [entry.id, target.id]
          );
          suspicious.add(entry.id);
          suspicious.add(target.id);
          return;
        }
        if (target.status !== "active" || entry.status !== "active") {
          addIssue(
            issues,
            "inactive-dependency",
            "error",
            "条目《" + entry.title + "》依赖的《" + target.title + "》已被裁决为不采用，需要修正依赖。",
            [entry.id, target.id]
          );
          suspicious.add(entry.id);
          suspicious.add(target.id);
          return;
        }
        adjacency.get(entry.id).push(targetId);
      });
    });

    const missingGroups = new Map();
    missingEdgeEntries.forEach(({ entry, targetId }) => {
      suspicious.add(entry.id);
      if (!missingGroups.has(targetId)) missingGroups.set(targetId, []);
      missingGroups.get(targetId).push(entry);
    });
    missingGroups.forEach((dependents, targetId) => {
      const names = dependents.map((entry) => "《" + entry.title + "》").join("、");
      addIssue(
        issues,
        "missing-dependency",
        "error",
        "依赖目标 " + targetId + " 缺失：" + names + " 不能按当前依赖恢复。",
        dependents.map((entry) => entry.id).concat(targetId)
      );
    });

    const cycles = findCycles(entries, adjacency);
    cycles.forEach((cycleIds) => {
      const names = cycleIds
        .map((id) => "《" + (entryMap.get(id)?.title || id) + "》")
        .join(" → ");
      cycleIds.forEach((id) => suspicious.add(id));
      addIssue(
        issues,
        "dependency-cycle",
        "error",
        "依赖形成闭环：" + names + "，必须先打断闭环。",
        cycleIds
      );
    });

    return { adjacency, suspicious, cycles };
  }

  function getActivityFragment(state, activityId, now) {
    const activity = getActivity(state, activityId);
    const entries = getActivityEntries(state, activityId);
    const conflicts = getActivityConflicts(state, activityId);
    return stableClone({
      schemaVersion: state.schemaVersion || 1,
      now: now instanceof Date ? now.toISOString() : now,
      activity,
      entries,
      conflicts
    });
  }

  function getStateSignature(state, activityId, now) {
    return JSON.stringify(getActivityFragment(state, activityId, now));
  }

  function findCycles(entries, adjacency) {
    const indexById = new Map();
    const lowlink = new Map();
    const onStack = new Set();
    const stack = [];
    const cycles = [];
    let nextIndex = 0;

    function visit(entryId) {
      indexById.set(entryId, nextIndex);
      lowlink.set(entryId, nextIndex);
      nextIndex += 1;
      stack.push(entryId);
      onStack.add(entryId);

      for (const targetId of adjacency.get(entryId) || []) {
        if (!indexById.has(targetId)) {
          visit(targetId);
          lowlink.set(entryId, Math.min(lowlink.get(entryId), lowlink.get(targetId)));
        } else if (onStack.has(targetId)) {
          lowlink.set(entryId, Math.min(lowlink.get(entryId), indexById.get(targetId)));
        }
      }

      if (lowlink.get(entryId) === indexById.get(entryId)) {
        const component = [];
        let currentId;
        do {
          currentId = stack.pop();
          onStack.delete(currentId);
          component.push(currentId);
        } while (currentId !== entryId);
        const hasSelfLoop = (adjacency.get(entryId) || []).includes(entryId);
        if (component.length > 1 || hasSelfLoop) cycles.push(component);
      }
    }

    entries.forEach((entry) => {
      if (!indexById.has(entry.id)) visit(entry.id);
    });
    return cycles;
  }

  function inspectConflicts(state, activityId, entries, issues) {
    const entryIds = new Set(entries.map((entry) => entry.id));
    return getActivityConflicts(state, activityId).map((conflict) => {
      const a = getEntry(state, conflict.entryAId);
      const b = getEntry(state, conflict.entryBId);
      let integrityError = false;
      const conflictName = conflict.reason || "未命名冲突";

      if (!a || !b) {
        integrityError = true;
        addIssue(
          issues,
          "conflict-reference-missing",
          "error",
          "冲突《" + conflictName + "》引用的条目已缺失，不能静默忽略。",
          [conflict.entryAId, conflict.entryBId]
        );
      } else if (!entryIds.has(a.id) || !entryIds.has(b.id)) {
        integrityError = true;
        addIssue(
          issues,
          "conflict-activity-mismatch",
          "error",
          "冲突《" + conflictName + "》包含了不属于当前活动的条目。",
          [a.id, b.id]
        );
      } else if (
        (conflict.resolution === "choose-a" && a.status !== "active") ||
        (conflict.resolution === "choose-b" && b.status !== "active") ||
        (conflict.resolution === "keep-both" && (a.status !== "active" || b.status !== "active")) ||
        (!conflict.resolution && (a.status !== "active" || b.status !== "active"))
      ) {
        integrityError = true;
        addIssue(
          issues,
          "conflict-inactive-entry",
          "error",
          "冲突《" + conflictName + "》引用了不可用条目，需要重新清理冲突记录。",
          [a.id, b.id]
        );
      }

      return {
        ...conflict,
        entryA: a,
        entryB: b,
        integrityError,
        isOpen: !conflict.resolution && !integrityError
      };
    });
  }

  function describeEntry(entry, now, state) {
    const expiresAt = asTime(entry.expiresAt);
    const updatedAt = asTime(entry.updatedAt) || 0;
    let freshness = "长期有效";
    let urgency = "none";
    let urgencyScore = 0;

    if (expiresAt !== null) {
      const remainingMs = expiresAt - now;
      if (remainingMs < 0) {
        urgency = "expired";
        urgencyScore = 1_000_000 + Math.min(Math.round(-remainingMs / 60000), 800_000);
        freshness = "已过期，需先复核";
      } else {
        urgencyScore = 500_000 - Math.min(Math.round(remainingMs / 60000), 490_000);
        urgency = remainingMs <= 24 * 60 * 60 * 1000 ? "due-soon" : "fresh";
        freshness = remainingMs <= 24 * 60 * 60 * 1000 ? "24小时内失效" : "时效内";
      }
    }

    return {
      ...entry,
      typeLabel: TYPE_LABEL[entry.type] || entry.type || "条目",
      expiresAtTime: expiresAt,
      updatedAtTime: updatedAt,
      freshness,
      urgency,
      score: 0,
      urgencyScore,
      dependencies: [...new Set(entry.dependsOn || [])],
      dependencyTitles: [...new Set(entry.dependsOn || [])].map((id) => {
        const target = getEntry(state, id);
        return target ? target.title : id;
      })
    };
  }

  function rankEntries(describedEntries, adjacency) {
    const active = describedEntries.filter((entry) => entry.status === "active");
    const activeIds = new Set(active.map((entry) => entry.id));
    const indegree = new Map(active.map((entry) => [entry.id, 0]));
    const dependents = new Map(active.map((entry) => [entry.id, []]));
    const byId = new Map(active.map((entry) => [entry.id, entry]));

    active.forEach((entry) => {
      const validTargets = (adjacency.get(entry.id) || []).filter((targetId) => activeIds.has(targetId));
      indegree.set(entry.id, validTargets.length);
      validTargets.forEach((targetId) => dependents.get(targetId).push(entry.id));
      entry.score =
        entry.urgencyScore +
        (TYPE_WEIGHT.get(entry.type) || 20) +
        Math.floor(entry.updatedAtTime / 60000) / 1_000_000_000;
    });

    function readyFirst(aId, bId) {
      const a = byId.get(aId);
      const b = byId.get(bId);
      if (b.score !== a.score) return b.score - a.score;
      return a.title.localeCompare(b.title, "zh-Hans-CN");
    }

    const ready = active.filter((entry) => indegree.get(entry.id) === 0).map((entry) => entry.id);
    const order = [];
    while (ready.length) {
      ready.sort(readyFirst);
      const currentId = ready.shift();
      order.push(byId.get(currentId));
      dependents.get(currentId).forEach((dependentId) => {
        indegree.set(dependentId, indegree.get(dependentId) - 1);
        if (indegree.get(dependentId) === 0) ready.push(dependentId);
      });
    }
    return order;
  }

  function buildResumeStep(entry, order, issue) {
    const actionByType = {
      todo: "处理待办",
      material: "打开并核对素材",
      idea: "判断想法是否转化为下一步待办",
      progress: "从这处当前进度继续"
    };
    const dependencyText = entry.dependencyTitles.length
      ? "已满足前置：" + entry.dependencyTitles.join("、")
      : "没有未满足前置";
    let prefix = "";
    if (entry.urgency === "expired") {
      prefix = "先复核时效，再";
    } else if (entry.urgency === "due-soon") {
      prefix = "趁时效临近，优先";
    }
    return {
      order,
      entryId: entry.id,
      title: entry.title,
      type: entry.type,
      typeLabel: entry.typeLabel,
      source: entry.source,
      expiresAt: entry.expiresAt,
      freshness: entry.freshness,
      dependencies: entry.dependencies,
      dependencyTitles: entry.dependencyTitles,
      action: prefix + (actionByType[entry.type] || "恢复处理"),
      reason: [entry.freshness, dependencyText, issue].filter(Boolean).join("；")
    };
  }

  function analyzeActivity(state, activityId, inputNow) {
    const now = inputNow instanceof Date ? inputNow.getTime() : new Date(inputNow || Date.now()).getTime();
    const activity = getActivity(state, activityId);
    const entries = getActivityEntries(state, activityId);
    const entryMap = new Map((state.entries || []).map((entry) => [entry.id, entry]));
    const issues = [];

    if (!activity) {
      return {
        activityId,
        status: "missing",
        trusted: false,
        canResume: false,
        headline: "活动不存在",
        issues: [],
        conflicts: [],
        entries: [],
        resume: null
      };
    }

    const graph = inspectDependencies(entries, issues, entryMap);
    const conflicts = inspectConflicts(state, activityId, entries, issues);
    const openConflicts = conflicts.filter((conflict) => conflict.isOpen);
    const blockedEntryIds = new Set(
      openConflicts.flatMap((conflict) => [conflict.entryAId, conflict.entryBId])
    );
    const describedEntries = entries
      .map((entry) => describeEntry(entry, now, state))
      .map((entry) => ({
        ...entry,
        auditState: graph.suspicious.has(entry.id)
          ? "untrusted"
          : blockedEntryIds.has(entry.id)
            ? "blocked"
            : entry.status === "active"
              ? "ready"
              : "superseded"
      }));

    const expiredCount = describedEntries.filter((entry) => entry.urgency === "expired").length;
    const dueSoonCount = describedEntries.filter((entry) => entry.urgency === "due-soon").length;
    const sortedIssues = issues.sort((a, b) => a.code.localeCompare(b.code) || a.key.localeCompare(b.key));
    const hasIntegrityIssue = sortedIssues.some((issue) => issue.severity === "error");
    const latestProgress = describedEntries
      .filter((entry) => entry.type === "progress" && entry.status === "active")
      .sort((a, b) => b.updatedAtTime - a.updatedAtTime || a.title.localeCompare(b.title))[0];

    let status = "ready";
    let headline = "可以恢复";
    if (hasIntegrityIssue) {
      status = "untrusted";
      headline = "活动不可信：存在依赖或冲突记录问题";
    } else if (openConflicts.length) {
      status = "blocked";
      headline = "等待冲突裁决";
    }

    let resume = null;
    if (!hasIntegrityIssue && !openConflicts.length) {
      const orderedEntries = rankEntries(describedEntries, graph.adjacency);
      resume = orderedEntries.map((entry, index) =>
        buildResumeStep(
          entry,
          index + 1,
          expiredCount && entry.urgency === "expired"
            ? "当前时效已失效"
            : dueSoonCount && entry.urgency === "due-soon"
              ? "即将失效"
              : ""
        )
      );
    }

    return {
      activityId,
      activity,
      status,
      trusted: !hasIntegrityIssue,
      canResume: Boolean(resume),
      headline,
      latestProgress: latestProgress
        ? {
            entryId: latestProgress.id,
            title: latestProgress.title,
            source: latestProgress.source,
            updatedAt: latestProgress.updatedAt
          }
        : null,
      issues: sortedIssues,
      conflicts,
      openConflictCount: openConflicts.length,
      entries: describedEntries,
      untrustedEntryIds: [...graph.suspicious].sort(),
      blockedEntryIds: [...blockedEntryIds].sort(),
      resume,
      stats: {
        total: entries.length,
        active: entries.filter((entry) => entry.status === "active").length,
        superseded: entries.filter((entry) => entry.status !== "active").length,
        expired: expiredCount,
        dueSoon: dueSoonCount,
        issues: sortedIssues.length
      },
      calculatedAt: new Date(now).toISOString()
    };
  }

  class ResumeEngine {
    constructor(options = {}) {
      this.cache = new Map();
      this.computeCount = 0;
      this.nowProvider = options.nowProvider || (() => new Date());
    }

    analyze(state, activityId, now = this.nowProvider()) {
      const normalizedNow = now instanceof Date ? now.toISOString() : now;
      const signature = getStateSignature(state, activityId, normalizedNow);
      const cached = this.cache.get(activityId);
      if (cached && cached.signature === signature) return cached.result;
      this.computeCount += 1;
      const result = analyzeActivity(state, activityId, now);
      this.cache.set(activityId, { signature, result });
      return result;
    }

    invalidate(activityId) {
      return this.cache.delete(activityId);
    }

    invalidateEntries(state, entryIds) {
      const ids = new Set(entryIds || []);
      const affected = new Set();
      (state.entries || []).forEach((entry) => {
        if (ids.has(entry.id) || (entry.dependsOn || []).some((id) => ids.has(id))) {
          affected.add(entry.activityId);
        }
      });
      [...affected].forEach((activityId) => this.invalidate(activityId));
      return [...affected];
    }

    invalidateConflicts(state, conflictIds) {
      const ids = new Set(conflictIds || []);
      const affected = new Set();
      (state.conflicts || []).forEach((conflict) => {
        if (ids.has(conflict.id)) affected.add(conflict.activityId);
      });
      [...affected].forEach((activityId) => this.invalidate(activityId));
      return [...affected];
    }

    clearCache() {
      this.cache.clear();
    }
  }

  function recomputeAll(state, now) {
    return new Map((state.activities || []).map((activity) => [
      activity.id,
      analyzeActivity(state, activity.id, now)
    ]));
  }

  return {
    TYPE_LABEL,
    ResumeEngine,
    analyzeActivity,
    recomputeAll,
    getStateSignature,
    getActivityFragment
  };

});
