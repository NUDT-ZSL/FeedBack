/* 减排计划推导引擎：无依赖、可离线运行，同时供浏览器与 Node 测试使用。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PlanEngine = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const clone = (value) => value === undefined ? value : JSON.parse(JSON.stringify(value));
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const keyOf = (value) => (value === undefined || value === null ? "" : String(value));
  const uniq = (items) => Array.from(new Set(items));

  function issue(code, severity, message, refs) {
    return Object.assign({ code, severity, message, basis: message }, refs || {});
  }

  class PlanEngine {
    constructor(input = {}, options = {}) {
      this.originalInput = clone(input) || {};
      this.data = clone(input) || {};
      this.data.phases = Array.isArray(this.data.phases) ? this.data.phases : [];
      this.data.measures = Array.isArray(this.data.measures) ? this.data.measures : [];
      this.locks = {};
      this.excluded = new Set(options.excludedMeasureIds || []);
      this._evalCache = new Map();
      this._buildMetadata();
      this.lastCutoff = this.periods.length ? this.periods.length - 1 : 0;
    }

    analyze(cutoff = this.lastCutoff) {
      const cutoffIndex = Math.max(0, Math.min(this.lastCutoff, Number(cutoff) || 0));
      if (!this._evalCache.has(cutoffIndex)) this._evalCache.set(cutoffIndex, new Map());
      const cache = this._evalCache.get(cutoffIndex);
      for (const phaseId of this.topologicalOrder) {
        if (!cache.has(phaseId)) cache.set(phaseId, this._evaluatePhase(phaseId, cutoffIndex));
      }
      return {
        periods: this.periods.slice(),
        cutoffIndex,
        cutoffPeriod: this.periods[cutoffIndex] || null,
        phases: this.phaseIds.map((id) => cache.get(id)),
        issues: this.issues,
        invalidPhaseIds: Array.from(this.invalidPhases),
        summary: this._summary(cache)
      };
    }

    fullReanalyze(cutoff = this.lastCutoff) {
      const fresh = new PlanEngine(this.data, { excludedMeasureIds: Array.from(this.excluded) });
      fresh.locks = Object.assign({}, this.locks);
      return fresh.analyze(cutoff);
    }

    setPhaseTarget(phaseId, target) {
      const id = keyOf(phaseId);
      if (!this.phaseMap.has(id)) throw new Error(`阶段不存在：${id}`);
      if (!finite(Number(target))) throw new Error("目标减排量必须是有限数字");
      const affected = this._affectedFromPhases([id]);
      this.phaseMap.get(id).target = Number(target);
      this.phaseMap.get(id).raw.target = Number(target);
      this._rebuildAfterStructuralInputChange(affected);
      return { analysis: this.analyze(this.lastCutoff), affected };
    }

    setMeasureActual(measureId, period, value) {
      const id = keyOf(measureId);
      const group = this.measureGroups.get(id);
      if (!group || !group.length) throw new Error(`措施不存在：${id}`);
      const periodKey = keyOf(period);
      if (!this.periods.includes(periodKey)) throw new Error(`考核期不存在：${periodKey}`);
      const numberValue = Number(value);
      if (!finite(numberValue)) throw new Error("实际减排量必须是有限数字");
      const owners = uniq(group.map((item) => item.phaseId).filter(Boolean));
      const affected = this._affectedFromPhases(owners);
      for (const record of group) {
        if (!record.actuals || typeof record.actuals !== "object" || Array.isArray(record.actuals)) {
          record.actuals = {};
        }
        record.actuals[periodKey] = numberValue;
      }
      this._rebuildAfterStructuralInputChange(affected);
      return { analysis: this.analyze(this.lastCutoff), affected };
    }

    setMeasureExcluded(measureId, excluded) {
      const id = keyOf(measureId);
      const group = this.measureGroups.get(id);
      if (!group || !group.length) throw new Error(`措施不存在：${id}`);
      const owners = uniq(group.map((item) => item.phaseId).filter(Boolean));
      const affected = this._affectedFromPhases(owners);
      if (excluded) this.excluded.add(id);
      else this.excluded.delete(id);
      this._invalidateAffected(affected);
      return { analysis: this.analyze(this.lastCutoff), affected };
    }

    setPhaseLock(phaseId, status) {
      const id = keyOf(phaseId);
      if (!this.phaseMap.has(id)) throw new Error(`阶段不存在：${id}`);
      if (status !== null && status !== undefined && status !== "achieved" && status !== "behind") {
        throw new Error("锁定结论只能是 achieved 或 behind");
      }
      const affected = this._affectedFromPhases([id], false);
      if (status === null || status === undefined) delete this.locks[id];
      else this.locks[id] = status;
      this._invalidateAffected(affected);
      return { analysis: this.analyze(this.lastCutoff), affected };
    }

    _rebuildAfterStructuralInputChange(affected) {
      this._buildMetadata();
      this._invalidateAffected(affected);
    }

    _invalidateAffected(affected) {
      for (const cache of this._evalCache.values()) {
        for (const id of affected) cache.delete(id);
      }
    }

    _affectedFromPhases(seedIds, includeDependents = true) {
      const seeds = new Set(seedIds.filter((id) => this.phaseMap.has(id)));
      if (!includeDependents) return Array.from(seeds);
      const result = new Set(seeds);
      const queue = Array.from(seeds);
      while (queue.length) {
        const id = queue.shift();
        for (const dependent of this.reverseEdges.get(id) || []) {
          if (!result.has(dependent)) {
            result.add(dependent);
            queue.push(dependent);
          }
        }
      }
      return this.phaseIds.filter((id) => result.has(id));
    }

    _buildMetadata() {
      this.issues = [];
      this.periods = this._buildPeriods();
      this.lastCutoff = this.periods.length ? this.periods.length - 1 : 0;
      this._buildPhaseMetadata();
      this._buildMeasureMetadata();
      this._buildGraphAndTrust();
    }

    _buildPeriods() {
      const declared = Array.isArray(this.data.periods) ? this.data.periods.map(keyOf).filter(Boolean) : [];
      if (declared.length) return uniq(declared);
      const inferred = [];
      for (const phase of this.data.phases) {
        const start = keyOf(phase && phase.startPeriod);
        const end = keyOf(phase && phase.endPeriod);
        if (start && !inferred.includes(start)) inferred.push(start);
        if (end && !inferred.includes(end)) inferred.push(end);
      }
      for (const measure of this.data.measures) {
        const actuals = measure && measure.actuals;
        if (actuals && typeof actuals === "object" && !Array.isArray(actuals)) {
          for (const period of Object.keys(actuals)) {
            if (period && !inferred.includes(period)) inferred.push(period);
          }
        }
      }
      return inferred;
    }

    _buildPhaseMetadata() {
      this.phaseMap = new Map();
      this.phaseIds = [];
      const malformed = new Set();

      this.data.phases.forEach((raw, index) => {
        const id = keyOf(raw && raw.id);
        if (!id) {
          malformed.add(`#${index}`);
          this.issues.push(issue("PHASE_ID_MISSING", "error", `第 ${index + 1} 个阶段缺少 id，已不参与推导。`, { phaseIndex: index }));
          return;
        }
        if (this.phaseMap.has(id)) {
          malformed.add(id);
          this.issues.push(issue("PHASE_DUPLICATE_ID", "error", `阶段 ${id} 的 id 重复，重复阶段不参与推导。`, { phaseIds: [id] }));
          return;
        }
        const name = keyOf(raw.name) || id;
        const startPeriod = keyOf(raw.startPeriod);
        const endPeriod = keyOf(raw.endPeriod);
        const target = Number(raw.target);
        const prerequisites = this._normalizePrerequisites(raw.prerequisites);
        const record = { id, name, raw, index, startPeriod, endPeriod, target, prerequisites };
        record.structuralIssues = [];
        if (!finite(target) || target < 0) {
          record.structuralIssues.push("PHASE_TARGET_INVALID");
          this.issues.push(issue("PHASE_TARGET_INVALID", "error",
            `阶段 ${name} 的目标减排量无效，该阶段及所有下游阶段结论不可信。`, { phaseIds: [id] }));
        }
        if (!this.periods.includes(startPeriod) || !this.periods.includes(endPeriod)) {
          record.structuralIssues.push("PHASE_PERIOD_MISSING");
          this.issues.push(issue("PHASE_PERIOD_MISSING", "error",
            `阶段 ${name} 的起止考核期未在 periods 中定义，结论不可信。`, { phaseIds: [id] }));
        } else if (this.periods.indexOf(startPeriod) > this.periods.indexOf(endPeriod)) {
          record.structuralIssues.push("PHASE_PERIOD_REVERSED");
          this.issues.push(issue("PHASE_PERIOD_REVERSED", "error",
            `阶段 ${name} 的起始考核期晚于结束考核期，结论不可信。`, { phaseIds: [id] }));
        }
        this.phaseMap.set(id, record);
        this.phaseIds.push(id);
      });

      this.malformedPhases = malformed;
    }

    _normalizePrerequisites(value) {
      if (value === undefined || value === null) return [];
      if (Array.isArray(value)) return uniq(value.map(keyOf).filter(Boolean));
      return [keyOf(value)].filter(Boolean);
    }

    _buildMeasureMetadata() {
      this.measureGroups = new Map();
      this.measures = [];
      const invalidMeasures = new Set();
      const ownerInvalidity = new Map();

      this.data.measures.forEach((raw, index) => {
        const id = keyOf(raw && raw.id);
        if (!id) {
          this.issues.push(issue("MEASURE_ID_MISSING", "error",
            `第 ${index + 1} 条措施缺少 id，已不参与推导。`, { measureIndex: index }));
          return;
        }
        const phaseId = keyOf(raw.phaseId);
        const phase = this.phaseMap.get(phaseId);
        if (!phase) {
          this.issues.push(issue("MEASURE_PHASE_MISSING", "error",
            `措施 ${id} 指向的阶段 ${phaseId || "(空)"} 不存在，无法归属偏差。`,
            { measureIds: [id], phaseIds: phaseId ? [phaseId] : [] }));
          invalidMeasures.add(id);
          return;
        }
        const planned = Number(raw.planned);
        if (!finite(planned) || planned < 0) {
          this.issues.push(issue("MEASURE_PLAN_INVALID", "error",
            `措施 ${id} 的计划减排量无效，${phase.name}及下游结论不可信。`,
            { measureIds: [id], phaseIds: [phaseId] }));
          invalidMeasures.add(id);
          ownerInvalidity.set(phaseId, (ownerInvalidity.get(phaseId) || []).concat("MEASURE_PLAN_INVALID"));
        }
        const actuals = raw.actuals && typeof raw.actuals === "object" && !Array.isArray(raw.actuals) ? raw.actuals : {};
        if (phase && this.periods.includes(phase.startPeriod) && this.periods.includes(phase.endPeriod)) {
          for (const period of Object.keys(actuals)) {
            const periodIndex = this.periods.indexOf(period);
            if (periodIndex >= 0 && (periodIndex < this.periods.indexOf(phase.startPeriod) ||
              periodIndex > this.periods.indexOf(phase.endPeriod))) {
              this.issues.push(issue("MEASURE_ACTUAL_OUTSIDE_WINDOW", "warning",
                `措施 ${id} 在 ${period} 的结果位于阶段 ${phase.name} 的考核窗口外，累计时不会采用。`,
                { measureIds: [id], phaseIds: [phaseId], periods: [period] }));
            }
          }
        }
        for (const period of Object.keys(actuals)) {
          if (!this.periods.includes(period) || !finite(Number(actuals[period]))) {
            this.issues.push(issue("MEASURE_ACTUAL_INVALID", "error",
              `措施 ${id} 在考核期 ${period} 的实际结果缺失或不是有限数字，相关结论不可信。`,
              { measureIds: [id], phaseIds: [phaseId], periods: [period] }));
            invalidMeasures.add(id);
            ownerInvalidity.set(phaseId, (ownerInvalidity.get(phaseId) || []).concat("MEASURE_ACTUAL_INVALID"));
          }
        }
        const record = {
          id,
          name: keyOf(raw.name) || id,
          phaseId,
          planned,
          actuals,
          raw,
          index
        };
        if (!this.measureGroups.has(id)) this.measureGroups.set(id, []);
        this.measureGroups.get(id).push(record);
        this.measures.push(record);
      });

      for (const [id, records] of this.measureGroups) {
        const owners = uniq(records.map((item) => item.phaseId));
        if (owners.length > 1) {
          invalidMeasures.add(id);
          for (const owner of owners) {
            ownerInvalidity.set(owner, (ownerInvalidity.get(owner) || []).concat("MEASURE_PHASE_DUPLICATE"));
          }
          this.issues.push(issue("MEASURE_PHASE_DUPLICATE", "error",
            `措施 ${id} 同时归属阶段 ${owners.join("、")}，这些阶段及下游的累计结果可能重复计入，结论不可信。`,
            { measureIds: [id], phaseIds: owners }));
        } else if (records.length > 1) {
          invalidMeasures.add(id);
          const owner = owners[0];
          ownerInvalidity.set(owner, (ownerInvalidity.get(owner) || []).concat("MEASURE_DUPLICATE_ID"));
          this.issues.push(issue("MEASURE_DUPLICATE_ID", "error",
            `措施 ${id} 在阶段 ${owner} 下重复登记，可能重复计入，相关结论不可信。`,
            { measureIds: [id], phaseIds: [owner] }));
        }
      }

      this.invalidMeasures = invalidMeasures;
      this.measureOwnerIssues = ownerInvalidity;
      this.measuresByPhase = new Map(this.phaseIds.map((id) => [id, []]));
      for (const record of this.measures) {
        if (this.measuresByPhase.has(record.phaseId) && !invalidMeasures.has(record.id)) {
          this.measuresByPhase.get(record.phaseId).push(record);
        }
      }
    }

    _buildGraphAndTrust() {
      this.edges = new Map(this.phaseIds.map((id) => [id, []]));
      this.reverseEdges = new Map(this.phaseIds.map((id) => [id, []]));
      const invalidPhases = new Set();

      for (const id of this.phaseIds) {
        const phase = this.phaseMap.get(id);
        if (phase.structuralIssues.length) invalidPhases.add(id);
        if (this.measureOwnerIssues.get(id)?.length) invalidPhases.add(id);

        for (const prerequisiteId of phase.prerequisites) {
          if (!this.phaseMap.has(prerequisiteId)) {
            invalidPhases.add(id);
            this.issues.push(issue("PREREQUISITE_MISSING", "error",
              `阶段 ${phase.name} 的前置阶段 ${prerequisiteId} 不存在，累计链路不完整。`,
              { phaseIds: [id], prerequisiteIds: [prerequisiteId] }));
            continue;
          }
          this.edges.get(id).push(prerequisiteId);
          this.reverseEdges.get(prerequisiteId).push(id);
        }
      }

      for (const component of this._cycleComponents()) {
        for (const id of component) invalidPhases.add(id);
        this.issues.push(issue("PREREQUISITE_CYCLE", "error",
          `阶段 ${component.map((id) => this.phaseMap.get(id).name).join(" → ")} 构成前置闭环，无法确定累计顺序。`,
          { phaseIds: component }));
      }

      const queue = Array.from(invalidPhases);
      while (queue.length) {
        const id = queue.shift();
        for (const dependent of this.reverseEdges.get(id) || []) {
          if (!invalidPhases.has(dependent)) {
            invalidPhases.add(dependent);
            queue.push(dependent);
          }
        }
      }
      this.invalidPhases = invalidPhases;
      this.topologicalOrder = this._topologicalOrder(invalidPhases);
    }

    _cycleComponents() {
      const indexMap = new Map();
      const low = new Map();
      const stack = [];
      const onStack = new Set();
      const components = [];
      let nextIndex = 0;

      const visit = (id) => {
        indexMap.set(id, nextIndex);
        low.set(id, nextIndex);
        nextIndex += 1;
        stack.push(id);
        onStack.add(id);
        for (const prerequisite of this.edges.get(id) || []) {
          if (!indexMap.has(prerequisite)) {
            visit(prerequisite);
            low.set(id, Math.min(low.get(id), low.get(prerequisite)));
          } else if (onStack.has(prerequisite)) {
            low.set(id, Math.min(low.get(id), indexMap.get(prerequisite)));
          }
        }
        if (low.get(id) === indexMap.get(id)) {
          const component = [];
          let current;
          do {
            current = stack.pop();
            onStack.delete(current);
            component.push(current);
          } while (current !== id);
          if (component.length > 1 || this.edges.get(id).includes(id)) components.push(component);
        }
      };

      for (const id of this.phaseIds) {
        if (!indexMap.has(id)) visit(id);
      }
      return components;
    }

    _topologicalOrder(invalidPhases) {
      if ([...invalidPhases].some((id) => this.phaseMap.get(id)?.structuralIssues?.includes("PHASE_PERIOD_REVERSED"))) {
        return this.phaseIds.slice();
      }
      const indegree = new Map(this.phaseIds.map((id) => [id, 0]));
      for (const id of this.phaseIds) {
        for (const prerequisite of this.edges.get(id)) indegree.set(id, indegree.get(id) + 1);
      }
      const ready = this.phaseIds.filter((id) => indegree.get(id) === 0);
      const ordered = [];
      while (ready.length) {
        const id = ready.shift();
        ordered.push(id);
        for (const dependent of this.reverseEdges.get(id)) {
          indegree.set(dependent, indegree.get(dependent) - 1);
          if (indegree.get(dependent) === 0) ready.push(dependent);
        }
      }
      return ordered.length === this.phaseIds.length ? ordered : this.phaseIds.slice();
    }

    _evaluatePhase(phaseId, cutoffIndex) {
      const phase = this.phaseMap.get(phaseId);
      const lineage = this._lineage(phaseId);
      const sourceIds = lineage;
      const startIndex = this.periods.indexOf(phase.startPeriod);
      const endIndex = this.periods.indexOf(phase.endPeriod);
      let ownActual = 0;
      let ownPlanned = 0;
      const measureRows = [];

      for (const measure of this.measuresByPhase.get(phaseId) || []) {
        const isExcluded = this.excluded.has(measure.id);
        let periodActual = 0;
        const periodValues = {};
        if (startIndex >= 0 && endIndex >= 0) {
          const lastUsable = Math.min(cutoffIndex, endIndex);
          for (let index = startIndex; index <= lastUsable; index += 1) {
            const period = this.periods[index];
            if (Object.prototype.hasOwnProperty.call(measure.actuals, period)) {
              periodActual += Number(measure.actuals[period]);
              periodValues[period] = Number(measure.actuals[period]);
            }
          }
        }
        if (!isExcluded) ownPlanned += measure.planned;
        if (!isExcluded) ownActual += periodActual;
        measureRows.push({
          id: measure.id,
          name: measure.name,
          phaseId,
          planned: measure.planned,
          actual: periodActual,
          gapToPlan: periodActual - measure.planned,
          periodValues,
          excluded: isExcluded
        });
      }

      const sources = sourceIds.map((id) => this._sourceResult(id, cutoffIndex));
      const cumulativeActual = sources.reduce((sum, item) => sum + item.actual, 0);
      const cumulativeTarget = sources.reduce((sum, item) => sum + item.target, 0);
      const cumulativePlanned = sources.reduce((sum, item) => sum + item.planned, 0);
      const ownTarget = finite(phase.target) && phase.target >= 0 ? phase.target : 0;
      const ownGap = ownActual - ownTarget;
      const cumulativeGap = cumulativeActual - cumulativeTarget;
      const hasStarted = startIndex >= 0 && cutoffIndex >= startIndex;
      const isDue = endIndex >= 0 && cutoffIndex >= endIndex;
      const derivedStatus = !hasStarted ? "pending" : isDue
        ? (cumulativeGap >= 0 ? "achieved" : "behind")
        : (cumulativeGap >= 0 ? "on_track" : "at_risk");
      const lockedStatus = this.locks[phaseId] || null;
      const status = lockedStatus || derivedStatus;
      const trusted = !this.invalidPhases.has(phaseId);

      return {
        id: phaseId,
        name: phase.name,
        startPeriod: phase.startPeriod,
        endPeriod: phase.endPeriod,
        prerequisites: phase.prerequisites.slice(),
        lineage,
        ownTarget,
        ownActual,
        ownGap,
        ownPlanned,
        cumulativeTarget,
        cumulativeActual,
        cumulativeGap,
        cumulativePlanned,
        shortfall: Math.max(0, -cumulativeGap),
        progressPercent: cumulativeTarget > 0 ? Math.max(0, (cumulativeActual / cumulativeTarget) * 100) : null,
        planPercent: cumulativePlanned > 0 ? Math.max(0, (cumulativeActual / cumulativePlanned) * 100) : null,
        hasStarted,
        isDue,
        derivedStatus,
        status,
        locked: Boolean(lockedStatus),
        lockMismatch: Boolean(lockedStatus && lockedStatus !== derivedStatus),
        trusted,
        invalidReasons: this._invalidReasons(phaseId),
        deviationSources: sources,
        measures: measureRows
      };
    }

    _lineage(phaseId) {
      const seen = new Set();
      const visit = (id) => {
        if (seen.has(id) || !this.phaseMap.has(id)) return;
        seen.add(id);
        for (const prerequisite of this.edges.get(id) || []) visit(prerequisite);
      };
      visit(phaseId);
      return this.phaseIds.filter((id) => seen.has(id));
    }

    _sourceResult(phaseId, cutoffIndex) {
      const phase = this.phaseMap.get(phaseId);
      const startIndex = this.periods.indexOf(phase.startPeriod);
      const endIndex = this.periods.indexOf(phase.endPeriod);
      let actual = 0;
      let planned = 0;
      const measures = [];
      for (const measure of this.measuresByPhase.get(phaseId) || []) {
        const isExcluded = this.excluded.has(measure.id);
        let measureActual = 0;
        const periodValues = {};
        if (startIndex >= 0 && endIndex >= 0) {
          const lastUsable = Math.min(cutoffIndex, endIndex);
          for (let index = startIndex; index <= lastUsable; index += 1) {
            const period = this.periods[index];
            if (Object.prototype.hasOwnProperty.call(measure.actuals, period)) {
              const value = Number(measure.actuals[period]);
              measureActual += value;
              periodValues[period] = value;
            }
          }
        }
        if (!isExcluded) planned += measure.planned;
        if (!isExcluded) actual += measureActual;
        measures.push({
          id: measure.id,
          name: measure.name,
          planned: measure.planned,
          actual: measureActual,
          gap: measureActual - measure.planned,
          periodValues
        });
      }
      const target = finite(phase.target) && phase.target >= 0 ? phase.target : 0;
      return {
        phaseId,
        phaseName: phase.name,
        target,
        actual,
        planned,
        gapToTarget: actual - target,
        gapToPlan: actual - planned,
        measures
      };
    }

    _invalidReasons(phaseId) {
      if (!this.invalidPhases.has(phaseId)) return [];
      const direct = this.issues
        .filter((item) => item.severity === "error" && item.phaseIds && item.phaseIds.includes(phaseId))
        .map((item) => ({ code: item.code, message: item.message, basis: item.basis }));
      if (direct.length) return direct;
      const upstream = this._lineage(phaseId).filter((id) => id !== phaseId && this.invalidPhases.has(id));
      return upstream.map((id) => ({
        code: "UPSTREAM_UNTRUSTED",
        message: `前置阶段 ${this.phaseMap.get(id).name} 存在错误，本阶段累计结论不可信。`,
        basis: `不可信沿前置依赖从 ${id} 传播到 ${phaseId}。`
      }));
    }

    _summary(cache) {
      const phases = this.phaseIds.map((id) => cache.get(id));
      return {
        total: phases.length,
        trusted: phases.filter((item) => item.trusted).length,
        untrusted: phases.filter((item) => !item.trusted).length,
        achieved: phases.filter((item) => item.status === "achieved").length,
        behind: phases.filter((item) => item.status === "behind").length,
        onTrack: phases.filter((item) => item.status === "on_track").length,
        atRisk: phases.filter((item) => item.status === "at_risk").length,
        pending: phases.filter((item) => item.status === "pending").length,
        locked: phases.filter((item) => item.locked).length,
        totalTarget: phases.reduce((sum, item) => sum + item.ownTarget, 0),
        totalActual: phases.reduce((sum, item) => sum + item.ownActual, 0)
      };
    }
  }

  return { PlanEngine, issue };
});
