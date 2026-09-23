(function () {
  "use strict";
  const E = window.FormEngine;
  const STORE_KEY = "offline-form-deduction-v1";
  const STATUS_LABELS = {
    ready: "可确认", required: "必填待填", empty: "可为空，未填写",
    conflict: "待用户裁决", invalid: "格式错误", unsupported: "字段不接受该方式", unavailable: "输入能力不可用",
    blocked: "依赖阻塞", cycle: "依赖成环", misconfigured: "配置错误"
  };
  const $ = (id) => document.getElementById(id);
  let engine = loadEngine();
  let editingDependencies = null;

  function loadEngine() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (saved && saved.fields) return new E.FormDeduction(saved);
    } catch (error) { console.warn("本地数据无法读取，已载入演示数据", error); }
    return E.createDemo();
  }

  function persist() {
    localStorage.setItem(STORE_KEY, JSON.stringify(engine.getState()));
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }

  function sourceLabel(source) { return E.sourceName(source); }
  function statusLabel(status) { return STATUS_LABELS[status] || status; }

  function selectedField() {
    return engine.getField($("eventField").value);
  }

  function render() {
    const state = engine.getState();
    renderEventOptions(state);
    renderCapabilities(state);
    renderSummary(state);
    renderFields(state);
    renderFieldChecks();
  }

  function renderEventOptions(state) {
    const current = $("eventField").value;
    $("eventField").innerHTML = state.fields.map((field) =>
      `<option value="${esc(field.id)}">${esc(field.label)} (${esc(field.id)})</option>`
    ).join("");
    if (state.fields.some((f) => f.id === current)) $("eventField").value = current;
    const field = selectedField();
    const source = $("eventSource").value;
    $("eventSource").innerHTML = E.INPUTS.map((input) => {
      const accepted = field?.acceptedInputs.includes(input);
      const enabled = state.capabilities[input];
      const suffix = !accepted ? "（字段不接受）" : !enabled ? "（能力关闭）" : "";
      return `<option value="${input}">${sourceLabel(input)}${suffix}</option>`;
    }).join("");
    $("eventSource").value = source;
    if (field?.type === "boolean") $("eventRaw").placeholder = "true / false / 开 / 关";
    else if (field?.type === "number") $("eventRaw").placeholder = "请输入数字";
    else $("eventRaw").placeholder = "请输入原始内容";
  }

  function renderSummary(state) {
    const results = Object.values(state.results);
    const metrics = [
      ["可确认", results.filter((r) => r.canConfirm).length, "#166534"],
      ["待裁决", results.filter((r) => r.status === "conflict").length, "#9a3412"],
      ["错误", results.filter((r) => [...r.issues, ...r.dependencyIssues].some((i) => i.severity === "error")).length, "#991b1b"],
      ["阻塞", results.filter((r) => r.status === "blocked").length, "#854d0e"],
      ["不可信", results.filter((r) => !r.trusted).length, "#92400e"]
    ];
    $("summaryCards").innerHTML = metrics.map(([label, value, color]) =>
      `<div class="metric"><strong style="color:${color}">${value}</strong><span>${label}</span></div>`
    ).join("");
  }

  function renderCapabilities(state) {
    $("capabilityToggles").innerHTML = E.INPUTS.map((input) =>
      `<label><input type="checkbox" data-capability="${input}" ${state.capabilities[input] ? "checked" : ""}>${sourceLabel(input)}</label>`
    ).join("");
  }

  function renderFields(state) {
    $("fieldList").innerHTML = state.fields.map((field) => renderCard(field, state.results[field.id], state)).join("");
  }

  function renderCard(field, result) {
    if (!result) return "";
    const allIssues = [...result.dependencyIssues, ...result.issues];
    const statusClass = result.canConfirm ? "ready" : result.status;
    const required = field.required ? "必填" : "可选";
    const deps = field.dependencies.length ? field.dependencies.join(", ") : "无";
    const inputs = field.acceptedInputs.map(sourceLabel).join("、");
    return `<article class="field-card ${result.trusted ? "" : "untrusted"}">
      <div class="field-head">
        <div><h3>${esc(field.label)}</h3><div class="meta">${esc(field.id)} · ${required} · 依赖：${esc(deps)} · 接受：${esc(inputs)}</div></div>
        <span class="badge ${statusClass}">${statusLabel(result.status)}${result.canConfirm ? " ✓" : ""}</span>
      </div>
      <div class="field-body">
        <div class="value-line"><span>当前值：</span><code>${result.value === null ? "∅" : esc(result.displayValue)}</code><span class="evidence-tag">${result.trusted ? "可信结论" : "不可信结论"} · 来源：${result.source ? esc(sourceLabel(result.source)) : "无"}</span></div>
        ${renderIssues(allIssues)}
        ${renderDecision(result)}
        ${renderAttempts(result)}
        <div class="card-actions">
          <button type="button" class="ghost" data-action="dependencies" data-field="${esc(field.id)}">调整依赖</button>
          <button type="button" class="ghost" data-action="clear-decision" data-field="${esc(field.id)}" ${result.decision || result.staleDecision ? "" : "disabled"}>撤销裁决</button>
        </div>
      </div>
    </article>`;
  }

  function renderIssues(issues) {
    if (!issues.length) return `<div class="dependency-note">无字段错误或依赖警告。</div>`;
    return `<ul class="issue-list">${issues.map((item) => {
      const where = item.eventIds.length ? `｜事件 ${item.eventIds.map(esc).join(", ")}` : "";
      const source = item.sources.length ? `｜来源 ${item.sources.map(sourceLabel).map(esc).join("、")}` : "";
      return `<li>${esc(item.message)}${where}${source}</li>`;
    }).join("")}</ul>`;
  }

  function kindLabel(kind) {
    return { valid: "有效", invalid: "格式失败", unsupported: "字段不接受", unavailable: "能力不可用", clear: "清空" }[kind] || kind;
  }

  function renderAttempts(result) {
    if (!result.rawAttempts.length) return `<div class="attempts"><div class="basis">尚未收到事件。</div></div>`;
    const selectedId = result.decision?.selectedEventId;
    const rejected = new Set(result.evidence.rejectedEvents || []);
    return `<div class="attempts">
      ${result.rawAttempts.map((event) => `
        <div class="attempt ${event.kind}">
          <div class="attempt-head">
            <span>#${event.sequence} · ${esc(sourceLabel(event.source))} · ${kindLabel(event.kind)}${selectedId === event.id ? " · 已采信" : ""}${rejected.has(event.id) ? " · 已驳回" : ""}</span>
            <button type="button" class="ghost" data-action="remove-event" data-event="${esc(event.id)}">移除</button>
          </div>
          <div>原始内容：<code>${event.action === "clear" ? "（清空）" : esc(event.raw)}</code> ${event.error ? `<strong>— ${esc(event.error)}</strong>` : ""}</div>
          <div class="basis">依据：${esc(event.basis || "未说明")}</div>
          ${event.kind !== "valid" && event.kind !== "clear" ? `<button type="button" class="secondary" data-action="ignore-event" data-field="${esc(result.field.id)}" data-event="${esc(event.id)}">忽略此异常并继续</button>` : ""}
        </div>`).join("")}
    </div>`;
  }

  function renderDecision(result) {
    const candidates = result.evidence.candidates || [];
    const values = [...new Set(candidates.map((c) => c.normalized))];
    if (result.staleDecision) {
      return `<div class="decision-box"><strong>旧裁决已失效</strong><span class="basis">裁决之后又收到事件，需要重新裁决；旧理由：${esc(result.staleDecision.reason)}</span></div>`;
    }
    if (result.decision) return `<div class="decision-box"><strong>用户裁决生效</strong><span class="basis">${esc(result.decision.reason)}</span></div>`;
    if (result.status !== "conflict" || values.length < 2) return "";
    const groups = values.map((value) => candidates.filter((c) => c.normalized === value));
    return `<div class="decision-box">
      <strong>矛盾内容均保留，请选择结论</strong>
      ${groups.map((group) => {
        const item = group[group.length - 1];
        const evidence = group.map((x) => `#${x.sequence} ${sourceLabel(x.source)}`).join("、");
        return `<div class="decision-row"><button type="button" class="primary" data-action="choose-event" data-field="${esc(result.field.id)}" data-event="${esc(item.id)}">采信“${esc(item.normalized)}”</button><span class="basis">证据：${esc(evidence)}</span></div>`;
      }).join("")}
      <div class="decision-row"><input data-custom="${esc(result.field.id)}" placeholder="也可输入用户修正值"><button type="button" class="secondary" data-action="custom-value" data-field="${esc(result.field.id)}">使用修正值</button></div>
    </div>`;
  }

  function renderFieldChecks() {
    $("newFieldInputs").innerHTML = E.INPUTS.map((input) =>
      `<label><input type="checkbox" value="${input}" checked>${sourceLabel(input)}</label>`
    ).join("");
  }

  function chosenInputs() {
    return [...document.querySelectorAll("#newFieldInputs input:checked")].map((input) => input.value);
  }

  function commit() { persist(); render(); }

  $("eventForm").addEventListener("submit", (event) => {
    event.preventDefault();
    engine.addEvent({
      fieldId: $("eventField").value,
      source: $("eventSource").value,
      raw: $("eventRaw").value,
      basis: $("eventBasis").value
    });
    $("eventRaw").value = "";
    $("eventBasis").value = "";
    commit();
  });

  $("clearEvent").addEventListener("click", () => {
    engine.addEvent({
      fieldId: $("eventField").value,
      source: $("eventSource").value,
      action: "clear", raw: "",
      basis: "用户/客户端清空字段"
    });
    commit();
  });

  $("fieldForm").addEventListener("submit", (event) => {
    event.preventDefault();
    engine.addField({
      id: $("newFieldId").value.trim(),
      label: $("newFieldLabel").value.trim(),
      type: $("newFieldType").value,
      pattern: $("newFieldPattern").value.trim() || undefined,
      acceptedInputs: chosenInputs(),
      required: true
    });
    event.target.reset();
    renderFieldChecks();
    commit();
  });

  $("resetDemo").addEventListener("click", () => { engine = E.createDemo(); commit(); });
  $("clearAll").addEventListener("click", () => {
    localStorage.removeItem(STORE_KEY);
    engine = new E.FormDeduction({ fields: engine.getState().fields });
    render();
  });

  $("capabilityToggles").addEventListener("change", (event) => {
    const input = event.target.dataset.capability;
    if (input) {
      engine.setCapability(input, event.target.checked);
      commit();
    }
  });

  $("fieldList").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const fieldId = button.dataset.field;
    if (action === "remove-event") {
      engine.removeEvent(button.dataset.event);
      commit();
    } else if (action === "choose-event") {
      engine.adjudicate(fieldId, { mode: "event", selectedEventId: button.dataset.event, reason: "用户选择保留该来源值" });
      commit();
    } else if (action === "custom-value") {
      const input = document.querySelector(`[data-custom="${CSS.escape(fieldId)}"]`);
      engine.adjudicate(fieldId, { mode: "custom", raw: input.value, reason: "用户人工修正" });
      commit();
    } else if (action === "ignore-event") {
      engine.adjudicate(fieldId, { mode: "ignore", ignoredEventIds: [button.dataset.event], reason: "用户忽略该异常输入" });
      commit();
    } else if (action === "clear-decision") {
      engine.clearDecision(fieldId);
      commit();
    } else if (action === "dependencies") {
      openDependencies(fieldId);
    }
  });

  function openDependencies(fieldId) {
    const field = engine.getField(fieldId);
    editingDependencies = fieldId;
    $("dependencyFieldName").textContent = `${field.label} (${field.id})`;
    $("dependencyOptions").innerHTML = engine.getState().fields
      .filter((item) => item.id !== fieldId)
      .map((item) => `<label><input type="checkbox" value="${esc(item.id)}" ${field.dependencies.includes(item.id) ? "checked" : ""}>${esc(item.label)} (${esc(item.id)})</label>`)
      .join("");
    $("dependencyDialog").showModal();
  }

  $("dependencyForm").addEventListener("submit", (event) => {
    if (event.submitter && event.submitter.value === "cancel") return;
    event.preventDefault();
    const dependencies = [...document.querySelectorAll("#dependencyOptions input:checked")].map((input) => input.value);
    engine.updateField(editingDependencies, { dependencies });
    $("dependencyDialog").close();
    commit();
  });

  render();
})();
