(function () {
  "use strict";

  const analyzer = window.AutoDemoAnalyzer;
  const $ = (id) => document.getElementById(id);
  const ui = {
    importButton: $("import-button"),
    exportButton: $("export-button"),
    resetButton: $("reset-button"),
    fileInput: $("file-input"),
    stepList: $("step-list"),
    stepCounter: $("step-counter"),
    previousStep: $("previous-step"),
    nextStep: $("next-step"),
    currentStepMeta: $("current-step-meta"),
    gateBanner: $("gate-banner"),
    controlsRoot: $("controls-root"),
    completionStatus: $("completion-status"),
    skipStep: $("skip-step"),
    forceStep: $("force-step"),
    pathList: $("path-list"),
    issueList: $("issue-list"),
    incrementalStatus: $("incremental-status"),
    focusNow: $("focus-now"),
    focusLog: $("focus-log"),
    clearLog: $("clear-log"),
    editorPanel: $("editor-panel"),
    editor: $("definition-editor"),
    applyJson: $("apply-json"),
    editorMessage: $("editor-message"),
  };

  const defaultDefinition = {
    name: "离线键盘结账演练",
    steps: [
      {
        id: "account",
        name: "填写账户",
        controls: [
          { id: "email", type: "textbox", label: "邮箱地址", autocomplete: "email" },
          { id: "newsletter", type: "checkbox", label: "接收订单通知", optional: true, checked: false },
          { id: "continue-account", type: "button", label: "继续到配送方式" },
        ],
        completion: { mode: "all", controls: ["email", "continue-account"] },
      },
      {
        id: "delivery",
        name: "选择配送",
        order: ["delivery-method", "delivery-note", "confirm-delivery"],
        controls: [
          { id: "delivery-method", type: "select", label: "配送方式",
            options: ["标准配送", "自提点取货"] },
          { id: "delivery-note", type: "textbox", label: "配送备注", optional: true },
          { id: "confirm-delivery", type: "checkbox", label: "确认配送信息" },
        ],
        completion: { mode: "all", controls: ["delivery-method", "confirm-delivery"] },
      },
      {
        id: "customize",
        name: "自定义礼品卡",
        order: ["open-editor", "card-message", "save-card"],
        controls: [
          { id: "open-editor", type: "button", label: "打开礼品卡编辑器", trap: true,
            trapEscapeLabel: "Esc 关闭礼品卡编辑器" },
          { id: "card-message", type: "textbox" },
          { id: "save-card", type: "button", label: "保存礼品卡" },
        ],
        completion: { mode: "any", controls: ["save-card"] },
      },
      {
        id: "payment",
        name: "确认支付",
        controls: [
          { id: "agree", type: "checkbox", label: "同意支付条款" },
          { id: "pay", type: "button", label: "提交支付" },
        ],
        completion: { mode: "all", controls: ["agree", "pay"] },
      },
    ],
  };

  const state = {
    definition: analyzer.clone(defaultDefinition),
    session: { steps: {} },
    rulings: {},
    currentIndex: 0,
    analysis: null,
    engine: analyzer.createIncrementalAnalyzer(),
    focusLogs: [],
    activeTrap: null,
    pendingFromIndex: null,
  };

  function currentStep() {
    return state.analysis.steps[state.currentIndex];
  }

  function ensureSessionStep(id) {
    if (!state.session.steps[id]) state.session.steps[id] = { values: {}, actions: [] };
    return state.session.steps[id];
  }

  function setStatus(element, message, tone) {
    element.textContent = message;
    element.className = element.className.split(/\s+/).filter((c) =>
      !["ok", "blocked", "ruling", "warn", "done", "todo", "error"].includes(c)).join(" ");
    if (tone) element.classList.add(tone);
  }

  function badge(text, tone) {
    return `<span class="badge ${tone}">${text}</span>`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
  }

  function recompute(options) {
    const incrementalOptions = options && Number.isInteger(options.fromIndex) ? options :
      Number.isInteger(state.pendingFromIndex) ? { fromIndex: state.pendingFromIndex } : undefined;
    state.pendingFromIndex = null;
    state.analysis = state.engine.analyze(
      state.definition,
      state.session,
      state.rulings,
      incrementalOptions
    );
    if (state.currentIndex >= state.analysis.steps.length) {
      state.currentIndex = Math.max(0, state.analysis.steps.length - 1);
    }
  }

  function stepBadges(step) {
    const items = [];
    if (step.completed) items.push(badge(step.completionBasis === "ruling" ? "裁决跳过" : "已完成", "ok"));
    if (step.ruling.forced) items.push(badge("强制进入", "ruling"));
    if (!step.naturallyEnterable && step.enterable) items.push(badge("裁决进入", "ruling"));
    if (step.definitionBlocked) items.push(badge("定义阻断", "danger"));
    if (!step.preconditionSatisfied) items.push(badge("前置未完成", "warn"));
    if (!items.length) items.push(badge(step.naturallyEnterable ? "可进入" : "不可进入",
      step.naturallyEnterable ? "ok" : "danger"));
    return items.join("");
  }

  function renderSteps() {
    ui.stepList.innerHTML = state.analysis.steps.map((step, index) => `
      <li>
        <button type="button" data-step-index="${index}"
          aria-current="${index === state.currentIndex ? "step" : "false"}">
          <span class="step-title">${index + 1}. ${escapeHtml(step.name)}</span>
          <span class="control-meta">ID：${escapeHtml(step.id)} · 可达控件 ${step.structure.reachableControlIds.length}/${step.structure.controls.length}</span>
          <span class="badges">${stepBadges(step)}</span>
        </button>
      </li>
    `).join("");
    ui.stepCounter.textContent = `${state.currentIndex + 1} / ${state.analysis.steps.length}`;
    ui.previousStep.disabled = state.currentIndex === 0;
    ui.nextStep.disabled = state.currentIndex >= state.analysis.steps.length - 1;
  }

  function renderPath() {
    ui.pathList.innerHTML = state.analysis.steps.map((step) => {
      const conclusion = {
        reachable: ["reachable", "推导可达"],
        "forced-entry": ["forced-entry", "裁决：强制进入"],
        unreachable: ["unreachable", "推导不可达"],
      }[step.pathConclusion];
      const controls = step.structure.reachableControlIds.length
        ? step.structure.reachableControlIds.map(escapeHtml).join(" → ")
        : "没有可达控件";
      return `<li class="${conclusion[0]}">
        <strong>${step.index + 1}. ${escapeHtml(step.name)}</strong>
        <div class="badges">${badge(conclusion[1], conclusion[0] === "reachable" ? "ok" : conclusion[0] === "forced-entry" ? "ruling" : "danger")}
        ${step.completed ? badge(`完成：${step.completionBasis === "ruling" ? "裁决" : "推导"}`, "ok") : ""}</div>
        <div class="path-controls">${controls}</div>
      </li>`;
    }).join("");

    const inc = state.analysis.incremental;
    ui.incrementalStatus.textContent = state.analysis.incremental.initial
      ? `初始完整推导已完成：${state.analysis.steps.map((step) => step.index + 1).join("、")}。之后修改定义时只重推受影响后续步骤。`
      : inc.recomputedIndexes.length
      ? `本次仅从步骤 ${inc.recomputedFrom + 1} 起重推：${inc.recomputedIndexes.map((i) => i + 1).join("、")}；与完整推导共用同一函数。`
      : "没有步骤定义发生变化，仅刷新运行状态。";

    const issues = [];
    state.analysis.steps.forEach((step) => {
      step.structure.issues.forEach((issueItem) => {
        issues.push({
          warning: issueItem.severity === "warning",
          text: `步骤 ${step.index + 1}「${step.name}」${issueItem.controlId ? ` / 控件 ${issueItem.controlId}：` : "："}${issueItem.message}`,
        });
      });
      if (!step.preconditionSatisfied && !step.ruling.forced) {
        issues.push({ warning: true, text: `步骤 ${step.index + 1}「${step.name}」：${step.blockedReasons[0]}` });
      }
      if (step.ruling.forced || step.ruling.skipped) {
        issues.push({
          ruling: true,
          warning: true,
          text: `步骤 ${step.index + 1}「${step.name}」：${step.ruling.forced ? "强制进入" : ""}${step.ruling.forced && step.ruling.skipped ? "、" : ""}${step.ruling.skipped ? "临时跳过" : ""}结论来自人工裁决。`,
        });
      }
    });
    ui.issueList.innerHTML = issues.length ? issues.map((item) =>
      `<li class="${item.ruling ? "ruling" : item.warning ? "warning" : ""}">${escapeHtml(item.text)}</li>`).join("")
      : "<li>未发现顺序、标签或焦点问题。</li>";
  }

  function controlInputHtml(step, control, sessionStep, missing, inert, blockedStep) {
    const inputId = `control-${step.id}-${control.id}`;
    const labelId = `label-${step.id}-${control.id}`;
    const type = String(control.type || "generic").toLowerCase();
    const sessionValue = sessionStep.values[control.id];
    const checked = sessionValue === undefined ? Boolean(control.checked) : sessionValue === true;
    const selected = sessionValue === undefined ? (control.defaultValue || (control.options || [])[0] || "") : sessionValue;
    const value = sessionValue === undefined ? (control.defaultValue || "") : sessionValue;
    const labelled = missing ? `aria-label="未命名控件 ${escapeHtml(control.id)}"` : `aria-labelledby="${labelId}"`;
    const focus = inert || (blockedStep && !control.trap) ? "tabindex=\"-1\"" : "";
    if (type === "checkbox") {
      return `<input id="${inputId}" type="checkbox" data-control-id="${escapeHtml(control.id)}" ${checked ? "checked" : ""} ${labelled} ${focus}>`;
    }
    if (type === "radio" || type === "option") {
      return `<input id="${inputId}" type="radio" name="${escapeHtml(step.id)}" data-control-id="${escapeHtml(control.id)}" value="selected" ${checked || value === "selected" ? "checked" : ""} ${labelled} ${focus}>`;
    }
    if (type === "select" || type === "listbox") {
      const options = (control.options || []).map((option) =>
        `<option value="${escapeHtml(option)}" ${selected === option ? "selected" : ""}>${escapeHtml(option)}</option>`).join("");
      return `<select id="${inputId}" data-control-id="${escapeHtml(control.id)}" ${labelled} ${focus}>${options}</select>`;
    }
    if (type === "textarea") {
      return `<textarea id="${inputId}" rows="3" data-control-id="${escapeHtml(control.id)}" ${labelled} ${focus}>${escapeHtml(value)}</textarea>`;
    }
    if (type === "button" || type === "link" || type === "generic") {
      return `<button type="button" id="${inputId}" data-control-id="${escapeHtml(control.id)}" data-control-type="${type}" ${labelled} ${focus} ${control.trap ? "data-focus-trap=\"true\"" : ""}>${escapeHtml(missing ? "未命名操作" : control.label || control.ariaLabel || control.id)}</button>`;
    }
    return `<input id="${inputId}" type="text" data-control-id="${escapeHtml(control.id)}" value="${escapeHtml(value)}" ${labelled} ${focus}>`;
  }

  function renderControl(step, control, orderIndex) {
    const sessionStep = ensureSessionStep(step.id);
    const reachable = step.structure.reachableControlIds.includes(control.id);
    const unreachable = step.structure.unreachableControls.find((item) => item.id === control.id);
    const accessibleName = [control.label, control.ariaLabel, control.ariaLabelledby, control.text]
      .find((item) => typeof item === "string" && item.trim()) || "";
    const labelId = `label-${step.id}-${control.id}`;
    const missing = !accessibleName && control.focusable !== false;
    const inert = !reachable && !missing && !step.structure.orderConflictControlIds.includes(control.id);
    const body = controlInputHtml(step, control, sessionStep, missing, inert, !step.enterable);
    const reason = unreachable ? `不可达：${analyzer.reasonText(unreachable.reasonCode)}${unreachable.after ? `（位于 ${escapeHtml(unreachable.after)} 之后）` : ""}` : "推导可达";
    const cardClass = inert ? "inert" : !step.naturallyEnterable && !control.trap ? "gate-blocked" : reachable ? "reachable" : "unreachable";
    return `<article class="control-card ${cardClass}" data-control-card="${escapeHtml(control.id)}" data-trap="${Boolean(control.trap)}" data-order-index="${orderIndex}">
      <div class="control-head">
        <div><label id="${labelId}" class="control-title">${escapeHtml(accessibleName)}</label>
        ${missing ? `<span class="missing-name">语义标签缺失</span>` : ""}
        <div class="control-meta">顺序 ${orderIndex + 1} · ${escapeHtml(control.id)} · ${escapeHtml(control.type || "generic")} · ${reason}</div></div>
        ${control.trap ? badge("焦点陷阱：Tab 被截停，Esc 使用程序出口", "warn") : ""}
      </div><div class="control-body">${body}</div>
    </article>`;
  }

  function renderTask() {
    const step = currentStep();
    document.documentElement.dataset.currentStepId = step.id;
    ui.currentStepMeta.textContent =
      `步骤 ${step.index + 1}/${state.analysis.steps.length} · ID ${step.id} · 完成模式 ${step.completion.mode}`;

    const ordered = step.structure.topologicalOrder
      .map((id) => step.structure.controls.find((control) => control.id === id));
    ui.controlsRoot.innerHTML = ordered.map((control, index) => renderControl(step, control, index)).join("") +
      `<button type="button" id="trap-escape" class="trap-escape" tabindex="-1" hidden>程序出口：返回安全焦点</button>`;

    if (step.enterable && !step.definitionBlocked) {
      setStatus(ui.gateBanner, step.ruling.forced ?
        "当前步骤通过人工强制进入；下方问题仍按推导结果保留。" :
        "前置条件已满足，当前步骤可进入。", step.ruling.forced ? "ruling" : "ok");
    } else {
      ui.gateBanner.className = "gate-banner blocked";
      ui.gateBanner.innerHTML = `当前步骤不可自然进入：<ul>${step.blockedReasons.map((reason) =>
        `<li>${escapeHtml(reason)}</li>`).join("")}</ul>`;
    }

    setStatus(ui.completionStatus,
      `${step.ruling.skipped && !step.completion.satisfied ? "人工裁决跳过：" : "完成条件："}${step.completed ? "已满足" : "尚未满足"}`,
      step.completed ? "done" : "todo");
    ui.skipStep.textContent = step.ruling.skipped ? "清除临时跳过 (Alt+S)" : "临时跳过 (Alt+S)";
    ui.forceStep.textContent = step.ruling.forced ? "清除强制进入 (Alt+F)" : "强制进入 (Alt+F)";
  }

  function renderAll() {
    renderSteps();
    renderTask();
    renderPath();
  }

  function persistControlValue(element) {
    const step = currentStep();
    const id = element.dataset.controlId;
    const sessionStep = ensureSessionStep(step.id);
    if (element.matches("input[type='checkbox'], input[type='radio']")) {
      sessionStep.values[id] = element.checked;
    } else {
      sessionStep.values[id] = element.value;
    }
  }

  function activateControl(element) {
    const step = currentStep();
    const id = element.dataset.controlId;
    const control = step.structure.controls.find((item) => item.id === id);
    const type = String((control && control.type) || "generic").toLowerCase();
    const sessionStep = ensureSessionStep(step.id);
    if (["button", "link", "generic"].includes(type)) {
      if (!sessionStep.actions.includes(id)) sessionStep.actions.push(id);
    }
    if (control && control.trap) {
      state.activeTrap = { stepId: step.id, controlId: id };
      const escape = $("trap-escape");
      escape.hidden = false;
      escape.tabIndex = 0;
      recordFocus(element, "进入焦点陷阱；Tab 将被截停，Esc 可使用程序出口");
    }
    refresh();
  }

  function refresh(options) {
    const active = document.activeElement;
    const activeControlId = active && active.dataset ? active.dataset.controlId : null;
    const focusSelector = activeControlId
      ? `[data-control-id="${CSS.escape(activeControlId)}"]`
      : active && active.id ? `#${CSS.escape(active.id)}` : null;
    recompute(options);
    renderAll();
    if (focusSelector) {
      const restored = document.querySelector(focusSelector);
      if (restored && restored.tabIndex !== -1 && !restored.disabled) restored.focus({ preventScroll: true });
    }
  }

  function goToStep(index) {
    state.currentIndex = Math.max(0, Math.min(index, state.analysis.steps.length - 1));
    state.activeTrap = null;
    recompute();
    renderAll();
    $("task-surface").focus({ preventScroll: true });
  }

  function toggleRuling(kind) {
    const step = currentStep();
    const current = state.rulings[step.id] || { skipped: false, forced: false, note: "" };
    const next = Object.assign({}, current, { [kind]: !current[kind], at: new Date().toISOString() });
    if (!next.skipped && !next.forced) delete state.rulings[step.id];
    else state.rulings[step.id] = next;
    refresh();
  }

  function describeFocus(element) {
    if (!element || element === document.body || element === document.documentElement) {
      return { label: "页面容器", semantic: true, problems: [] };
    }
    const stepId = document.documentElement.dataset.currentStepId;
    const step = state.analysis.steps.find((item) => item.id === stepId);
    const id = element.dataset && element.dataset.controlId;
    const control = id && step ? step.structure.controls.find((item) => item.id === id) : null;
    const label = control ? (control.label || control.ariaLabel || control.ariaLabelledby || control.text || "") :
      (element.getAttribute("aria-label") || element.textContent || element.value || element.id || element.tagName);
    const problems = [];
    if (control) {
      if (!label) problems.push("语义标签缺失");
      if (step.structure.unreachableControls.some((item) => item.id === id)) problems.push("该控件在推导路径中不可达");
      if (!step.naturallyEnterable && !control.trap) problems.push("所在步骤尚未自然开放");
      if (control.trap) problems.push("焦点陷阱");
    }
    return {
      label: String(label).trim() || `未命名 ${element.tagName.toLowerCase()}`,
      semantic: problems.length === 0,
      problems,
      controlId: id || null,
    };
  }

  function recordFocus(element, note) {
    const step = currentStep();
    const info = describeFocus(element);
    const entry = {
      time: new Date(),
      step: `${step.index + 1}. ${step.name}`,
      stepId: step.id,
      label: info.label,
      controlId: info.controlId,
      semantic: info.semantic,
      problems: info.problems,
      note: note || "",
    };
    state.focusLogs.unshift(entry);
    state.focusLogs = state.focusLogs.slice(0, 60);
    renderFocusLog(entry);
  }

  function renderFocusLog(current) {
    const item = current || state.focusLogs[0];
    if (!item) {
      ui.focusNow.textContent = "尚未记录焦点";
      ui.focusLog.innerHTML = "";
      return;
    }
    const warnings = item.problems.length ? ` · ${item.problems.join("、")}` : "";
    ui.focusNow.innerHTML = `<strong>${escapeHtml(item.step)}</strong><br>${escapeHtml(item.label)}${warnings ? ` <span class="bad">${escapeHtml(warnings)}</span>` : ""}`;
    ui.focusLog.innerHTML = state.focusLogs.map((log) => {
      const time = log.time.toLocaleTimeString();
      const status = log.semantic ? "语义完整" : `<span class="bad">语义/路径异常</span>`;
      return `<li><time>${time}</time>${escapeHtml(log.step)} · ${escapeHtml(log.label)} · ${status}${log.note ? ` · ${escapeHtml(log.note)}` : ""}</li>`;
    }).join("");
  }

  function findTrapControls() {
    return Array.from(ui.controlsRoot.querySelectorAll("[data-focus-trap='true']"));
  }

  function leaveActiveTrap() {
    if (!state.activeTrap) return;
    const escape = $("trap-escape");
    const trap = document.querySelector(`[data-control-id="${CSS.escape(state.activeTrap.controlId)}"]`);
    state.activeTrap = null;
    escape.hidden = true;
    escape.tabIndex = -1;
    if (trap) {
      trap.focus();
      recordFocus(trap, "已通过 Esc 使用程序出口离开陷阱；后续控件仍需修复顺序才能自然到达");
    }
  }

  document.addEventListener("focusin", (event) => {
    if (ui.editorPanel.contains(event.target) || event.target === ui.editor) return;
    recordFocus(event.target);
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.target === ui.editor && !event.altKey) return;

    if (event.key === "Escape" && state.activeTrap) {
      event.preventDefault();
      leaveActiveTrap();
      return;
    }

    if (state.activeTrap && (event.key === "Tab")) {
      event.preventDefault();
      const traps = findTrapControls();
      if (!traps.length) return;
      const current = document.activeElement;
      const currentPos = traps.indexOf(current);
      const next = event.shiftKey
        ? traps[(currentPos - 1 + traps.length) % traps.length]
        : traps[(currentPos + 1) % traps.length];
      next.focus();
      recordFocus(next, "Tab 被焦点陷阱截停");
      return;
    }

    if (!event.altKey) return;
    const key = event.key.toLowerCase();
    if (event.target === ui.editor && !["a", "e"].includes(key)) return;
    if (key === "arrowleft") { event.preventDefault(); goToStep(state.currentIndex - 1); }
    if (key === "arrowright") { event.preventDefault(); goToStep(state.currentIndex + 1); }
    if (key === "s") { event.preventDefault(); toggleRuling("skipped"); }
    if (key === "f") { event.preventDefault(); toggleRuling("forced"); }
    if (key === "e") {
      event.preventDefault();
      ui.editorPanel.hidden = !ui.editorPanel.hidden;
      if (!ui.editorPanel.hidden) ui.editor.focus();
    }
    if (key === "a" && event.target === ui.editor) {
      event.preventDefault();
      applyDefinitionFromEditor({ focusEditor: true });
    }
  });

  ui.stepList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-step-index]");
    if (button) goToStep(Number(button.dataset.stepIndex));
  });
  ui.previousStep.addEventListener("click", () => goToStep(state.currentIndex - 1));
  ui.nextStep.addEventListener("click", () => goToStep(state.currentIndex + 1));
  ui.skipStep.addEventListener("click", () => toggleRuling("skipped"));
  ui.forceStep.addEventListener("click", () => toggleRuling("forced"));

  function handleControlMutation(event) {
    if (!event.target.dataset.controlId) return;
    persistControlValue(event.target);
    refresh();
  }
  ui.controlsRoot.addEventListener("input", handleControlMutation);
  ui.controlsRoot.addEventListener("change", handleControlMutation);

  ui.controlsRoot.addEventListener("click", (event) => {
    const control = event.target.closest("[data-control-id]");
    if (control && ["button", "link", "generic"].includes(control.dataset.controlType)) activateControl(control);
    if (event.target.id === "trap-escape") leaveActiveTrap();
  });

  $("task-surface").addEventListener("submit", (event) => event.preventDefault());
  ui.clearLog.addEventListener("click", () => {
    state.focusLogs = [];
    renderFocusLog();
  });

  function applyDefinition(definition, options) {
    const validationErrors = analyzer.validateDefinition(definition);
    if (validationErrors.length) {
      setStatus(ui.editorMessage, "定义未应用：" + validationErrors.map((item) => item.message).join("；"), "error");
      return false;
    }
    state.definition = definition;
    state.currentIndex = Math.min(state.currentIndex, Math.max(0, definition.steps.length - 1));
    state.pendingFromIndex = options && Number.isInteger(options.fromIndex) ? options.fromIndex : null;
    ui.editor.value = options && options.preserveText ? ui.editor.value : JSON.stringify(definition, null, 2);
    setStatus(ui.editorMessage, `定义已在 ${new Date().toLocaleTimeString()} 应用；路径从受影响步骤开始增量重推。`, "ok");
    refresh();
    return true;
  }

  function applyDefinitionFromEditor(options) {
    try {
      const parsed = JSON.parse(ui.editor.value);
      const focusEditor = options && options.focusEditor;
      const applied = applyDefinition(parsed, { preserveText: true });
      if (applied && focusEditor) ui.editor.focus();
      return applied;
    } catch (error) {
      setStatus(ui.editorMessage, `JSON 解析失败：${error.message}`, "error");
      return false;
    }
  }

  ui.applyJson.addEventListener("click", () => applyDefinitionFromEditor());
  ui.importButton.addEventListener("click", () => ui.fileInput.click());
  ui.fileInput.addEventListener("change", async () => {
    const file = ui.fileInput.files && ui.fileInput.files[0];
    if (!file) return;
    try {
      const textContent = await file.text();
      ui.editor.value = textContent;
      applyDefinitionFromEditor();
    } catch (error) {
      setStatus(ui.editorMessage, `读取文件失败：${error.message}`, "error");
    } finally {
      ui.fileInput.value = "";
    }
  });

  ui.exportButton.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state.definition, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "keyboard-task-flow.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });

  ui.resetButton.addEventListener("click", () => {
    state.session = { steps: {} };
    state.rulings = {};
    state.currentIndex = 0;
    state.activeTrap = null;
    refresh();
    $("task-surface").focus();
  });

  recompute();
  state.analysis.incremental.initial = true;
  renderAll();
  ui.editor.value = JSON.stringify(state.definition, null, 2);
})();
