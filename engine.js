/*
 * Offline form-filling deduction engine.
 * No runtime dependencies; works in browsers and Node.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FormEngine = factory();
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const INPUTS = ["keyboard", "voice", "switch", "paste"];
  const SOURCE_LABELS = {
    keyboard: "键盘",
    voice: "语音",
    switch: "开关",
    paste: "粘贴",
    user: "用户裁决",
    system: "系统"
  };

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function makeId(prefix) {
    return prefix + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  }

  function issue(code, severity, message, eventIds, sources) {
    return { code, severity, message, eventIds: eventIds || [], sources: sources || [] };
  }

  function normalizeBoolean(raw) {
    if (typeof raw === "boolean") return { ok: true, value: raw, normalized: String(raw) };
    const text = String(raw ?? "").trim().toLowerCase();
    if (["true", "1", "on", "yes", "y", "是", "开"].includes(text)) return { ok: true, value: true, normalized: "true" };
    if (["false", "0", "off", "no", "n", "否", "关"].includes(text)) return { ok: true, value: false, normalized: "false" };
    return { ok: false, reason: "boolean", normalized: text };
  }

  function normalizeInput(field, raw) {
    if (field.type === "boolean") return normalizeBoolean(raw);
    if (field.type === "number") {
    const text = String(raw ?? "").trim();
      const value = Number(text);
      if (text !== "" && Number.isFinite(value)) return { ok: true, value, normalized: text };
      return { ok: false, reason: "number", normalized: text };
    }
    const normalized = String(raw ?? "").trim();
    return { ok: true, value: normalized, normalized };
  }

  function schemaProblems(field) {
    const problems = [];
    if (!field || !field.id) problems.push("字段缺少 id");
    asArray(field.dependencies).forEach((id) => {
      if (typeof id !== "string" || !id) problems.push("存在空的依赖标识");
    });
    if (field.pattern) {
      try { new RegExp(field.pattern); } catch (error) {
        problems.push("格式正则无效：" + error.message);
      }
    }
    return problems;
  }

  function validateValue(field, value, normalized) {
    if (field.type === "boolean") {
      return typeof value === "boolean" ? null : "必须是开/关值";
    }
    if (field.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) return "必须是数字";
      if (field.min !== undefined && value < Number(field.min)) return `不能小于 ${field.min}`;
      if (field.max !== undefined && value > Number(field.max)) return `不能大于 ${field.max}`;
      if (field.integer && !Number.isInteger(value)) return "必须是整数";
      return null;
    }
    const text = String(normalized ?? value ?? "");
    if (field.minLength !== undefined && text.length < Number(field.minLength)) return `至少需要 ${field.minLength} 个字符`;
    if (field.maxLength !== undefined && text.length > Number(field.maxLength)) return `最多允许 ${field.maxLength} 个字符`;
    if (Array.isArray(field.options) && field.options.length && !field.options.some((o) => String(o.value) === text)) {
      return "不在允许选项内";
    }
    if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return "邮箱格式不正确";
    if (field.pattern) {
      let regexp;
      try { regexp = new RegExp(field.pattern); } catch (error) { return "字段格式规则无效"; }
      if (!regexp.test(text)) return field.patternMessage || "不符合字段格式要求";
    }
    return null;
  }

  function sourceName(source) {
    return SOURCE_LABELS[source] || source || "未知来源";
  }

  function normalizeEvent(event) {
    return {
      id: event.id || makeId("evt"),
      fieldId: String(event.fieldId),
      source: String(event.source),
      sequence: Number.isFinite(Number(event.sequence)) ? Number(event.sequence) : Date.now(),
      raw: event.raw,
      action: event.action === "clear" ? "clear" : "input",
      basis: event.basis || (event.action === "clear" ? "清空输入" : `来自${sourceName(event.source)}的原始内容`)
    };
  }

  function summarize(field, event) {
    const parsed = normalizeInput(field, event.raw);
    const accepted = asArray(field.acceptedInputs).includes(event.source);
    const supported = INPUTS.includes(event.source) && accepted;
    let kind = "valid";
    let error = null;
    if (event.action === "clear") {
      kind = "clear";
    } else if (!INPUTS.includes(event.source)) {
      kind = "invalid";
      error = `未知输入方式“${event.source}”`;
    } else if (field.clientCapabilities && field.clientCapabilities[event.source] === false) {
      kind = "unavailable";
      error = `${sourceName(event.source)}输入能力当前不可用`;
    } else if (!accepted) {
      kind = "unsupported";
      error = `${sourceName(event.source)}不是该字段可接受的输入方式`;
    } else if (!parsed.ok) {
      kind = "invalid";
      error = parsed.reason === "boolean" ? "无法识别为开/关值" : "无法识别为数字";
    } else {
      error = validateValue(field, parsed.value, parsed.normalized);
      if (error) kind = "invalid";
    }
    return {
      id: event.id,
      fieldId: event.fieldId,
      source: event.source,
      sequence: event.sequence,
      raw: event.raw,
      action: event.action,
      basis: event.basis,
      kind,
      value: parsed.ok ? parsed.value : null,
      normalized: parsed.ok ? parsed.normalized : String(event.raw ?? ""),
      error,
      trusted: !["unsupported", "unavailable"].includes(kind)
    };
  }

  function activeReduction(field, events) {
    const sorted = events.slice().sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
    const active = [];
    sorted.forEach((event) => {
      const item = summarize(field, event);
      if (item.kind === "clear") active.length = 0;
      active.push(item);
    });

    const candidates = active.filter((item) => item.kind === "valid");
    const valueGroups = new Map();
    candidates.forEach((item) => {
      const key = String(item.normalized);
      if (!valueGroups.has(key)) valueGroups.set(key, []);
      valueGroups.get(key).push(item);
    });
    const contradictory = valueGroups.size > 1;
    const invalid = active.filter((item) => item.kind === "invalid");
    const unsupported = active.filter((item) => ["unsupported", "unavailable"].includes(item.kind));
    const clearEvents = active.filter((item) => item.kind === "clear");
    return {
      sorted,
      active,
      candidates,
      valueGroups: Array.from(valueGroups.values()),
      contradictory,
      invalid,
      unsupported,
      clearEvents,
      hasContent: active.length > 0
    };
  }

  function validDecision(field, reduction, decision) {
    if (!decision || decision.fieldId !== field.id) return null;
    const newest = reduction.sorted[reduction.sorted.length - 1];
    if (newest && Number(decision.at) < newest.sequence) return null;
    if (decision.mode === "event") {
      const selected = reduction.candidates.find((item) => item.id === decision.selectedEventId);
      if (!selected) return null;
      return { ...decision, selected, value: selected.value, normalized: selected.normalized };
    }
    if (decision.mode === "custom") {
      const parsed = normalizeInput(field, decision.raw);
      if (!parsed.ok) return { ...decision, invalid: parsed.reason === "boolean" ? "必须是开/关值" : "必须是数字" };
      const error = validateValue(field, parsed.value, parsed.normalized);
      return { ...decision, value: parsed.value, normalized: parsed.normalized, error };
    }
    if (decision.mode === "ignore") return decision;
    return null;
  }

  function localFieldState(field, rawEvents, decisionInput) {
    const schemaErrors = schemaProblems(field);
    const reduction = activeReduction(field, rawEvents);
    const decision = validDecision(field, reduction, decisionInput);
    const issues = [];
    const evidence = {
      events: reduction.sorted,
      active: reduction.active,
      candidates: reduction.candidates,
      rejectedEvents: [],
      ignoredEventIds: [...(decision?.ignoredEventIds || [])]
    };
    let value = null;
    let source = null;
    let status = "empty";
    let trusted = schemaErrors.length === 0;

    schemaErrors.forEach((message) => issues.push(issue("schema", "error", message, [], [])));
    if (schemaErrors.length) status = "misconfigured";

    const ignored = new Set(evidence.ignoredEventIds);
    const latestErrorIndex = Math.max(
      reduction.active.findLastIndex((e) => e.kind === "invalid"),
      reduction.active.findLastIndex((e) => ["unsupported", "unavailable"].includes(e.kind))
    );
    const latestError = latestErrorIndex >= 0 ? reduction.active[latestErrorIndex] : null;
    const stillActiveError = latestError && (!reduction.clearEvents.length || latestErrorIndex > reduction.active.findLastIndex((e) => e.kind === "clear"));
    const relevantInvalid = stillActiveError && latestError.kind === "invalid" && !ignored.has(latestError.id) ? [latestError] : [];
    const relevantUnsupported = stillActiveError && ["unsupported", "unavailable"].includes(latestError.kind) && !ignored.has(latestError.id) ? [latestError] : [];

    if (decision?.mode === "event" && !decision.invalid) {
      value = decision.value;
      source = decision.selected.source;
      status = "ready";
      reduction.candidates.forEach((item) => {
        if (item.normalized !== decision.normalized) evidence.rejectedEvents.push(item.id);
      });
    } else if (decision?.mode === "custom") {
      value = decision.invalid ? null : decision.value;
      source = "user";
      if (decision.invalid) {
        status = "invalid";
        trusted = false;
        issues.push(issue("decision_invalid", "error", decision.invalid, [], ["user"]));
      } else if (decision.error) {
        status = "invalid";
        issues.push(issue("decision_invalid", "error", decision.error, [], ["user"]));
      } else status = "ready";
    } else if (reduction.contradictory) {
      const ids = [];
      const sources = new Set();
      reduction.valueGroups.forEach((group) => group.forEach((item) => { ids.push(item.id); sources.add(item.source); }));
      issues.push(issue("conflict", "error", "多个有效输入给出了互相矛盾的值，需要用户裁决", ids, [...sources]));
      status = "conflict";
      trusted = false;
    } else if (relevantUnsupported.length) {
      const item = relevantUnsupported[relevantUnsupported.length - 1];
      issues.push(issue(item.kind === "unavailable" ? "input_unavailable" : "unsupported_input", "error", item.error, [item.id], [item.source]));
      status = item.kind === "unavailable" ? "unavailable" : "unsupported";
      trusted = false;
      if (reduction.candidates.length === 1) value = reduction.candidates[0].value;
    } else if (relevantInvalid.length) {
      const item = relevantInvalid[relevantInvalid.length - 1];
      issues.push(issue("invalid_input", "error", item.error, [item.id], [item.source]));
      status = "invalid";
      trusted = false;
      if (reduction.candidates.length === 1) value = reduction.candidates[0].value;
    } else if (reduction.candidates.length && !schemaErrors.length) {
      const group = reduction.valueGroups[0];
      value = group[group.length - 1].value;
      source = group[group.length - 1].source;
      status = "ready";
    } else if (reduction.hasContent) {
      status = "empty";
    }

    if (decision?.mode === "ignore") {
      issues = issues.filter((x) => !["invalid_input", "unsupported_input", "input_unavailable"].includes(x.code));
      if (reduction.candidates.length === 1) {
        value = reduction.candidates[0].value;
        source = reduction.candidates[reduction.candidates.length - 1].source;
      }
      if (reduction.contradictory) status = "conflict";
      else status = value === null ? "empty" : "ready";
      const unsupportedIgnored = reduction.unsupported.some((e) => ignored.has(e.id));
      if (unsupportedIgnored) {
        trusted = false;
        issues.push(issue("ignored_unsupported_input", "warning", "已忽略不支持/不可用输入；该结论仍按不可信处理", [...ignored], ["system"]));
      }
    }

    return { field, value, source, status, trusted, issues, evidence, decision: decision || null, staleDecision: decisionInput && !decision ? decisionInput : null };
  }

  function fieldMap(fields) {
    const map = new Map();
    asArray(fields).forEach((field) => {
      if (field && field.id !== undefined) map.set(String(field.id), normalizeField(field));
    });
    return map;
  }

  function normalizeField(field) {
    return {
      id: String(field.id),
      label: field.label || field.name || String(field.id),
      type: field.type || "text",
      required: field.required !== false,
      dependencies: asArray(field.dependencies).map(String),
      acceptedInputs: asArray(field.acceptedInputs).length ? asArray(field.acceptedInputs) : INPUTS.slice(),
      pattern: field.pattern,
      patternMessage: field.patternMessage,
      min: field.min,
      max: field.max,
      integer: field.integer,
      minLength: field.minLength,
      maxLength: field.maxLength,
      options: field.options,
      description: field.description || ""
    };
  }

  function findCycleFields(fieldsById) {
    const cycles = new Set();
    let nextIndex = 0;
    const indices = new Map();
    const low = new Map();
    const stack = [];
    const onStack = new Set();

    function strongConnect(id) {
      indices.set(id, nextIndex);
      low.set(id, nextIndex);
      nextIndex += 1;
      stack.push(id);
      onStack.add(id);

      const field = fieldsById.get(id);
      asArray(field?.dependencies).forEach((dep) => {
        if (!fieldsById.has(dep)) return;
        if (!indices.has(dep)) {
          strongConnect(dep);
          low.set(id, Math.min(low.get(id), low.get(dep)));
        } else if (onStack.has(dep)) {
          low.set(id, Math.min(low.get(id), indices.get(dep)));
        }
      });

      if (low.get(id) === indices.get(id)) {
        const component = [];
        let current;
        do {
          current = stack.pop();
          onStack.delete(current);
          component.push(current);
        } while (current !== id);
        const selfCycle = fieldsById.get(id).dependencies.includes(id);
        if (component.length > 1 || selfCycle) component.forEach((node) => cycles.add(node));
      }
    }

    fieldsById.forEach((_, id) => {
      if (!indices.has(id)) strongConnect(id);
    });
    return cycles;
  }

  function downstream(ids, fieldsById) {
    const dependents = new Map();
    fieldsById.forEach((field, id) => {
      field.dependencies.forEach((dep) => {
        if (!dependents.has(dep)) dependents.set(dep, new Set());
        dependents.get(dep).add(id);
      });
    });
    const result = new Set(ids.map(String));
    const queue = [...result];
    while (queue.length) {
      const id = queue.shift();
      (dependents.get(id) || []).forEach((next) => {
        if (!result.has(next)) { result.add(next); queue.push(next); }
      });
    }
    return result;
  }

  function topoOrder(fieldsById, affected) {
    const order = [];
    const visited = new Set();
    const visiting = new Set();
    function visit(id) {
      if (visited.has(id) || !fieldsById.has(id)) return;
      if (visiting.has(id)) return;
      visiting.add(id);
      fieldsById.get(id).dependencies.forEach(visit);
      visiting.delete(id);
      visited.add(id);
      if (!affected || affected.has(id)) order.push(id);
    }
    fieldsById.forEach((_, id) => visit(id));
    return order;
  }

  function formatValue(field, value) {
    if (value === null || value === undefined) return "";
    if (field.type === "boolean") return value ? "开" : "关";
    return String(value);
  }

  class FormDeduction {
    constructor(config = {}) {
      this.fields = asArray(config.fields).map(normalizeField);
      this.events = asArray(config.events).map(normalizeEvent);
      this.decisions = clone(config.decisions) || {};
      this.capabilities = INPUTS.reduce((acc, input) => {
        acc[input] = config.capabilities?.[input] !== false;
        return acc;
      }, {});
      this.sequence = Number(config.sequence) || Math.max(0, ...this.events.map((e) => e.sequence), 0);
      this.results = new Map();
      this.cycleFields = new Set();
      this.recompute();
    }

    getState() {
      return {
        fields: clone(this.fields), events: clone(this.events),
        decisions: clone(this.decisions), capabilities: clone(this.capabilities), sequence: this.sequence,
        results: Object.fromEntries(this.results)
      };
    }

    getField(id) { return this.fields.find((field) => field.id === String(id)); }
    getResult(id) { return this.results.get(String(id)); }
    nextSequence() { this.sequence += 1; return this.sequence; }

    addEvent(input) {
      const fieldId = String(input.fieldId);
      if (!this.getField(fieldId)) throw new Error(`未知字段：${fieldId}`);
      this.sequence += 1;
      const event = normalizeEvent({
        id: input.id || makeId("evt"), fieldId, source: input.source,
        raw: input.raw, action: input.action,
        sequence: input.sequence ?? this.sequence, basis: input.basis
      });
      this.events.push(event);
      this.recompute(downstream([fieldId], fieldMap(this.fields)));
      return clone(event);
    }

    removeEvent(eventId) {
      const event = this.events.find((item) => item.id === eventId);
      if (!event) return null;
      this.events = this.events.filter((item) => item.id !== eventId);
      this.recompute(downstream([event.fieldId], fieldMap(this.fields)));
      return clone(event);
    }

    adjudicate(fieldId, decision) {
      const id = String(fieldId);
      if (!this.getField(id)) throw new Error(`未知字段：${id}`);
      const at = decision.at ?? this.sequence + 1;
      this.decisions[id] = {
        fieldId: id, mode: decision.mode,
        at,
        reason: decision.reason || "用户裁决",
        selectedEventId: decision.selectedEventId,
        raw: decision.raw, ignoredEventIds: asArray(decision.ignoredEventIds)
      };
      this.sequence = Math.max(this.sequence, Number(at));
      this.recompute(downstream([id], fieldMap(this.fields)));
      return clone(this.decisions[id]);
    }

    clearDecision(fieldId) {
      const id = String(fieldId);
      if (this.decisions[id]) {
        delete this.decisions[id];
        this.recompute(downstream([id], fieldMap(this.fields)));
      }
    }

    updateField(fieldId, patch) {
      const id = String(fieldId);
      const index = this.fields.findIndex((field) => field.id === id);
      if (index < 0) throw new Error(`未知字段：${id}`);
      const oldDeps = this.fields[index].dependencies;
      const oldAffected = downstream([id], fieldMap(this.fields));
      const next = normalizeField({ ...this.fields[index], ...patch, id });
      this.fields[index] = next;
      const newAffected = downstream([id, ...next.dependencies], fieldMap(this.fields));
      const affected = new Set([...oldAffected, ...newAffected]);
      this.recompute(affected);
      return clone(next);
    }

    addField(field) {
      const next = normalizeField(field);
      if (this.getField(next.id)) throw new Error(`字段已存在：${next.id}`);
      this.fields.push(next);
      this.recompute(downstream([next.id, ...next.dependencies], fieldMap(this.fields)));
      return clone(next);
    }

    setCapability(input, enabled) {
      if (!INPUTS.includes(input)) throw new Error(`未知输入能力：${input}`);
      this.capabilities[input] = Boolean(enabled);
      this.recompute();
    }

    recompute(affectedInput) {
      const fieldsById = fieldMap(this.fields);
      this.fields = [...fieldsById.values()];
      this.cycleFields = findCycleFields(fieldsById);
      const affected = affectedInput || new Set(fieldsById.keys());
      topoOrder(fieldsById, affected).forEach((id) => this.evaluate(id, fieldsById));
      return this.getState();
    }

    evaluate(id, fieldsById) {
      const field = { ...fieldsById.get(id), clientCapabilities: this.capabilities };
      const rawEvents = this.events.filter((event) => event.fieldId === id);
      const result = localFieldState(field, rawEvents, this.decisions[id]);
      result.canConfirm = false;
      result.blockedBy = [];
      result.dependencyIssues = [];

      if (this.cycleFields.has(id)) {
        result.trusted = false;
        result.status = "cycle";
        result.dependencyIssues.push(issue("dependency_cycle", "error", "字段位于依赖环中，结论不可信", [], ["system"]));
      }
      field.dependencies.forEach((dep) => this.evaluateDependency(dep, field, result, fieldsById));

      const missingDep = result.dependencyIssues.some((x) => x.code === "missing_dependency");
      if (field.required && result.value === null && !["cycle", "misconfigured", "blocked"].includes(result.status) && !missingDep) {
        result.issues.push(issue("required", "error", "必填字段尚无有效结论", [], []));
        if (["empty", "ready"].includes(result.status)) result.status = "required";
      }
      const hasError = [...result.issues, ...result.dependencyIssues].some((item) => item.severity === "error");
      const settled = result.status === "ready" || (!field.required && result.status === "empty");
      result.canConfirm = result.trusted && settled && !hasError;
      result.displayValue = formatValue(field, result.value);
      result.rawAttempts = result.evidence.active.map((event) => ({
        id: event.id, source: event.source, raw: event.raw,
        normalized: event.normalized, kind: event.kind,
        error: event.error, basis: event.basis, sequence: event.sequence
      }));
      this.results.set(id, result);
    }

    evaluateDependency(dep, field, result, fieldsById) {
      if (!fieldsById.has(dep)) {
        result.trusted = false;
        if (result.status !== "cycle") result.status = "blocked";
        result.blockedBy.push({ fieldId: dep, reason: "missing_definition" });
        result.dependencyIssues.push(issue("missing_dependency", "error", `前置字段“${dep}”缺失`, [], ["system"]));
        return;
      }
      const prerequisite = this.results.get(dep);
      if (!prerequisite) return;
      if (!prerequisite.canConfirm) {
        result.trusted = false;
        if (result.status !== "cycle") result.status = "blocked";
        result.blockedBy.push({ fieldId: dep, reason: prerequisite.status });
        result.dependencyIssues.push(issue("blocked_dependency", "warning", `等待前置字段“${prerequisite.field.label}”可确认`, [], [dep]));
      } else if (!prerequisite.trusted) {
        result.trusted = false;
        result.dependencyIssues.push(issue("untrusted_dependency", "warning", `前置字段“${prerequisite.field.label}”的结论不可信`, [], [dep]));
      }
    }
  }

  function createDemo() {
    return new FormDeduction({
      fields: [
        { id: "consent", label: "营销授权", type: "boolean", required: true, acceptedInputs: ["switch", "voice"] },
        { id: "email", label: "联系邮箱", type: "email", required: true, dependencies: ["consent"], acceptedInputs: ["keyboard", "voice", "paste"] },
        { id: "age", label: "年龄", type: "number", required: true, integer: true, min: 18, max: 120, dependencies: ["consent"], acceptedInputs: ["keyboard", "voice"] },
        { id: "channel", label: "通知渠道", type: "text", required: false, dependencies: ["email"], options: [{value:"sms",label:"短信"},{value:"email",label:"邮件"}], acceptedInputs: ["keyboard", "voice"] }
      ],
      events: [
        { id: "e1", fieldId: "consent", source: "switch", raw: "true", sequence: 1, basis: "实体开关拨到开启" },
        { id: "e2", fieldId: "email", source: "keyboard", raw: "demo@example.com", sequence: 2, basis: "键盘输入框当前文本" },
        { id: "e3", fieldId: "email", source: "voice", raw: "demo@示例.com", sequence: 3, basis: "语音识别候选文本" },
        { id: "e4", fieldId: "age", source: "voice", raw: "二十八", sequence: 4, basis: "语音识别未数字化" }
      ]
    });
  }

  return {
    FormDeduction,
    createDemo,
    INPUTS,
    SOURCE_LABELS,
    sourceName,
    normalizeInput,
    validateValue,
    normalizeField,
    normalizeEvent,
    localFieldState
  };
});
