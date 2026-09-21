(function startApp() {
  const engine = window.HandoffEngine;
  const storageKey = "offline-handoff-inference:v1";
  const STATUS_LABELS = {
    ready: "可完成",
    incomplete: "不完整",
    untrusted: "不可信",
    blocked: "等待裁决",
  };
  const FILTERS = [
    { id: "all", label: "全部" },
    { id: "blocked", label: "等待裁决" },
    { id: "untrusted", label: "不可信" },
    { id: "incomplete", label: "不完整" },
    { id: "ready", label: "可完成" },
  ];

  let model = window.DEMO_MODEL;
  let state = loadState();
  let evaluation = engine.recomputeChain(model, state, [], null);
  let activeFilter = "all";
  let lastOperation = "初始完整推演";

  const elements = {
    stats: document.getElementById("stats"),
    clock: document.getElementById("evaluationClock"),
    filters: document.getElementById("filters"),
    list: document.getElementById("handoffList"),
    conflicts: document.getElementById("conflictStack"),
    recompute: document.getElementById("recomputeInfo"),
    backdrop: document.getElementById("editorBackdrop"),
    form: document.getElementById("contextForm"),
    contextId: document.getElementById("contextId"),
    value: document.getElementById("contextValue"),
    source: document.getElementById("contextSource"),
    validUntil: document.getElementById("contextValidUntil"),
    active: document.getElementById("contextActive"),
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : engine.createAnalysisState();
    } catch (error) {
      return engine.createAnalysisState();
    }
  }

  function persistState() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch (error) {
      console.warn("无法写入本地存储：", error);
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[char]));
  }

  function percent(value) {
    return `${Math.round((Number(value) || 0) * 100)}%`;
  }

  function findHandoff(id) {
    return model.handoffs.find((item) => item.id === id);
  }

  function findContext(id) {
    return evaluation.result.contexts.find((item) => item.id === id) ||
      model.contexts.find((item) => item.id === id);
  }

  function conflictKeysFor(handoffId) {
    return new Set(evaluation.result.conflicts
      .filter((conflict) => conflict.handoffId === handoffId)
      .map((conflict) => conflict.key));
  }

  function rerun(seeds, operation) {
    const next = engine.recomputeChain(model, state, seeds, evaluation.result, model.now);
    evaluation = next;
    lastOperation = operation;
    persistState();
    render();
  }

  document.getElementById("resetDemo").addEventListener("click", () => {
    model = window.DEMO_MODEL;
    state = engine.createAnalysisState();
    evaluation = engine.recomputeChain(model, state, [], null);
    lastOperation = "已恢复内置样例并完整重推";
    persistState();
    render();
  });

  document.getElementById("exportState").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ model, state }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "handoff-analysis-state.json";
    link.click();
    URL.revokeObjectURL(link.href);
  });

  document.getElementById("importModel").addEventListener("click", () => {
    document.getElementById("modelFile").click();
  });

  document.getElementById("modelFile").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        const nextModel = imported.model || imported;
        if (!Array.isArray(nextModel.handoffs) || !Array.isArray(nextModel.contexts)) {
          throw new Error("JSON 必须包含 handoffs 与 contexts 数组");
        }
        model = { now: nextModel.now || model.now, ...nextModel };
        state = imported.state || engine.createAnalysisState();
        evaluation = engine.recomputeChain(model, state, [], null);
        lastOperation = "已导入数据并完整重推";
        persistState();
        render();
      } catch (error) {
        alert(`导入失败：${error.message}`);
      }
    };
    reader.readAsText(file, "utf-8");
    event.target.value = "";
  });

  function renderStats() {
    const s = evaluation.result.summary;
    const cards = [
      ["事项总数", s.total, "neutral"],
      ["平均完整度", percent(s.averageCompleteness), "ready"],
      ["可完成", s.ready, "ready"],
      ["不完整", s.incomplete, "incomplete"],
      ["不可信", s.untrusted, "untrusted"],
      ["待裁决", s.blocked, "blocked"],
    ];
    elements.stats.innerHTML = cards.map(([label, value, kind]) =>
      `<div class="stat"><div class="label">${label}</div><div class="value"><span class="badge ${kind}">${value}</span></div></div>`
    ).join("");
    elements.clock.textContent = `推演时点：${evaluation.result.now}`;
  }

  function renderFilters() {
    elements.filters.innerHTML = FILTERS.map((filter) =>
      `<button type="button" class="${activeFilter === filter.id ? "active" : ""}" data-filter="${filter.id}">${filter.label}</button>`
    ).join("");
    elements.filters.querySelectorAll("[data-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        activeFilter = button.dataset.filter;
        render();
      });
    });
  }

  function renderContextEntry(context) {
    const fresh = !context.validUntil || Date.parse(context.validUntil) > Date.parse(evaluation.result.now);
    const staleClass = fresh ? "fresh" : "stale";
    const staleText = context.validUntil
      ? `<span class="${staleClass}">${fresh ? "时效内" : "已过期"} · ${escapeHtml(context.validUntil)}</span>`
      : `<span class="fresh">长期有效</span>`;
    return `
      <div class="context-item">
        <div class="context-title">
          <span>${escapeHtml(context.key)} ${context.active === false ? '<span class="badge neutral">已停用</span>' : ""}</span>
          ${staleText}
        </div>
        <div class="context-value">${escapeHtml(context.value)}</div>
        <div class="source-line">来源：${escapeHtml(context.source)}${context.note ? `；${escapeHtml(context.note)}` : ""}</div>
        <div style="margin-top:8px"><button type="button" class="secondary" data-edit-context="${context.id}">调整</button></div>
      </div>`;
  }

  function renderReasons(item) {
    if (!item.reasons.length) {
      return `<div class="reason"><strong>依据：</strong>前置依赖均可达，必需上下文齐备且在时效内。</div>`;
    }
    return item.reasons.map((reason) =>
      `<div class="reason"><code>${reason.code}</code> ${escapeHtml(reason.message)}</div>`
    ).join("");
  }

  function renderHandoff(item) {
    const contexts = evaluation.result.contexts.filter((context) => context.handoffId === item.id);
    const conflicting = conflictKeysFor(item.id);
    const dependencyText = item.dependencies.length
      ? item.dependencies.map((dep) => findHandoff(dep)
          ? escapeHtml(dep)
          : `<span class="stale">${escapeHtml(dep)}（缺失）</span>`).join("、")
      : "无";
    const affected = evaluation.affected.includes(item.id);
    return `
      <article class="handoff-card status-${item.status} ${affected ? "affected" : ""}">
        <div class="card-head">
          <div>
            <h3>${escapeHtml(item.id)} · ${escapeHtml(item.title)}</h3>
            <div class="meta">
              <span>${escapeHtml(item.role)}</span>
              <span>时效：${escapeHtml(item.timeCritical || "未标记")}</span>
              <span>来源：${escapeHtml(item.sourceNote || "未提供")}</span>
            </div>
          </div>
          <span>
            <span class="badge ${item.status}">${STATUS_LABELS[item.status]}</span>
            ${item.trusted === false ? ' <span class="badge untrusted">不可信</span>' : ""}
          </span>
        </div>
        <div class="progress">
          <span class="muted">自身上下文</span>
          <div class="bar"><span style="width:${percent(item.contextCompleteness)}"></span></div>
          <strong>${percent(item.contextCompleteness)}</strong>
          <span class="muted">含依赖链路</span>
          <div class="bar"><span style="width:${percent(item.chainCompleteness)}"></span></div>
          <strong>${percent(item.chainCompleteness)}</strong>
        </div>
        <div class="deps"><strong>前置依赖：</strong>${dependencyText}</div>
        <div class="deps"><strong>必需上下文：</strong>${item.requiredContextKeys.map((key) =>
          conflicting.has(key) ? `<span class="stale">${escapeHtml(key)}（冲突）</span>` : escapeHtml(key)
        ).join("、") || "无"}</div>
        <div class="detail-grid">
          <div>
            <h4>相关上下文</h4>
            <div class="context-list">${contexts.map(renderContextEntry).join("") || '<span class="muted">无上下文条目</span>'}</div>
          </div>
          <div>
            <h4>推演依据与风险</h4>
            <div class="reasons">${renderReasons(item)}</div>
          </div>
        </div>
      </article>`;
  }

  function renderHandoffs() {
    const visible = evaluation.result.handoffs.filter((item) =>
      activeFilter === "all" || item.status === activeFilter);
    elements.list.innerHTML = visible.map(renderHandoff).join("") ||
      '<div class="panel">当前筛选下没有事项。</div>';
    elements.list.querySelectorAll("[data-edit-context]").forEach((button) => {
      button.addEventListener("click", () => openEditor(button.dataset.editContext));
    });
  }

  function renderConflictEntry(conflict, context) {
    const selected = conflict.selectedContext?.id === context.id;
    const fresh = !context.validUntil || Date.parse(context.validUntil) > Date.parse(evaluation.result.now);
    return `
      <div class="conflict-entry ${selected ? "selected" : ""}">
        <div class="context-title">
          <strong>${escapeHtml(context.source)}</strong>
          <span class="${fresh ? "fresh" : "stale"}">${fresh ? "时效内" : "已过期"}</span>
        </div>
        <div class="context-value">${escapeHtml(context.value)}</div>
        <div class="muted">上下文 ID：${escapeHtml(context.id)}；失效时间：${escapeHtml(context.validUntil || "长期有效")}</div>
        <div class="conflict-actions">
          <button type="button" data-choose="${context.id}" data-conflict="${conflict.id}">采用此来源</button>
        </div>
      </div>`;
  }

  function renderConflict(conflict) {
    const status = conflict.resolved
      ? `<span class="badge ready">已裁决${conflict.staleResolution ? "，但已过期" : ""}</span>`
      : `<span class="badge blocked">等待裁决</span>`;
    return `
      <article class="conflict-card">
        <h3>${escapeHtml(conflict.handoffId)} / ${escapeHtml(conflict.key)} ${status}</h3>
        <p class="muted">以下双方来源都会保留；选择后仅解除冲突，并继续沿下游链重推。</p>
        ${conflict.entries.map((entry) => renderConflictEntry(conflict, entry)).join("")}
        <div class="manual">
          <h4>或输入使用者裁决值</h4>
          <textarea data-manual-value="${conflict.id}" rows="2" placeholder="裁决后的统一内容"></textarea>
          <input data-manual-source="${conflict.id}" placeholder="裁决依据/来源">
          <input data-manual-until="${conflict.id}" placeholder="失效时间 ISO，可留空">
          <div class="conflict-actions">
            <button type="button" class="secondary" data-manual-apply="${conflict.id}">采用手动裁决</button>
            ${conflict.resolved ? `<button type="button" class="danger" data-clear-conflict="${conflict.id}">撤回裁决</button>` : ""}
          </div>
        </div>
      </article>`;
  }

  function renderConflicts() {
    const conflicts = evaluation.result.conflicts;
    if (!conflicts.length) {
      elements.conflicts.innerHTML = '<div class="muted">当前没有来源矛盾。</div>';
      return;
    }
    elements.conflicts.innerHTML = conflicts.map(renderConflict).join("");
    elements.conflicts.querySelectorAll("[data-choose]").forEach((button) => {
      button.addEventListener("click", () => {
        const [handoffId, key] = button.dataset.conflict.split("::");
        state = engine.adjudicateConflict(state, handoffId, key, { winnerContextId: button.dataset.choose });
        rerun([handoffId], `裁决 ${handoffId} / ${key}，重推该事项及下游`);
      });
    });
    elements.conflicts.querySelectorAll("[data-manual-apply]").forEach((button) => {
      button.addEventListener("click", () => {
        const conflictId = button.dataset.manualApply;
        const [handoffId, key] = conflictId.split("::");
        const fieldValue = (field) => document.querySelector(`[${field}="${conflictId}"]`)?.value.trim() || "";
        const value = fieldValue("data-manual-value");
        const source = fieldValue("data-manual-source");
        const validUntil = fieldValue("data-manual-until");
        if (!value) return alert("请输入裁决后的统一内容。");
        state = engine.adjudicateConflict(state, handoffId, key, {
          resolvedValue: value,
          resolvedSource: source || "使用者裁决",
          validUntil: validUntil || null,
        });
        rerun([handoffId], `手动裁决 ${handoffId} / ${key}，重推该事项及下游`);
      });
    });
    elements.conflicts.querySelectorAll("[data-clear-conflict]").forEach((button) => {
      button.addEventListener("click", () => {
        const [handoffId, key] = button.dataset.clearConflict.split("::");
        state = engine.clearAdjudication(state, handoffId, key);
        rerun([handoffId], `撤回 ${handoffId} / ${key} 的裁决，恢复冲突阻塞`);
      });
    });
  }

  function renderRecomputeInfo() {
    elements.recompute.innerHTML = `
      <p><strong>${escapeHtml(lastOperation)}</strong></p>
      <p>重推链路：${evaluation.affected.map(escapeHtml).join(" → ") || "无（初始化）"}</p>
      <p>复用未受影响事项：${evaluation.reused.map(escapeHtml).join("、") || "无"}</p>
      <p class="muted">增量结果由同一套依赖与上下文规则生成；自动化测试校验其与从头完整重推深度一致。</p>`;
  }

  function openEditor(contextId) {
    const context = findContext(contextId);
    elements.contextId.value = context.id;
    elements.value.value = context.value ?? "";
    elements.source.value = context.source ?? "";
    elements.validUntil.value = context.validUntil ?? "";
    elements.active.checked = context.active !== false;
    elements.backdrop.classList.add("show");
  }

  function closeEditor() { elements.backdrop.classList.remove("show"); }
  document.getElementById("closeEditor").addEventListener("click", closeEditor);
  elements.backdrop.addEventListener("click", (event) => {
    if (event.target === elements.backdrop) closeEditor();
  });

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const contextId = elements.contextId.value;
    const context = findContext(contextId);
    state = engine.applyContextEdit(state, contextId, {
      value: elements.value.value.trim(),
      source: elements.source.value.trim(),
      validUntil: elements.validUntil.value.trim() || null,
      active: elements.active.checked,
    });
    closeEditor();
    rerun([context.handoffId], `修改上下文 ${contextId}，重推对应事项及下游`);
  });

  function render() {
    renderStats();
    renderFilters();
    renderHandoffs();
    renderConflicts();
    renderRecomputeInfo();
  }
  render();
})();
