// 离线交接推演引擎：纯数据、纯函数，不依赖浏览器或网络。

const STATUS_PRIORITY = {
  ready: 0,
  incomplete: 1,
  untrusted: 2,
  blocked: 3,
};

function createAnalysisState() {
  return { edits: {}, adjudications: {}, updatedAt: null };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableString(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(stableString).join(",") + "]";
  }
  return "{" + Object.keys(value).sort()
    .map((key) => JSON.stringify(key) + ":" + stableString(value[key]))
    .join(",") + "}";
}

function dedupeReasons(reasons) {
  const seen = new Set();
  return reasons.filter((reason) => {
    const key = stableString(reason);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isFresh(context, nowIso) {
  return !context.validUntil || Date.parse(context.validUntil) > Date.parse(nowIso);
}

function effectiveContexts(model, state) {
  return (model.contexts || []).map((original) => {
    const edits = state.edits[original.id] || {};
    return {
      ...original,
      active: original.active !== false,
      ...edits,
      id: original.id,
      handoffId: original.handoffId,
      key: original.key,
    };
  });
}

function applyContextEdit(state, contextId, edits) {
  const allowed = ["value", "source", "validUntil", "active"];
  const current = state.edits[contextId] || {};
  const next = { ...current };
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(edits, key)) next[key] = edits[key];
  }
  state.edits[contextId] = next;
  state.updatedAt = new Date().toISOString();
  return state;
}

function adjudicationKey(handoffId, key) {
  return `${handoffId}::${key}`;
}

function adjudicateConflict(state, handoffId, key, decision) {
  state.adjudications[adjudicationKey(handoffId, key)] = {
    ...clone(decision),
    at: new Date().toISOString(),
  };
  state.updatedAt = new Date().toISOString();
  return state;
}

function clearAdjudication(state, handoffId, key) {
  delete state.adjudications[adjudicationKey(handoffId, key)];
  state.updatedAt = new Date().toISOString();
  return state;
}

function downstreamClosure(model, seedIds) {
  const dependents = new Map();
  for (const item of model.handoffs || []) {
    for (const depId of item.dependencies || []) {
      if (!dependents.has(depId)) dependents.set(depId, []);
      dependents.get(depId).push(item.id);
    }
  }
  const affected = new Set(seedIds);
  const queue = [...seedIds];
  while (queue.length) {
    const id = queue.shift();
    for (const downstream of dependents.get(id) || []) {
      if (!affected.has(downstream)) {
        affected.add(downstream);
        queue.push(downstream);
      }
    }
  }
  return affected;
}

function tarjanSCC(itemsById) {
  let index = 0;
  const indices = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];

  function visit(id) {
    indices.set(id, index);
    low.set(id, index);
    index += 1;
    stack.push(id);
    onStack.add(id);
    for (const depId of itemsById.get(id).dependencies || []) {
      if (!itemsById.has(depId)) continue;
      if (!indices.has(depId)) {
        visit(depId);
        low.set(id, Math.min(low.get(id), low.get(depId)));
      } else if (onStack.has(depId)) {
        low.set(id, Math.min(low.get(id), indices.get(depId)));
      }
    }
    if (low.get(id) === indices.get(id)) {
      const component = [];
      let current;
      do {
        current = stack.pop();
        onStack.delete(current);
        component.push(current);
      } while (current !== id);
      components.push(component.sort());
    }
  }

  for (const id of [...itemsById.keys()].sort()) visit(id);
  return components;
}

function normalizeHandoff(item) {
  return {
    ...item,
    role: item.role || "",
    dependencies: [...new Set(item.dependencies || [])],
    requiredContextKeys: [...new Set(item.requiredContextKeys || [])],
  };
}

function worstStatus(statuses) {
  return statuses.reduce(
    (worst, status) =>
      STATUS_PRIORITY[status] > STATUS_PRIORITY[worst] ? status : worst,
    "ready"
  );
}

function decorateTrustFlags(item) {
  item.trusted = !item.reasons.some((reason) => reason.severity === "untrusted");
  item.blockedByConflict = item.status === "blocked" &&
    item.reasons.some((reason) =>
      reason.code === "UNRESOLVED_CONFLICT" ||
      (reason.code === "UPSTREAM_NOT_READY" && reason.upstreamStatus === "blocked"));
  return item;
}

function expandSCCSeeds(model, seedIds) {
  const itemsById = new Map((model.handoffs || []).map((item) => [item.id, normalizeHandoff(item)]));
  const seeds = new Set(seedIds.filter((id) => itemsById.has(id)));
  for (const component of tarjanSCC(itemsById)) {
    if (component.some((id) => seeds.has(id))) {
      component.forEach((id) => seeds.add(id));
    }
  }
  return downstreamClosure(model, [...seeds]);
}

function buildConflictGroups(contexts, state) {
  const groupsMap = new Map();
  for (const context of contexts) {
    if (context.active === false) continue;
    const id = adjudicationKey(context.handoffId, context.key);
    if (!groupsMap.has(id)) {
      groupsMap.set(id, { id, handoffId: context.handoffId, key: context.key, entries: [] });
    }
    groupsMap.get(id).entries.push(context);
  }

  const conflicts = [];
  const acceptedByGroup = new Map();
  for (const group of groupsMap.values()) {
    group.entries.sort((a, b) => a.id.localeCompare(b.id));
    const hasConflict = new Set(group.entries.map((entry) => stableString(entry.value))).size > 1;
    const decision = state.adjudications[group.id];
    let accepted = null;
    let resolved = false;
    let invalidDecision = null;

    if (!hasConflict) {
      accepted = group.entries[0] || null;
    } else if (decision) {
      if (decision.winnerContextId) {
        accepted = group.entries.find((entry) => entry.id === decision.winnerContextId) || null;
        if (!accepted) invalidDecision = "裁决选中的上下文已不存在或已停用";
      } else if (decision.resolvedValue !== undefined) {
        accepted = {
          id: `${group.id}::manual-resolution`,
          handoffId: group.handoffId,
          key: group.key,
          value: decision.resolvedValue,
          source: decision.resolvedSource || "使用者裁决",
          validUntil: decision.validUntil || null,
          resolutionNote: decision.note || "",
        };
      } else {
        invalidDecision = "裁决缺少 winnerContextId 或 resolvedValue";
      }
      resolved = Boolean(accepted);
    }

    if (hasConflict) {
      conflicts.push({
        ...group,
        resolved,
        decision: decision || null,
        selectedContext: accepted,
        staleResolution: accepted ? !isFresh(accepted, state.nowIso) : false,
        invalidDecision,
      });
    }
    acceptedByGroup.set(group.id, accepted);
  }
  conflicts.sort((a, b) => a.id.localeCompare(b.id));
  return { conflicts, acceptedByGroup };
}

function directEvaluation(item, existingIds, conflicts, acceptedByGroup, unresolvedByHandoff, nowIso) {
  const reasons = [];
  let ownStatus = "ready";
  let satisfiedRequired = 0;

  for (const key of item.requiredContextKeys) {
    const groupId = adjudicationKey(item.id, key);
    const accepted = acceptedByGroup.get(groupId);
    if (accepted) {
      if (isFresh(accepted, nowIso)) {
        satisfiedRequired += 1;
      } else {
        ownStatus = worstStatus([ownStatus, "untrusted"]);
        reasons.push({
          code: "STALE_CONTEXT",
          severity: "untrusted",
          contextKey: key,
          contextId: accepted.id,
          validUntil: accepted.validUntil,
          message: `关键上下文「${key}」已过时效（${accepted.validUntil}）`,
        });
      }
    } else if (unresolvedByHandoff.get(item.id)?.some((conflict) => conflict.key === key)) {
      ownStatus = worstStatus([ownStatus, "blocked"]);
      reasons.push({
        code: "UNRESOLVED_CONFLICT",
        severity: "blocked",
        contextKey: key,
        message: `关键上下文「${key}」存在来源冲突，等待使用者裁决`,
      });
    } else {
      ownStatus = worstStatus([ownStatus, "incomplete"]);
      reasons.push({
        code: "MISSING_CONTEXT",
        severity: "incomplete",
        contextKey: key,
        message: `缺少关键上下文「${key}」`,
      });
    }
  }

  for (const conflict of conflicts.filter((entry) => entry.handoffId === item.id)) {
    if (!conflict.resolved && !item.requiredContextKeys.includes(conflict.key)) {
      ownStatus = worstStatus([ownStatus, "blocked"]);
      reasons.push({
        code: "UNRESOLVED_CONFLICT",
        severity: "blocked",
        contextKey: conflict.key,
        message: `非必需上下文「${conflict.key}」存在来源冲突，裁决前不能继续推导`,
      });
    }
    if (conflict.resolved && conflict.staleResolution) {
      ownStatus = worstStatus([ownStatus, "untrusted"]);
      reasons.push({
        code: "STALE_ADJUDICATION",
        severity: "untrusted",
        contextKey: conflict.key,
        message: `冲突裁决采用的「${conflict.key}」已过时效`,
      });
    }
  }

  for (const depId of item.dependencies) {
    if (!existingIds.has(depId)) {
      ownStatus = worstStatus([ownStatus, "untrusted"]);
      reasons.push({
        code: "MISSING_DEPENDENCY",
        severity: "untrusted",
        dependencyId: depId,
        message: `前置依赖「${depId}」在交接清单中不存在`,
      });
    }
  }
  return { reasons, ownStatus, satisfiedRequired, requiredCount: item.requiredContextKeys.length };
}

function analyze(model, inputState = createAnalysisState(), nowIso = model.now) {
  const state = {
    ...clone(inputState),
    edits: inputState.edits || {},
    adjudications: inputState.adjudications || {},
    nowIso,
  };
  const handoffs = (model.handoffs || []).map(normalizeHandoff);
  const itemsById = new Map(handoffs.map((item) => [item.id, item]));
  const existingIds = new Set(itemsById.keys());
  const contexts = effectiveContexts(model, state);
  const { conflicts, acceptedByGroup } = buildConflictGroups(contexts, { ...state, nowIso });
  const unresolvedByHandoff = new Map();
  for (const conflict of conflicts) {
    if (!conflict.resolved) {
      if (!unresolvedByHandoff.has(conflict.handoffId)) unresolvedByHandoff.set(conflict.handoffId, []);
      unresolvedByHandoff.get(conflict.handoffId).push(conflict);
    }
  }

  const components = tarjanSCC(itemsById);
  const results = new Map();
  const ownByComponent = new Map();
  let componentSequence = 0;

  for (const component of components) {
    const cyclic = component.length > 1 ||
      component.some((id) => itemsById.get(id).dependencies.includes(id));
    let componentOwnStatus = "ready";
    let satisfied = 0;
    let requiredTotal = 0;
    const ownReasonsByItem = new Map();

    for (const id of component) {
      const direct = directEvaluation(
        itemsById.get(id), existingIds, conflicts, acceptedByGroup,
        unresolvedByHandoff, nowIso
      );
      ownReasonsByItem.set(id, direct);
      componentOwnStatus = worstStatus([componentOwnStatus, direct.ownStatus]);
      satisfied += direct.satisfiedRequired;
      requiredTotal += direct.requiredCount;
    }
    if (cyclic) componentOwnStatus = worstStatus([componentOwnStatus, "untrusted"]);
    ownByComponent.set(componentSequence, {
      cyclic, component, ownReasonsByItem, componentOwnStatus, satisfied, requiredTotal,
    });
    componentSequence += 1;
  }

  return finalizeComponents(model, {
    handoffs, itemsById, contexts, conflicts, components, ownByComponent, inputState, nowIso,
  });
}

function finalizeComponents(model, input) {
  const {
    handoffs, itemsById, contexts, conflicts, components,
    ownByComponent, inputState, nowIso,
  } = input;
  const results = new Map();

  components.forEach((component, componentIndex) => {
    const own = ownByComponent.get(componentIndex);
    const internal = new Set(component);
    const externalDeps = new Set();
    const missingDeps = new Set();
    for (const id of component) {
      for (const depId of itemsById.get(id).dependencies) {
        if (!itemsById.has(depId)) missingDeps.add(depId);
        else if (!internal.has(depId)) externalDeps.add(depId);
      }
    }

    let dependencyScore = 0;
    let inheritedStatus = "ready";
    const inheritedReasons = [];
    for (const depId of externalDeps) {
      const dep = results.get(depId);
      dependencyScore += dep.chainCompleteness;
      inheritedStatus = worstStatus([inheritedStatus, dep.status]);
      for (const reason of dep.reasons) {
        inheritedReasons.push({ ...reason, via: [...(reason.via || []), depId] });
      }
    }

    const dependencyTotal = externalDeps.size + missingDeps.size;
    const denominator = own.requiredTotal + dependencyTotal;
    const chainCompleteness = denominator === 0
      ? 1
      : Math.round(((own.satisfied + dependencyScore) / denominator) * 1000) / 1000;
    const status = worstStatus([own.componentOwnStatus, inheritedStatus]);

    for (const id of component) {
      const item = itemsById.get(id);
      const direct = own.ownReasonsByItem.get(id);
      const reasons = [...direct.reasons];
      if (own.cyclic) {
        reasons.push({
          code: "DEPENDENCY_CYCLE",
          severity: "untrusted",
          component,
          message: `依赖成环：${component.join(" → ")} → ${component[0]}；该链路缺少可验证起点`,
        });
      }
      for (const depId of item.dependencies) {
        const dep = results.get(depId);
        if (dep && dep.status !== "ready") {
          reasons.push({
            code: "UPSTREAM_NOT_READY",
            severity: dep.status === "blocked" ? "blocked" : dep.status,
            dependencyId: depId,
            upstreamStatus: dep.status,
            message: `上游交接「${depId}」状态为 ${dep.status}`,
          });
        }
      }
      reasons.push(...inheritedReasons);
      const contextCompleteness = direct.requiredCount === 0 ? 1 :
        Math.round((direct.satisfiedRequired / direct.requiredCount) * 1000) / 1000;
      results.set(id, {
        ...item,
        status,
        ownStatus: direct.ownStatus,
        contextCompleteness,
        chainCompleteness,
        reasons: dedupeReasons(reasons),
        affectedComponent: component,
      });
    }
  });

  const handoffResults = handoffs.map((item) => decorateTrustFlags(results.get(item.id)));
  const countBy = (statusName) => handoffResults.filter((item) => item.status === statusName).length;
  const summary = {
    total: handoffResults.length,
    ready: countBy("ready"),
    incomplete: countBy("incomplete"),
    untrusted: countBy("untrusted"),
    blocked: countBy("blocked"),
    unresolvedConflicts: conflicts.filter((conflict) => !conflict.resolved).length,
    averageCompleteness: handoffResults.length === 0 ? 1 :
      Math.round((handoffResults.reduce((sum, item) => sum + item.chainCompleteness, 0) /
        handoffResults.length) * 1000) / 1000,
  };
  return {
    now: nowIso,
    state: clone(inputState),
    handoffs: handoffResults,
    contexts,
    conflicts,
    summary,
  };
}

function prepareScopedAnalysis(model, inputState, nowIso, affectedIds, previousResult) {
  const state = {
    ...clone(inputState),
    edits: inputState.edits || {},
    adjudications: inputState.adjudications || {},
    nowIso,
  };
  const handoffs = (model.handoffs || []).map(normalizeHandoff);
  const itemsById = new Map(handoffs.map((item) => [item.id, item]));
  const existingIds = new Set(itemsById.keys());
  const allContexts = effectiveContexts(model, state);
  const affected = new Set(affectedIds);
  const scopedContexts = allContexts.filter((context) => affected.has(context.handoffId));
  const scopedConflictInfo = buildConflictGroups(scopedContexts, { ...state, nowIso });
  const conflicts = [...scopedConflictInfo.conflicts];
  const seenConflictIds = new Set(conflicts.map((conflict) => conflict.id));
  for (const conflict of previousResult?.conflicts || []) {
    if (!seenConflictIds.has(conflict.id) && !affected.has(conflict.handoffId)) {
      conflicts.push(conflict);
    }
  }
  conflicts.sort((a, b) => a.id.localeCompare(b.id));

  const acceptedByGroup = new Map(scopedConflictInfo.acceptedByGroup);
  for (const conflict of previousResult?.conflicts || []) {
    if (!acceptedByGroup.has(conflict.id) && !affected.has(conflict.handoffId)) {
      acceptedByGroup.set(conflict.id, conflict.selectedContext);
    }
  }
  const unresolvedByHandoff = new Map();
  for (const conflict of conflicts) {
    if (!conflict.resolved) {
      if (!unresolvedByHandoff.has(conflict.handoffId)) unresolvedByHandoff.set(conflict.handoffId, []);
      unresolvedByHandoff.get(conflict.handoffId).push(conflict);
    }
  }

  const components = tarjanSCC(itemsById);
  const ownByComponent = new Map();
  components.forEach((component, index) => {
    if (!component.some((id) => affected.has(id))) return;
    const cyclic = component.length > 1 ||
      component.some((id) => itemsById.get(id).dependencies.includes(id));
    let componentOwnStatus = "ready";
    let satisfied = 0;
    let requiredTotal = 0;
    const ownReasonsByItem = new Map();
    for (const id of component) {
      const direct = directEvaluation(
        itemsById.get(id), existingIds, conflicts, acceptedByGroup,
        unresolvedByHandoff, nowIso
      );
      ownReasonsByItem.set(id, direct);
      componentOwnStatus = worstStatus([componentOwnStatus, direct.ownStatus]);
      satisfied += direct.satisfiedRequired;
      requiredTotal += direct.requiredCount;
    }
    if (cyclic) componentOwnStatus = worstStatus([componentOwnStatus, "untrusted"]);
    ownByComponent.set(index, {
      cyclic, component, ownReasonsByItem, componentOwnStatus, satisfied, requiredTotal,
    });
  });
  return { handoffs, itemsById, allContexts, conflicts, components, ownByComponent, inputState, nowIso, affected };
}

function recomputeComponent(component, own, prepared, results) {
  const internal = new Set(component);
  const externalDeps = new Set();
  const missingDeps = new Set();
  for (const id of component) {
    for (const depId of prepared.itemsById.get(id).dependencies) {
      if (!prepared.itemsById.has(depId)) missingDeps.add(depId);
      else if (!internal.has(depId)) externalDeps.add(depId);
    }
  }
  let dependencyScore = 0;
  let inheritedStatus = "ready";
  const inheritedReasons = [];
  for (const depId of externalDeps) {
    const dep = results.get(depId);
    dependencyScore += dep.chainCompleteness;
    inheritedStatus = worstStatus([inheritedStatus, dep.status]);
    for (const reason of dep.reasons) {
      inheritedReasons.push({ ...reason, via: [...(reason.via || []), depId] });
    }
  }
  const denominator = own.requiredTotal + externalDeps.size + missingDeps.size;
  const chainCompleteness = denominator === 0 ? 1 :
    Math.round(((own.satisfied + dependencyScore) / denominator) * 1000) / 1000;
  const status = worstStatus([own.componentOwnStatus, inheritedStatus]);

  for (const id of component) {
    const item = prepared.itemsById.get(id);
    const direct = own.ownReasonsByItem.get(id);
    const reasons = [...direct.reasons];
    if (own.cyclic) {
      reasons.push({
        code: "DEPENDENCY_CYCLE",
        severity: "untrusted",
        component,
        message: `依赖成环：${component.join(" → ")} → ${component[0]}；该链路缺少可验证起点`,
      });
    }
    for (const depId of item.dependencies) {
      const dep = results.get(depId);
      if (dep && dep.status !== "ready") {
        reasons.push({
          code: "UPSTREAM_NOT_READY",
          severity: dep.status === "blocked" ? "blocked" : dep.status,
          dependencyId: depId,
          upstreamStatus: dep.status,
          message: `上游交接「${depId}」状态为 ${dep.status}`,
        });
      }
    }
    reasons.push(...inheritedReasons);
    results.set(id, {
      ...item,
      status,
      ownStatus: direct.ownStatus,
      contextCompleteness: direct.requiredCount === 0 ? 1 :
        Math.round((direct.satisfiedRequired / direct.requiredCount) * 1000) / 1000,
      chainCompleteness,
      reasons: dedupeReasons(reasons),
      affectedComponent: component,
    });
  }
}

function summarize(handoffs, contexts, conflicts, inputState, nowIso) {
  const countBy = (statusName) => handoffs.filter((item) => item.status === statusName).length;
  return {
    now: nowIso,
    state: clone(inputState),
    handoffs,
    contexts,
    conflicts,
    summary: {
      total: handoffs.length,
      ready: countBy("ready"),
      incomplete: countBy("incomplete"),
      untrusted: countBy("untrusted"),
      blocked: countBy("blocked"),
      unresolvedConflicts: conflicts.filter((conflict) => !conflict.resolved).length,
      averageCompleteness: handoffs.length === 0 ? 1 :
        Math.round((handoffs.reduce((sum, item) => sum + item.chainCompleteness, 0) /
          handoffs.length) * 1000) / 1000,
    },
  };
}

function recomputeChain(model, state, seedIds, previousResult = null, nowIso = model.now) {
  const affected = expandSCCSeeds(model, seedIds);
  if (!previousResult) {
    return { affected: [...affected], result: analyze(model, state, nowIso), reused: [] };
  }
  const prepared = prepareScopedAnalysis(model, state, nowIso, affected, previousResult);
  const results = new Map(previousResult.handoffs
    .filter((item) => !affected.has(item.id))
    .map((item) => [item.id, item]));
  prepared.components.forEach((component, index) => {
    const own = prepared.ownByComponent.get(index);
    if (own) recomputeComponent(component, own, prepared, results);
  });
  const handoffs = prepared.handoffs
    .map((item) => decorateTrustFlags(results.get(item.id)));
  return {
    affected: [...affected],
    result: summarize(handoffs, prepared.allContexts, prepared.conflicts, state, nowIso),
    reused: previousResult.handoffs.map((item) => item.id).filter((id) => !affected.has(id)),
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    STATUS_PRIORITY,
    adjudicateConflict,
    analyze,
    applyContextEdit,
    clearAdjudication,
    createAnalysisState,
    downstreamClosure,
    recomputeChain,
  };
}

if (typeof window !== "undefined") {
  window.HandoffEngine = {
    STATUS_PRIORITY,
    adjudicateConflict,
    analyze,
    applyContextEdit,
    clearAdjudication,
    createAnalysisState,
    downstreamClosure,
    recomputeChain,
  };
}
