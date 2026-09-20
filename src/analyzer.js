/* Pure keyboard-task-flow analyzer. Shared by browser UI and Node tests. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AutoDemoAnalyzer = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const COMPLETION_MODES = new Set(["all", "any", "none"]);

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function asArray(value) {
    if (Array.isArray(value)) return value;
    return value === undefined || value === null ? [] : [value];
  }

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function stableKey(value) {
    return JSON.stringify(value, function (key, val) {
      if (key === "id" || key === "index") return val;
      if (val && typeof val === "object" && !Array.isArray(val)) {
        return Object.keys(val).sort().reduce((out, k) => {
          out[k] = val[k];
          return out;
        }, {});
      }
      return val;
    });
  }

  function issue(severity, code, message, controlId, extra) {
    return Object.assign({ severity, code, message, controlId: controlId || null }, extra || {});
  }

  function normalizeCompletion(step) {
    const raw = step.completion || { mode: "all" };
    const mode = typeof raw.mode === "string" ? raw.mode.toLowerCase() : "all";
    let controls = asArray(raw.controls).map(String);
    if (controls.length === 0) {
      controls = asArray(step.controls)
        .filter((c) => c && c.optional !== true)
        .map((c) => String(c.id));
    }
    return { mode, controls, raw };
  }

  function hasSemanticLabel(control) {
    return Boolean(
      text(control.label) ||
      text(control.ariaLabel) ||
      text(control.ariaLabelledby) ||
      text(control.text)
    );
  }

  function controlName(control) {
    return text(control.label) || text(control.ariaLabel) || text(control.name) || String(control.id);
  }

  function buildEdges(step, controls) {
    const edges = [];
    const add = (from, to, source) => {
      if (!from || !to || from === to) return;
      edges.push({ from: String(from), to: String(to), source });
    };

    if (Array.isArray(step.order) && step.order.length) {
      for (let i = 0; i < step.order.length - 1; i += 1) {
        add(step.order[i], step.order[i + 1], "order");
      }
    } else {
      const required = controls.filter((c) => c.optional !== true).map((c) => String(c.id));
      for (let i = 0; i < required.length - 1; i += 1) add(required[i], required[i + 1], "sequence");
    }

    controls.forEach((control) => {
      asArray(control.before).forEach((to) => add(control.id, to, "relation"));
      asArray(control.after).forEach((from) => add(from, control.id, "relation"));
    });
    asArray(step.relations).forEach((rel) => add(rel.from, rel.to, "relation"));
    return edges;
  }

  function findCycleNodes(nodes, adjacency) {
    const cycles = new Set();
    const state = new Map();
    const stack = [];

    function visit(id) {
      state.set(id, "active");
      stack.push(id);
      (adjacency.get(id) || []).forEach((next) => {
        if (!nodes.has(next)) return;
        if (!state.has(next)) visit(next);
        else if (state.get(next) === "active") {
          const start = stack.indexOf(next);
          stack.slice(start).forEach((node) => cycles.add(node));
        }
      });
      stack.pop();
      state.set(id, "done");
    }

    nodes.forEach((id) => {
      if (!state.has(id)) visit(id);
    });
    return cycles;
  }

  function analyzeStepStructure(step, index) {
    const rawControls = asArray(step.controls);
    const controls = rawControls.map((c, i) => {
      const source = c && typeof c === "object" ? c : { id: c };
      return Object.assign({ type: "generic", focusable: true }, source, {
        id: String(source.id === undefined ? `control_${i + 1}` : source.id),
      });
    });
    const byId = new Map();
    const issues = [];
    controls.forEach((control) => {
      if (byId.has(control.id)) {
        issues.push(issue("error", "duplicate-control", `控件 ID ${control.id} 重复`, control.id));
      }
      byId.set(control.id, control);
    });

    const completion = normalizeCompletion(Object.assign({}, step, { controls }));
    if (!COMPLETION_MODES.has(completion.mode)) {
      issues.push(issue("error", "invalid-completion", `未知完成条件模式 ${completion.mode}`));
    }
    const requiredControlIds = completion.controls;
    requiredControlIds.forEach((id) => {
      if (!byId.has(id)) {
        issues.push(issue("error", "missing-completion-control",
          `完成条件引用了不存在的控件 ${id}`, id));
      }
    });

    const edges = buildEdges(Object.assign({}, step, { controls }), controls);
    const adjacency = new Map(controls.map((c) => [c.id, []]));
    const predecessors = new Map(controls.map((c) => [c.id, []]));
    edges.forEach((edge) => {
      if (!byId.has(edge.from) || !byId.has(edge.to)) {
        issues.push(issue("error", "missing-order-control",
          `顺序关系引用了不存在的控件：${edge.from} 到 ${edge.to}`, edge.from));
        return;
      }
      adjacency.get(edge.from).push(edge.to);
      predecessors.get(edge.to).push(edge.from);
    });

    controls.forEach((control) => {
      if (control.focusable === false) return;
      if (!hasSemanticLabel(control)) {
        issues.push(issue("error", "missing-label", "控件缺少可访问名称", control.id, { culprit: true }));
      }
      if (control.trap === true) {
        issues.push(issue("warning", "focus-trap",
          "该控件形成焦点陷阱；Tab 无法自然离开", control.id, { culprit: true }));
      }
    });

    const nodeSet = new Set(controls.map((c) => c.id));
    const cycleNodes = findCycleNodes(nodeSet, adjacency);
    cycleNodes.forEach((id) => issues.push(issue("error", "order-cycle",
      "控件顺序存在循环冲突", id, { culprit: true })));

    const indegree = new Map(controls.map((c) => [c.id, 0]));
    edges.forEach((edge) => {
      if (byId.has(edge.from) && byId.has(edge.to)) {
        indegree.set(edge.to, (indegree.get(edge.to) || 0) + 1);
      }
    });

    const queue = controls.filter((c) => (indegree.get(c.id) || 0) === 0).map((c) => c.id);
    const topological = [];
    while (queue.length) {
      const id = queue.shift();
      topological.push(id);
      (adjacency.get(id) || []).forEach((next) => {
        indegree.set(next, indegree.get(next) - 1);
        if (indegree.get(next) === 0) queue.push(next);
      });
    }

    const state = new Map();
    const reachInfo = new Map();
    function reachableOf(id) {
      if (reachInfo.has(id)) return reachInfo.get(id);
      const control = byId.get(id);
      const missingLabel = control.focusable !== false && !hasSemanticLabel(control);
      const preds = predecessors.get(id) || [];
      let result = { reachable: control.focusable !== false && !missingLabel, reason: null, after: null };

      if (state.get(id) === "active") {
        result = { reachable: false, reason: "order-cycle", after: null };
        reachInfo.set(id, result);
        return result;
      }
      state.set(id, "active");
      preds.forEach((p) => {
        const parent = reachableOf(p);
        const parentState = state.get(p);
        if (!result.reachable) return;
        if (!parent.reachable || parentState === "trap") {
          result = {
            reachable: false,
            reason: parentState === "trap" ? "after-focus-trap" :
              (parent.reason === "order-cycle" || cycleNodes.has(p) ? "after-order-cycle" : "after-unreachable-control"),
            after: p,
          };
        }
      });
      if (control.focusable === false) result = { reachable: false, reason: "not-focusable", after: null };
      else if (missingLabel) result = { reachable: false, reason: "missing-label", after: null };
      if (cycleNodes.has(id)) result = { reachable: false, reason: "order-cycle", after: result.after };
      reachInfo.set(id, result);
      state.set(id, result.reachable ? (control.trap ? "trap" : "reachable") : "blocked");
      return result;
    }
    controls.forEach((c) => reachableOf(c.id));

    const unreachableControls = [];
    const reachableControlIds = [];
    topological.forEach((id) => {
      const result = reachableOf(id);
      if (result.reachable) reachableControlIds.push(id);
      else {
        unreachableControls.push({
          id,
          name: controlName(byId.get(id)),
          reasonCode: result.reason,
          after: result.after,
          culprit: ["missing-label", "order-cycle", "not-focusable"].includes(result.reason),
        });
      }
    });

    const trapControlIds = controls.filter((c) => c.trap === true).map((c) => c.id);
    const terminalTrap = trapControlIds.find((id) => state.get(id) === "trap") || null;

    return {
      index,
      id: String(step.id === undefined ? `step_${index + 1}` : step.id),
      name: text(step.name) || text(step.title) || `步骤 ${index + 1}`,
      controls,
      completionSpec: completion,
      requiredControlIds,
      issues,
      edges,
      topologicalOrder: topological.slice(),
      reachableControlIds,
      unreachableControls,
      trapControlIds,
      terminalTrap,
      missingLabelControlIds: controls.filter((c) => reachableOf(c.id).reason === "missing-label").map((c) => c.id),
      orderConflictControlIds: Array.from(cycleNodes),
    };
  }

  function isActiveValue(value, control) {
    const type = (control && control.type || "generic").toLowerCase();
    if (value === undefined || value === null) return false;
    if (type === "checkbox") return value === true;
    if (type === "radio" || type === "option") return value !== false && value !== "";
    if (type === "textbox" || type === "textarea" || type === "combobox") return String(value).trim().length > 0;
    if (type === "select" || type === "listbox") return value !== "" && value !== null;
    if (type === "button" || type === "link") return value === true || value === "activated";
    return value === true || value === "activated" || String(value).trim().length > 0;
  }

  function evaluateCompletion(structure, values, actions) {
    const spec = structure.completionSpec;
    const valuesMap = values || {};
    const actionsSet = new Set(asArray(actions));
    const referenced = spec.controls.map((id) => {
      const control = structure.controls.find((c) => c.id === id);
      const reachable = structure.reachableControlIds.includes(id);
      const type = control ? (control.type || "generic").toLowerCase() : "generic";
      const usesActivationAction = ["button", "link", "generic"].includes(type);
      const active = usesActivationAction ?
        actionsSet.has(id) :
        isActiveValue(valuesMap[id], control);
      return { id, exists: Boolean(control), reachable, active, control };
    });
    let satisfied = false;
    if (spec.mode === "all") {
      satisfied = referenced.length > 0 && referenced.every((r) => r.exists && r.reachable && r.active);
    } else if (spec.mode === "any") {
      satisfied = referenced.some((r) => r.exists && r.reachable && r.active);
    } else if (spec.mode === "none") {
      satisfied = referenced.every((r) => r.exists && r.reachable && !r.active);
    }
    const potential = spec.mode === "none"
      ? referenced.every((r) => r.exists && r.reachable)
      : spec.mode === "any"
        ? referenced.some((r) => r.exists && r.reachable)
        : referenced.length > 0 && referenced.every((r) => r.exists && r.reachable);
    return {
      mode: spec.mode,
      controls: referenced,
      satisfied,
      potentiallySatisfiable: potential,
    };
  }

  function normalizeRulings(rulings) {
    const source = rulings || {};
    const result = {};
    Object.keys(source).forEach((id) => {
      const value = source[id] || {};
      result[String(id)] = {
        skipped: value.skipped === true,
        forced: value.forced === true,
        note: text(value.note),
        at: value.at || null,
      };
    });
    return result;
  }

  function reasonText(code) {
    return {
      "missing-label": "语义标签缺失",
      "order-cycle": "顺序冲突",
      "after-focus-trap": "位于焦点陷阱之后",
      "after-order-cycle": "位于顺序冲突之后",
      "after-unreachable-control": "位于不可达控件之后",
      "not-focusable": "控件不可聚焦",
    }[code] || code;
  }

  function structuralBlockReason(structure) {
    const required = new Set(structure.requiredControlIds);
    const missingRequiredLabels = structure.controls
      .filter((control) => required.has(control.id) && control.focusable !== false && !hasSemanticLabel(control))
      .map((control) => control.id);
    if (missingRequiredLabels.length) return `完成条件所需控件语义标签缺失：${missingRequiredLabels.join("、")}`;

    const cycles = structure.orderConflictControlIds;
    if (cycles.length) return `控件顺序循环冲突：${cycles.join("、")}`;

    const unreachableRequired = structure.requiredControlIds
      .filter((id) => !structure.reachableControlIds.includes(id))
      .map((id) => {
        const item = structure.unreachableControls.find((u) => u.id === id);
        return item ? `${id}（${reasonText(item.reasonCode)}）` : id;
      });
    if (unreachableRequired.length) return `完成条件控件不可达：${unreachableRequired.join("、")}`;

    const specError = structure.issues.find((item) =>
      item.severity === "error" && ["invalid-completion", "missing-completion-control"].includes(item.code));
    return specError ? specError.message : null;
  }

  function analyzeFlow(definition, session, rulings, prebuiltSteps) {
    const steps = prebuiltSteps || asArray(definition && definition.steps).map((step, index) =>
      analyzeStepStructure(step || {}, index));
    const idCounts = new Map();
    steps.forEach((step) => idCounts.set(step.id, (idCounts.get(step.id) || 0) + 1));
    const rulingMap = normalizeRulings(rulings);
    const sessionByStep = (session && session.steps) || {};
    const results = [];

    steps.forEach((structure, index) => {
      const previous = results[index - 1] || null;
      const ruling = rulingMap[structure.id] || { skipped: false, forced: false, note: "", at: null };
      const sessionStep = sessionByStep[structure.id] || {};
      const completion = evaluateCompletion(structure, sessionStep.values, sessionStep.actions);
      const definitionError = structuralBlockReason(structure);
      const duplicateStep = idCounts.get(structure.id) > 1;
      const gateReasons = [];

      if (duplicateStep) gateReasons.push(`步骤 ID ${structure.id} 重复`);
      if (previous && !(previous.completion.satisfied || previous.ruling.skipped)) {
        gateReasons.push(`前置步骤 ${previous.index + 1}（${previous.name}）未完成`);
      }
      if (previous && (previous.completion.satisfied || previous.ruling.skipped) &&
          !previous.effectivePathReachable) {
        gateReasons.push(`前置步骤 ${previous.index + 1}（${previous.name}）不在有效可达路径上，跳过不能修复其定义问题`);
      }
      if (definitionError) gateReasons.push(definitionError);

      const preconditionSatisfied = !previous ||
        previous.completion.satisfied || previous.ruling.skipped;
      const predecessorOnPath = !previous || previous.effectivePathReachable;
      const naturallyEnterable = preconditionSatisfied && predecessorOnPath &&
        !definitionError && !duplicateStep;
      const naturallyPassable = naturallyEnterable &&
        (completion.potentiallySatisfiable || completion.satisfied);
      const predecessorReleases = !previous ||
        (previous.effectivePathReachable && previous.completed);
      const effectivePathReachable = Boolean(
        ruling.forced || (predecessorReleases && !definitionError && !duplicateStep)
      );
      const completed = Boolean(ruling.skipped || completion.satisfied);
      const entryBasis = ruling.forced ? "ruling" : "derived";
      const completionBasis = ruling.skipped && !completion.satisfied ? "ruling" : "derived";

      results.push({
        index,
        id: structure.id,
        name: structure.name,
        structure,
        ruling,
        completion,
        completed,
        preconditionSatisfied,
        blockedReasons: gateReasons,
        definitionBlocked: Boolean(definitionError || duplicateStep),
        definitionBlockReason: duplicateStep ? `步骤 ID ${structure.id} 重复` : definitionError,
        naturallyEnterable,
        naturallyPassable,
        enterable: ruling.forced || naturallyEnterable,
        effectivePathReachable,
        entryBasis,
        completionBasis,
        pathConclusion: ruling.forced && !naturallyEnterable ? "forced-entry" :
          (effectivePathReachable ? "reachable" : "unreachable"),
      });
    });

    const firstBlocked = results.find((step) => !step.effectivePathReachable);
    return {
      name: text(definition && definition.name) || "键盘任务流",
      steps: results,
      reachablePath: results
        .filter((step) => step.effectivePathReachable)
        .map((step) => ({
          index: step.index,
          id: step.id,
          name: step.name,
          controls: step.structure.reachableControlIds.slice(),
          conclusion: step.pathConclusion,
          completed: step.completed,
          completionBasis: step.completionBasis,
        })),
      firstBlockedStep: firstBlocked ? firstBlocked.index : null,
      rulings: rulingMap,
    };
  }

  function createIncrementalAnalyzer() {
    let cachedSignatures = [];
    let cachedStructures = [];
    let lastAnalysis = null;

    function analyze(definition, session, rulings, options) {
      const requestedFrom = options && Number.isInteger(options.fromIndex) ?
        Math.max(0, options.fromIndex) : null;
      const rawSteps = asArray(definition && definition.steps);
      const signatures = rawSteps.map((step) => stableKey(step || {}));
      let firstChanged = 0;
      if (requestedFrom !== null) {
        firstChanged = Math.min(requestedFrom, rawSteps.length);
      } else {
        while (
          firstChanged < rawSteps.length &&
          firstChanged < cachedSignatures.length &&
          signatures[firstChanged] === cachedSignatures[firstChanged]
        ) firstChanged += 1;
      }

      const structures = cachedStructures.slice(0, firstChanged);
      for (let index = firstChanged; index < rawSteps.length; index += 1) {
        structures[index] = analyzeStepStructure(rawSteps[index] || {}, index);
      }

      cachedSignatures = signatures;
      cachedStructures = structures;
      lastAnalysis = analyzeFlow(definition, session, rulings, structures);
      lastAnalysis.incremental = {
        recomputedFrom: rawSteps.length ? firstChanged : 0,
        recomputedIndexes: rawSteps.slice(firstChanged).map((_, i) => firstChanged + i),
        reusedIndexes: Array.from({ length: firstChanged }, (_, i) => i),
      };
      return lastAnalysis;
    }

    return { analyze, get lastAnalysis() { return lastAnalysis; } };
  }

  function validateDefinition(definition) {
    const errors = [];
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
      return [{ message: "Definition must be a JSON object" }];
    }
    if (!Array.isArray(definition.steps) || definition.steps.length === 0) {
      errors.push({ message: "steps must be a non-empty array" });
    }
    const ids = new Map();
    asArray(definition.steps).forEach((step, index) => {
      if (!step || typeof step !== "object") {
        errors.push({ stepIndex: index, message: "Each step must be an object" });
        return;
      }
      const id = String(step.id === undefined ? `step_${index + 1}` : step.id);
      ids.set(id, (ids.get(id) || 0) + 1);
      asArray(step.controls).forEach((control) => {
        if (!control || typeof control !== "object") return;
        const controlIds = new Set(asArray(step.controls).map((other) => String(other.id)));
        asArray(control.before).concat(asArray(control.after)).forEach((ref) => {
          if (!controlIds.has(String(ref))) {
            errors.push({ stepIndex: index, message: `Control ${control.id} references missing control ${ref}` });
          }
        });
      });
    });
    ids.forEach((count, id) => {
      if (count > 1) errors.push({ message: `Duplicate step id ${id}` });
    });
    return errors;
  }

  return {
    analyzeStepStructure,
    analyzeFlow,
    createIncrementalAnalyzer,
    evaluateCompletion,
    isActiveValue,
    validateDefinition,
    reasonText,
    clone,
  };
});
