(function startApp() {
  "use strict";

  const STORAGE_KEY = "activity-context-workbench:v1";
  const engine = new ResumeEngine();
  const $ = (id) => document.getElementById(id);

  let state = loadState();
  let currentAnalysis = null;
  let analysisNow = new Date();

  const elements = {
    nowClock: $("nowClock"),
    activityCount: $("activityCount"),
    activityList: $("activityList"),
    activityForm: $("activityForm"),
    activityName: $("activityName"),
    activityStatus: $("activityStatus"),
    activityMeta: $("activityMeta"),
    activityTitle: $("activityTitle"),
    activityDescription: $("activityDescription"),
    latestProgress: $("latestProgress"),
    warningBanner: $("warningBanner"),
    resumeMode: $("resumeMode"),
    resumeList: $("resumeList"),
    issueCount: $("issueCount"),
    issueList: $("issueList"),
    conflictCount: $("conflictCount"),
    conflictList: $("conflictList"),
    entryCount: $("entryCount"),
    entryList: $("entryList"),
    entryForm: $("entryForm"),
    entryId: $("entryId"),
    entryTitle: $("entryTitle"),
    entryType: $("entryType"),
    entrySource: $("entrySource"),
    entryExpiresAt: $("entryExpiresAt"),
    entryContent: $("entryContent"),
    entryDependencies: $("entryDependencies"),
    saveEntry: $("saveEntry"),
    cancelEdit: $("cancelEdit"),
    conflictForm: $("conflictForm"),
    conflictA: $("conflictA"),
    conflictB: $("conflictB"),
    conflictReason: $("conflictReason")
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (error) {
      console.warn("本地数据读取失败，使用示例数据。", error);
    }
    return createSeedState();
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function makeId(prefix) {
    if (window.crypto && crypto.randomUUID) return prefix + crypto.randomUUID().slice(0, 8);
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function formatDateTime(value) {
    if (!value) return "长期有效";
    return new Date(value).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function toDatetimeLocalValue(value) {
    if (!value) return "";
    const date = new Date(value);
    const pad = (number) => String(number).padStart(2, "0");
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate())
    ].join("-") + "T" + [pad(date.getHours()), pad(date.getMinutes())].join(":");
  }

  function getActivityId() {
    if (!state.activities.some((activity) => activity.id === state.selectedActivityId)) {
      state.selectedActivityId = state.activities[0]?.id || null;
    }
    return state.selectedActivityId;
  }

  function getActivity() {
    return state.activities.find((activity) => activity.id === getActivityId()) || null;
  }

  function renderActivities() {
    elements.activityCount.textContent = state.activities.length;
    elements.activityList.innerHTML = state.activities.map((activity) => {
      const result = engine.analyze(state, activity.id, analysisNow);
      const statusClass = result.status === "ready" ? "" : result.status;
      const statusText = {
        ready: "可恢复",
        blocked: "待裁决",
        untrusted: "不可信",
        missing: "缺失"
      }[result.status] || result.status;
      return `
        <button type="button" class="activity-item ${activity.id === getActivityId() ? "active" : ""}" data-activity-id="${escapeHtml(activity.id)}">
          <strong>${escapeHtml(activity.name)}</strong>
          <span class="activity-status-dot"><span class="dot ${escapeHtml(statusClass)}"></span>${statusText}</span>
          <small>${escapeHtml(activity.description || "暂无说明")}</small>
        </button>
      `;
    }).join("");
  }

  function renderHeader(result) {
    const activity = result.activity;
    elements.activityTitle.textContent = activity.name;
    elements.activityDescription.textContent = activity.description || "暂无活动说明";
    elements.activityStatus.className = "badge " + result.status;
    elements.activityStatus.textContent = {
      ready: "可恢复",
      blocked: "等待冲突裁决",
      untrusted: "不可信",
      missing: "活动缺失"
    }[result.status] || result.status;
    elements.activityMeta.textContent =
      `${result.stats.total} 条上下文 · ${result.stats.active} 条有效 · ${result.stats.expired} 条已过期 · ${result.stats.dueSoon} 条临期`;
    elements.latestProgress.innerHTML = result.latestProgress
      ? `<strong>最近进度</strong><br>${escapeHtml(result.latestProgress.title)}<br><small class="muted">${escapeHtml(result.latestProgress.source || "未注明来源")} · ${formatDateTime(result.latestProgress.updatedAt)}</small>`
      : `<strong>最近进度</strong><br><span class="muted">尚无进度条目</span>`;

    elements.warningBanner.className = "warning-banner";
    if (result.status === "untrusted") {
      elements.warningBanner.classList.add("danger");
      elements.warningBanner.textContent =
        "该活动存在缺失依赖或依赖闭环。系统不会静默跳过这些条目，也不会给出续接结论；请先修正下方红色诊断。";
    } else if (result.status === "blocked") {
      elements.warningBanner.textContent =
        `有 ${result.openConflictCount} 组冲突尚未裁决。双方内容均已保留，完成裁决前不推导续接顺序。`;
    } else {
      elements.warningBanner.classList.add("hidden");
      elements.warningBanner.textContent = "";
    }
  }

  function renderResume(result) {
    elements.resumeMode.textContent = result.canResume ? `${result.resume.length} 步` : "暂停";
    if (!result.canResume) {
      const reason = result.status === "untrusted"
        ? "依赖关系不可信，暂不能生成续接结论。"
        : "冲突尚未裁决，暂不能生成续接结论。";
      elements.resumeList.innerHTML = `<div class="empty-state">${escapeHtml(reason)}</div>`;
      return;
    }
    if (!result.resume.length) {
      elements.resumeList.innerHTML = `<div class="empty-state">当前没有有效条目。可以新增素材、待办、想法或进度。</div>`;
      return;
    }
    elements.resumeList.innerHTML = result.resume.map((step) => `
      <article class="resume-step">
        <div class="step-number">${step.order}</div>
        <div>
          <h3>${escapeHtml(step.action)}：${escapeHtml(step.title)}</h3>
          <p>${escapeHtml(step.reason)}</p>
          <div class="tag-row">
            <span class="tag">${escapeHtml(step.typeLabel)}</span>
            <span class="tag ${escapeHtml(step.urgency)}">${escapeHtml(step.freshness)}</span>
            <span class="tag">来源：${escapeHtml(step.source || "未注明")}</span>
          </div>
        </div>
      </article>
    `).join("");
  }

  function renderIssues(result) {
    elements.issueCount.textContent = result.issues.length;
    if (!result.issues.length) {
      elements.issueList.innerHTML = `<div class="empty-state">暂无缺依赖、闭环或冲突记录异常。</div>`;
      return;
    }
    elements.issueList.innerHTML = result.issues.map((issue) => `
      <article class="issue-card">
        <strong>${escapeHtml(issue.code)}</strong>
        <p>${escapeHtml(issue.message)}</p>
        <p>涉及条目：${issue.involvedEntryIds.map(escapeHtml).join("、")}</p>
      </article>
    `).join("");
  }

  function conflictSideHtml(entry, superseded, label) {
    if (!entry) {
      return `<div class="conflict-side"><strong>${label}</strong><p class="entry-detail">条目已缺失。</p></div>`;
    }
    return `
      <div class="conflict-side ${superseded ? "superseded" : ""}">
        <strong>${label}：${escapeHtml(entry.title)}</strong>
        <p class="entry-detail">${escapeHtml(entry.content || "无内容")}</p>
        <div class="tag-row">
          <span class="tag ${superseded ? "superseded" : ""}">${superseded ? "裁决不采用" : "保留有效"}</span>
          <span class="tag">${escapeHtml(entry.source || "未注明来源")}</span>
        </div>
      </div>
    `;
  }

  function resolutionText(conflict) {
    return {
      "choose-a": "已裁决：A 有效，B 作为历史上下文保留但不参与推导。",
      "choose-b": "已裁决：B 有效，A 作为历史上下文保留但不参与推导。",
      "keep-both": "已裁决：双方在不同前提下并存，均参与推导。"
    }[conflict.resolution] || "";
  }

  function renderConflicts(result) {
    elements.conflictCount.textContent = result.conflicts.length;
    if (!result.conflicts.length) {
      elements.conflictList.innerHTML = `<div class="empty-state">暂无冲突。发现上下文相互矛盾时，可在下方显式标记。</div>`;
      return;
    }

    elements.conflictList.innerHTML = result.conflicts.map((conflict) => {
      const aSuperseded = conflict.resolution === "choose-b";
      const bSuperseded = conflict.resolution === "choose-a";
      const stateClass = conflict.integrityError ? "untrusted" : conflict.isOpen ? "blocked" : "";
      return `
        <article class="conflict-card ${stateClass}">
          <div>
            <strong>${escapeHtml(conflict.reason)}</strong>
            ${conflict.resolution
              ? `<div class="resolution-note">${escapeHtml(resolutionText(conflict))}</div>`
              : `<span class="tag blocked">未裁决，续接暂停</span>`}
          </div>
          <div class="conflict-pair">
            ${conflictSideHtml(conflict.entryA, aSuperseded, "A")}
            <div class="vs">VS</div>
            ${conflictSideHtml(conflict.entryB, bSuperseded, "B")}
          </div>
          <div class="conflict-actions">
            ${conflict.isOpen
              ? `<button type="button" class="tiny" data-resolve="${escapeHtml(conflict.id)}" data-choice="choose-a">裁决 A 有效</button>
                 <button type="button" class="tiny" data-resolve="${escapeHtml(conflict.id)}" data-choice="choose-b">裁决 B 有效</button>
                 <button type="button" class="tiny secondary" data-resolve="${escapeHtml(conflict.id)}" data-choice="keep-both">双方并存</button>`
              : `<button type="button" class="tiny secondary" data-reopen-conflict="${escapeHtml(conflict.id)}">重新打开裁决</button>`}
          </div>
        </article>
      `;
    }).join("");
  }

  function renderEntryCard(entry) {
    const auditState = entry.auditState;
    const tags = [
      `<span class="tag">${escapeHtml(entry.typeLabel)}</span>`,
      `<span class="tag ${escapeHtml(entry.urgency)}">${escapeHtml(entry.freshness)}</span>`,
      `<span class="tag">来源：${escapeHtml(entry.source || "未注明")}</span>`,
      `<span class="tag ${escapeHtml(auditState)}">${{
        ready: "有效",
        blocked: "冲突待裁决",
        untrusted: "依赖不可信",
        superseded: "已不采用"
      }[auditState] || auditState}</span>`
    ];
    const revisions = (entry.revisionHistory || []).slice(-2).map((revision) =>
      `<div class="revision">修正于 ${formatDateTime(revision.at)}：${escapeHtml(revision.note || "内容或属性已更新")}</div>`
    ).join("");
    return `
      <article class="entry-card ${escapeHtml(auditState)}">
        <div class="entry-heading">
          <div>
            <h3>${escapeHtml(entry.title)}</h3>
            <div class="entry-meta">${tags.join("")}</div>
          </div>
          <div class="entry-actions">
            <button type="button" class="tiny secondary" data-edit-entry="${escapeHtml(entry.id)}">修正</button>
            ${entry.status === "active"
              ? `<button type="button" class="tiny secondary" data-retire-entry="${escapeHtml(entry.id)}">标记不采用</button>`
              : `<button type="button" class="tiny" data-restore-entry="${escapeHtml(entry.id)}">恢复有效</button>`}
          </div>
        </div>
        <p class="entry-detail">${escapeHtml(entry.content || "无内容")}</p>
        <div class="dependency-line">
          依赖：${entry.dependencyTitles.length ? entry.dependencyTitles.map(escapeHtml).join("、") : "无"}
          · 失效：${formatDateTime(entry.expiresAt)}
          · 更新：${formatDateTime(entry.updatedAt)}
        </div>
        ${revisions}
      </article>
    `;
  }

  function renderEntries(result) {
    elements.entryCount.textContent = result.entries.length;
    const stateRank = { untrusted: 0, blocked: 1, ready: 2, superseded: 3 };
    const sorted = [...result.entries].sort((a, b) =>
      (stateRank[a.auditState] ?? 9) - (stateRank[b.auditState] ?? 9)
      || b.updatedAtTime - a.updatedAtTime
    );
    elements.entryList.innerHTML = sorted.length
      ? sorted.map((entry) => renderEntryCard(entry)).join("")
      : `<div class="empty-state">这个活动还没有上下文条目。</div>`;

    const editingId = elements.entryId.value;
    const options = result.entries
      .filter((entry) => entry.id !== editingId)
      .map((entry) => {
        const disabled = entry.status !== "active" ? " disabled" : "";
        const suffix = entry.status !== "active" ? "（已不采用）" : "";
        return `<option value="${escapeHtml(entry.id)}"${disabled}>${escapeHtml(entry.title)}${suffix}</option>`;
      })
      .join("");
    elements.entryDependencies.innerHTML = options;
    const conflictOptions = result.entries
      .filter((entry) => entry.status === "active")
      .map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.title)}</option>`)
      .join("");
    elements.conflictA.innerHTML = conflictOptions;
    elements.conflictB.innerHTML = conflictOptions;
  }

  function resetEntryForm() {
    elements.entryForm.reset();
    elements.entryId.value = "";
    elements.saveEntry.textContent = "保存条目";
    elements.cancelEdit.classList.add("hidden");
  }

  function fillEntryForm(entry) {
    elements.entryId.value = entry.id;
    elements.entryTitle.value = entry.title;
    elements.entryType.value = entry.type;
    elements.entrySource.value = entry.source || "";
    elements.entryExpiresAt.value = toDatetimeLocalValue(entry.expiresAt);
    elements.entryContent.value = entry.content || "";
    Array.from(elements.entryDependencies.options).forEach((option) => {
      option.selected = entry.dependsOn.includes(option.value);
    });
    elements.saveEntry.textContent = "保存修正";
    elements.cancelEdit.classList.remove("hidden");
  }

  function render() {
    const activity = getActivity();
    elements.nowClock.textContent = new Date().toLocaleString("zh-CN");
    renderActivities();
    if (!activity) {
      currentAnalysis = null;
      elements.activityTitle.textContent = "暂无活动";
      elements.activityDescription.textContent = "请先新增一项活动。";
      elements.activityStatus.textContent = "";
      elements.activityMeta.textContent = "";
      elements.latestProgress.innerHTML = "";
      elements.warningBanner.className = "warning-banner hidden";
      elements.resumeList.innerHTML = `<div class="empty-state">请先新增活动。</div>`;
      elements.issueList.innerHTML = "";
      elements.conflictList.innerHTML = "";
      elements.entryList.innerHTML = "";
      return;
    }
    currentAnalysis = engine.analyze(state, activity.id, analysisNow);
    renderHeader(currentAnalysis);
    renderResume(currentAnalysis);
    renderIssues(currentAnalysis);
    renderConflicts(currentAnalysis);
    renderEntries(currentAnalysis);
  }

  function updateStateAndRender(mutator) {
    mutator();
    persist();
    render();
  }

  function selectedValues(select) {
    return Array.from(select.selectedOptions).map((option) => option.value);
  }

  elements.activityForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = elements.activityName.value.trim();
    if (!name) return;
    const activity = {
      id: makeId("a-"),
      name,
      description: "",
      createdAt: nowIso()
    };
    state.activities.push(activity);
    state.selectedActivityId = activity.id;
    persist();
    elements.activityForm.reset();
    render();
  });

  elements.activityList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-activity-id]");
    if (!button) return;
    state.selectedActivityId = button.dataset.activityId;
    persist();
    resetEntryForm();
    render();
  });

  elements.entryForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const activityId = getActivityId();
    if (!activityId) return;
    const editingId = elements.entryId.value;
    const dependsOn = selectedValues(elements.entryDependencies).filter((id) => id !== editingId);
    const expiresAt = elements.entryExpiresAt.value
      ? new Date(elements.entryExpiresAt.value).toISOString()
      : null;

    updateStateAndRender(() => {
      if (editingId) {
        const entry = state.entries.find((item) => item.id === editingId);
        entry.revisionHistory = entry.revisionHistory || [];
        entry.revisionHistory.push({
          at: nowIso(),
          note: "修正标题、类型、来源、时效、内容或依赖"
        });
        Object.assign(entry, {
          title: elements.entryTitle.value.trim(),
          type: elements.entryType.value,
          source: elements.entrySource.value.trim(),
          content: elements.entryContent.value.trim(),
          expiresAt,
          dependsOn,
          updatedAt: nowIso()
        });
        engine.invalidateEntries(state, [editingId]);
      } else {
        const entry = {
          id: makeId("e-"),
          activityId,
          type: elements.entryType.value,
          title: elements.entryTitle.value.trim(),
          source: elements.entrySource.value.trim(),
          content: elements.entryContent.value.trim(),
          status: "active",
          expiresAt,
          updatedAt: nowIso(),
          dependsOn,
          revisionHistory: []
        };
        state.entries.push(entry);
        engine.invalidateEntries(state, [entry.id, ...entry.dependsOn]);
      }
    });
    resetEntryForm();
  });

  elements.cancelEdit.addEventListener("click", () => {
    resetEntryForm();
    render();
  });

  elements.entryList.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-entry]");
    const retireButton = event.target.closest("[data-retire-entry]");
    const restoreButton = event.target.closest("[data-restore-entry]");

    if (editButton) {
      const entry = state.entries.find((item) => item.id === editButton.dataset.editEntry);
      if (entry) {
        render();
        fillEntryForm(entry);
        elements.entryTitle.focus();
      }
      return;
    }

    if (retireButton || restoreButton) {
      const entryId = retireButton?.dataset.retireEntry || restoreButton?.dataset.restoreEntry;
      updateStateAndRender(() => {
        const entry = state.entries.find((item) => item.id === entryId);
        entry.status = retireButton ? "superseded" : "active";
        entry.updatedAt = nowIso();
        entry.revisionHistory = entry.revisionHistory || [];
        entry.revisionHistory.push({
          at: nowIso(),
          note: retireButton ? "人工标记不采用" : "人工恢复有效"
        });
        engine.invalidateEntries(state, [entryId]);
      });
    }
  });

  elements.conflictForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const aId = elements.conflictA.value;
    const bId = elements.conflictB.value;
    if (aId === bId) {
      alert("请选择两条不同的上下文条目。");
      return;
    }
    const activityId = getActivityId();
    const duplicate = state.conflicts.some((conflict) =>
      conflict.activityId === activityId
      && !conflict.resolution
      && [conflict.entryAId, conflict.entryBId].sort().join() === [aId, bId].sort().join()
    );
    if (duplicate) {
      alert("这两条上下文已经存在未裁决冲突。");
      return;
    }
    const conflict = {
      id: makeId("c-"),
      activityId,
      entryAId: aId,
      entryBId: bId,
      reason: elements.conflictReason.value.trim(),
      createdAt: nowIso(),
      resolution: null,
      resolvedAt: null
    };
    updateStateAndRender(() => {
      state.conflicts.push(conflict);
      engine.invalidate(activityId);
    });
    elements.conflictForm.reset();
  });

  function setConflictResolution(conflictId, resolution) {
    updateStateAndRender(() => {
      const conflict = state.conflicts.find((item) => item.id === conflictId);
      const a = state.entries.find((entry) => entry.id === conflict.entryAId);
      const b = state.entries.find((entry) => entry.id === conflict.entryBId);
      conflict.resolution = resolution;
      conflict.resolvedAt = nowIso();
      if (a) a.status = resolution === "choose-b" ? "superseded" : "active";
      if (b) b.status = resolution === "choose-a" ? "superseded" : "active";
      [a, b].filter(Boolean).forEach((entry) => {
        entry.updatedAt = nowIso();
        engine.invalidateEntries(state, [entry.id]);
      });
      engine.invalidateConflicts(state, [conflictId]);
    });
  }

  elements.conflictList.addEventListener("click", (event) => {
    const resolveButton = event.target.closest("[data-resolve]");
    const reopenButton = event.target.closest("[data-reopen-conflict]");
    if (resolveButton) {
      setConflictResolution(resolveButton.dataset.resolve, resolveButton.dataset.choice);
    } else if (reopenButton) {
      updateStateAndRender(() => {
        const conflict = state.conflicts.find((item) => item.id === reopenButton.dataset.reopenConflict);
        const a = state.entries.find((entry) => entry.id === conflict.entryAId);
        const b = state.entries.find((entry) => entry.id === conflict.entryBId);
        conflict.resolution = null;
        conflict.resolvedAt = null;
        if (a) a.status = "active";
        if (b) b.status = "active";
        engine.invalidateEntries(state, [conflict.entryAId, conflict.entryBId]);
        engine.invalidateConflicts(state, [conflict.id]);
      });
    }
  });

  $("refreshNow").addEventListener("click", () => {
    analysisNow = new Date();
    engine.clearCache();
    render();
  });

  $("resetDemo").addEventListener("click", () => {
    if (!confirm("将清空当前浏览器中的修改并恢复示例数据，是否继续？")) return;
    state = createSeedState();
    analysisNow = new Date();
    engine.clearCache();
    persist();
    resetEntryForm();
    render();
  });

  render();
})();
