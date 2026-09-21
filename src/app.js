(function () {
  "use strict";
  const storageKey = "emission-plan-relay-v1";
  const els = {};
  let plan;
  let engine;
  let result;
  let selectedCutoff;
  let affected = [];

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    for (const id of ["periodSelect", "summary", "phaseList", "issueList", "affectedList",
      "jsonInput", "toast", "importJson", "exportJson", "resetDemo", "recomputeCheck"]) {
      els[id] = document.getElementById(id);
    }
    plan = loadPlan();
    const saved = loadUiState();
    engine = new PlanEngine.PlanEngine(plan, { excludedMeasureIds: saved.excluded });
    Object.assign(engine.locks, saved.locks);
    selectedCutoff = engine.lastCutoff;
    bindEvents();
    els.jsonInput.value = JSON.stringify(plan, null, 2);
    render();
  }

  function loadPlan() {
    try {
      const saved = localStorage.getItem(storageKey + ":plan");
      if (saved) return JSON.parse(saved);
    } catch (error) {
      console.warn("读取本地数据失败，使用演示数据。", error);
    }
    return JSON.parse(JSON.stringify(window.SamplePlan));
  }

  function loadUiState() {
    try {
      return JSON.parse(localStorage.getItem(storageKey + ":ui")) || { excluded: [], locks: {} };
    } catch (error) {
      return { excluded: [], locks: {} };
    }
  }

  function persist() {
    localStorage.setItem(storageKey + ":plan", JSON.stringify(plan));
    localStorage.setItem(storageKey + ":ui", JSON.stringify({
      excluded: Array.from(engine.excluded),
      locks: engine.locks
    }));
  }

  function bindEvents() {
    els.periodSelect.addEventListener("change", (event) => {
      selectedCutoff = Number(event.target.value);
      render();
    });
    els.phaseList.addEventListener("click", handleClick);
    els.phaseList.addEventListener("change", handleChange);
    els.importJson.addEventListener("click", importJson);
    els.exportJson.addEventListener("click", exportJson);
    els.resetDemo.addEventListener("click", resetDemo);
  }

  function render() {
    const incremental = engine.analyze(selectedCutoff);
    if (els.recomputeCheck.checked) {
      const full = engine.fullReanalyze(selectedCutoff);
      if (!stableEqual(incremental, full)) {
        showToast("增量结果与完整重推不一致，请查看控制台。", "error");
        console.error({ incremental, full });
      } else {
        showToast("已校验：增量重推与完整重推一致。", "success");
      }
    }
    result = incremental;
    selectedCutoff = result.cutoffIndex;
    renderPeriods();
    renderSummary();
    renderPhases();
    renderIssues();
    renderAffected();
    persist();
  }

  function renderPeriods() {
    els.periodSelect.innerHTML = result.periods.map((period, index) =>
      `<option value="${index}" ${index === result.cutoffIndex ? "selected" : ""}>${escapeHtml(period)}</option>`
    ).join("");
  }

  function renderSummary() {
    const s = result.summary;
    const cards = [
      [s.total, "阶段总数"],
      [s.achieved, "已达标"],
      [s.behind, "未达标"],
      [s.untrusted, "不可信"],
      [s.locked, "手动锁定"]
    ];
    els.summary.innerHTML = `<div class="summary-grid">${cards.map(([value, label]) =>
      `<div class="stat"><strong>${formatNumber(value)}</strong><span>${label}</span></div>`
    ).join("")}</div>`;
  }

  function statusLabel(status) {
    return {
      achieved: "已达标",
      behind: "未达标",
      on_track: "进行中正常",
      at_risk: "进行中偏差",
      pending: "未开始"
    }[status] || status;
  }

  function formatNumber(value) {
    return Number.isFinite(value) ? Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : "—";
  }

  function renderPhases() {
    els.phaseList.innerHTML = result.phases.map(renderPhase).join("");
  }

  function renderPhase(phase) {
    const progressClass = phase.trusted ? (phase.status === "achieved" ? "good" : phase.status === "behind" ? "bad" : "") : "bad";
    const progressWidth = phase.progressPercent === null ? 0 : Math.min(100, phase.progressPercent);
    const lockedAchieved = phase.locked && phase.status === "achieved";
    const lockedBehind = phase.locked && phase.status === "behind";
    const lockText = lockedAchieved ? "取消锁定" : "锁定达标";
    const behindText = lockedBehind ? "取消锁定" : "锁定未达标";
    return `<article class="phase-card" data-phase-id="${escapeHtml(phase.id)}">
      <div class="phase-head">
        <div>
          <div class="phase-title">
            <strong>${escapeHtml(phase.name)}</strong>
            <span>${escapeHtml(phase.id)}</span>
            <span class="badge ${phase.status}">${statusLabel(phase.status)}</span>
            ${phase.locked ? `<span class="badge locked">${phase.lockMismatch ? "锁定冲突" : "已锁定"}</span>` : ""}
            ${phase.trusted ? "" : `<span class="badge untrusted">结论不可信</span>`}
          </div>
          <div class="phase-meta">${escapeHtml(phase.startPeriod)} 至 ${escapeHtml(phase.endPeriod)} · 前置：${
            phase.prerequisites.map(escapeHtml).join("、") || "无"
          } · 累计链路：${phase.lineage.map(escapeHtml).join(" → ")}</div>
        </div>
        <div>
          <button data-action="lock-achieved">${lockText}</button>
          <button data-action="lock-behind">${behindText}</button>
        </div>
      </div>
      <div class="phase-content">
        <div class="metric-row">
          <div class="metric"><span>本阶段目标</span><strong>${formatNumber(phase.ownTarget)}</strong></div>
          <div class="metric"><span>本阶段实际</span><strong>${formatNumber(phase.ownActual)}</strong></div>
          <div class="metric"><span>累计偏差</span><strong style="color:${phase.cumulativeGap >= 0 ? "var(--green)" : "var(--red)"}">${formatSigned(phase.cumulativeGap)}</strong></div>
          <div class="metric"><span>未达标缺口</span><strong>${formatNumber(phase.shortfall)}</strong></div>
        </div>
        <div class="progress ${progressClass}"><i style="width:${progressWidth}%"></i></div>
        <div class="phase-meta">累计实际 ${formatNumber(phase.cumulativeActual)} / 累计目标 ${formatNumber(phase.cumulativeTarget)}
          （${phase.progressPercent === null ? "无目标" : phase.progressPercent.toFixed(1) + "%"}）</div>
        ${renderEditors(phase)}
        ${phase.locked && phase.lockMismatch
          ? `<div class="issue-row warning"><span class="badge at_risk">人工覆盖</span><div>当前达标结论已手动锁定；系统按输入重新推导的结论为“${statusLabel(phase.derivedStatus)}”。<div class="issue-basis">依据：锁定只替换本阶段展示结论，不改变目标、实际结果或其他阶段的累计推导。</div></div></div>`
          : ""}
        ${renderDeviationSources(phase)}
        ${renderPhaseMeasures(phase)}
        ${renderInvalidReasons(phase)}
      </div>
    </article>`;
  }

  function renderEditors(phase) {
    const phaseMeasures = (engine.measuresByPhase.get(phase.id) || [])
      .filter((measure) => !engine.invalidMeasures.has(measure.id));
    const currentActual = phaseMeasures.length
      ? getCurrentActual(phaseMeasures[0].id, result.cutoffPeriod)
      : "";
    return `<div class="editors">
      <div class="field"><label>调整目标减排量</label><input type="number" step="0.01" value="${phase.ownTarget}" data-field="target"></div>
      <div class="field"><label>措施</label><select data-field="measure">
        ${phaseMeasures.length
          ? phaseMeasures.map((measure) =>
              `<option value="${escapeHtml(measure.id)}">${escapeHtml(measure.name || measure.id)}</option>`
            ).join("")
          : "<option value=''>无可编辑措施</option>"}
      </select></div>
      <div class="field"><label>考核期实际值</label><input type="number" step="0.01" value="${escapeHtml(currentActual)}" data-field="actual"></div>
      <button class="primary" data-action="save-actual">修正结果</button>
      <button data-action="save-target">更新目标</button>
    </div>`;
  }

  function renderDeviationSources(phase) {
    const rows = phase.deviationSources.map((source) => `<div class="source-row">
      <strong>${escapeHtml(source.phaseName)}</strong>
      <span>目标 ${formatNumber(source.target)}</span>
      <span>实际 ${formatNumber(source.actual)}</span>
      <span style="color:${source.gapToTarget >= 0 ? "var(--green)" : "var(--red)"}">
        目标偏差 ${formatSigned(source.gapToTarget)}
      </span>
      <span style="color:${source.gapToPlan >= 0 ? "var(--green)" : "var(--red)"}">
        计划偏差 ${formatSigned(source.gapToPlan)}
      </span>
    </div>`).join("");
    return `<div class="side-section"><strong>偏差来源（沿前置链累计）</strong>${rows}</div>`;
  }

  function renderPhaseMeasures(phase) {
    const rows = phase.measures.map((measure) => `<div class="measure-row">
      <span><strong>${escapeHtml(measure.name)}</strong>
        ${measure.excluded ? `<span class="badge locked">已排除</span>` : ""}
        <br><small>${escapeHtml(measure.id)}</small>
      </span>
      <span>计划 ${formatNumber(measure.planned)}</span>
      <span>${measure.excluded ? "原始实际 " : "实际 "}${formatNumber(measure.actual)}</span>
      <span style="color:${measure.gapToPlan >= 0 ? "var(--green)" : "var(--red)"}">
        ${measure.excluded ? "不计入" : formatSigned(measure.gapToPlan)}
      </span>
      <button data-action="toggle-exclude" data-measure-id="${escapeHtml(measure.id)}">
        ${engine.excluded.has(measure.id) ? "恢复" : "排除"}
      </button>
    </div>`).join("");
    return `<div class="side-section"><strong>措施结果</strong><div class="measure-list">${rows || `<div class="measure-row"><span class="empty">当前阶段没有参与计算的措施。</span></div>`}</div></div>`;
  }

  function renderInvalidReasons(phase) {
    if (phase.trusted) return "";
    return `<div class="side-section"><strong>不可信依据</strong>${phase.invalidReasons.map((reason) =>
      `<div class="issue-row error"><span class="badge untrusted">错误</span><div>${escapeHtml(reason.message)}<div class="issue-basis">${escapeHtml(reason.basis)}</div></div></div>`
    ).join("")}</div>`;
  }

  function renderIssues() {
    if (!result.issues.length) {
      els.issueList.innerHTML = `<div class="empty">未发现数据完整性错误或警告。</div>`;
      return;
    }
    els.issueList.innerHTML = result.issues.map((item) => `<div class="issue-row ${item.severity}">
      <span class="badge ${item.severity === "error" ? "untrusted" : "at_risk"}">
        ${item.severity === "error" ? "错误" : "警告"}
      </span>
      <div>${escapeHtml(item.message)}<div class="issue-basis">依据：${escapeHtml(item.basis)}</div></div>
    </div>`).join("");
  }

  function renderAffected() {
    if (!affected.length) {
      els.affectedList.innerHTML = `<span class="empty">尚未发生调整；阶段链路会在更新后标出受影响范围。</span>`;
      return;
    }
    els.affectedList.innerHTML = `<div class="affected-list">${affected.map((id) =>
      `<span class="badge">${escapeHtml(id)}</span>`
    ).join("")}</div>`;
  }

  function handleClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const card = event.target.closest(".phase-card");
    const phaseId = card?.dataset.phaseId;
    const action = button.dataset.action;
    try {
      if (action === "save-target") {
        const value = card.querySelector('[data-field="target"]').value;
        ({ analysis: result, affected } = engine.setPhaseTarget(phaseId, value));
      } else if (action === "save-actual") {
        const measureId = card.querySelector('[data-field="measure"]').value;
        const value = card.querySelector('[data-field="actual"]').value;
        ({ analysis: result, affected } = engine.setMeasureActual(measureId, result.cutoffPeriod, value));
      } else if (action === "toggle-exclude") {
        const measureId = button.dataset.measureId;
        ({ analysis: result, affected } = engine.setMeasureExcluded(measureId, !engine.excluded.has(measureId)));
      } else if (action === "lock-achieved" || action === "lock-behind") {
        const phase = result.phases.find((item) => item.id === phaseId);
        const wanted = action === "lock-achieved" ? "achieved" : "behind";
        ({ analysis: result, affected } = engine.setPhaseLock(
          phaseId,
          phase.locked && phase.status === wanted ? null : wanted
        ));
      }
      showToast("已完成增量重推，受影响阶段已标出。", "success");
      render();
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  function handleChange(event) {
    const card = event.target.closest(".phase-card");
    if (!card) return;
    const measureSelect = card.querySelector('[data-field="measure"]');
    const actualInput = card.querySelector('[data-field="actual"]');
    if (event.target === measureSelect && measureSelect.value) {
      actualInput.value = getCurrentActual(measureSelect.value, result.cutoffPeriod) ?? "";
    }
  }

  function getCurrentActual(measureId, period) {
    const group = engine.measureGroups.get(measureId) || [];
    for (const measure of group) {
      if (measure.actuals && Object.prototype.hasOwnProperty.call(measure.actuals, period)) {
        return measure.actuals[period];
      }
    }
    return "";
  }

  function importJson() {
    try {
      const parsed = JSON.parse(els.jsonInput.value);
      if (!Array.isArray(parsed.phases) || !Array.isArray(parsed.measures)) {
        if (!parsed.plan || !Array.isArray(parsed.plan.phases) || !Array.isArray(parsed.plan.measures)) {
          throw new Error("JSON 必须直接包含 phases/measures，或在 plan 字段中包含它们。");
        }
      }
      const importedPlan = Array.isArray(parsed.phases) ? parsed : parsed.plan;
      const importedExcluded = Array.isArray(parsed.excludedMeasureIds) ? parsed.excludedMeasureIds : [];
      plan = importedPlan;
      engine = new PlanEngine.PlanEngine(plan, { excludedMeasureIds: importedExcluded });
      if (parsed.locks && typeof parsed.locks === "object" && !Array.isArray(parsed.locks)) {
        Object.assign(engine.locks, parsed.locks);
      }
      selectedCutoff = engine.lastCutoff;
      affected = engine.phaseIds.slice();
      showToast("数据已载入；结构变化已按完整重推处理。", "success");
      render();
    } catch (error) {
      showToast(`导入失败：${error.message}`, "error");
    }
  }

  function exportJson() {
    const payload = {
      plan: engine.data,
      locks: engine.locks,
      excludedMeasureIds: Array.from(engine.excluded),
      affectedByLastAdjustment: affected,
      analysis: result
    };
    els.jsonInput.value = JSON.stringify(payload, null, 2);
    showToast("当前数据、设置和分析结果已导出到文本框。", "success");
  }

  function resetDemo() {
    plan = JSON.parse(JSON.stringify(window.SamplePlan));
    engine = new PlanEngine.PlanEngine(plan);
    selectedCutoff = engine.lastCutoff;
    affected = engine.phaseIds.slice();
    els.jsonInput.value = JSON.stringify(plan, null, 2);
    showToast("已恢复内置演示数据。", "success");
    render();
  }

  function showToast(message, type) {
    els.toast.textContent = message;
    els.toast.className = `toast ${type}`;
  }

  function stableEqual(left, right) {
    return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
  }

  function normalize(value) {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") {
      return Object.keys(value).sort().reduce((acc, key) => {
        if (key !== "cutoffIndex" && key !== "cutoffPeriod") acc[key] = normalize(value[key]);
        return acc;
      }, {});
    }
    return value;
  }

  function formatSigned(value) {
    const text = formatNumber(Math.abs(value));
    if (value > 0) return `+${text}`;
    if (value < 0) return `-${text}`;
    return text;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }
})();
