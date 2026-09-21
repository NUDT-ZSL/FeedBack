(function () {
  "use strict";

  const Engine = window.ContextEngine;
  const STORAGE_KEY = "activity-context-recovery:v1";
  const kindLabels = { material: "素材", todo: "待办", idea: "想法", progress: "进度" };
  const statusLabels = { active: "有效", completed: "完成", cancelled: "取消", retired: "归档" };

  let state = loadState();
  let selectedActivityId = state.activityOrder[0];

  const $ = (id) => document.getElementById(id);

  function now() { return new Date().toISOString(); }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (error) {
      console.warn("读取本地数据失败，已载入示例", error);
    }
    return seedDemo();
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function currentAnalysis() {
    const full = Engine.deriveAll(state, now());
    return full.activities[selectedActivityId];
  }

  function toast(message) {
    const box = $("toast");
    box.textContent = message;
    box.hidden = false;
    clearTimeout(box.timer);
    box.timer = setTimeout(() => { box.hidden = true; }, 2200);
  }

  function seedDemo() {
    const s = Engine.createState("2026-09-22T08:30:00.000Z");
    Engine.addActivity(s, { id: "launch", title: "发布页改版", goal: "本周恢复设计评审并确认上线口径" });
    Engine.addActivity(s, { id: "report", title: "季度复盘材料", goal: "补齐冲突数据口径" });
    Engine.addActivity(s, { id: "trip", title: "出差准备", goal: "找出不可信的依赖链" });

    Engine.addEntry(s, {
      id: "brief", activityId: "launch", kind: "material",
      title: "新版核心卖点", source: "产品文档",
      content: "强调离线可用、快速恢复上下文、冲突必须裁决。",
      validUntil: "2026-09-23T18:00:00.000Z"
    });
    Engine.addEntry(s, {
      id: "wire", activityId: "launch", kind: "todo",
      title: "更新首屏线框", source: "设计会议", dependsOn: ["brief"],
      content: "把恢复顺序放到首屏第二屏。"
    });
    Engine.addEntry(s, {
      id: "checkpoint", activityId: "launch", kind: "progress",
      title: "已完成旧版文案走查", source: "手动记录",
      content: "旧结构中的导航问题已记录，等待新卖点替换。"
    });

    Engine.addEntry(s, { id: "metric-a", activityId: "report", kind: "material", title: "口径 A：按打开活动统计", source: "旧表格" });
    Engine.addEntry(s, { id: "metric-b", activityId: "report", kind: "material", title: "口径 B：按完成活动统计", source: "新导出" });
    Engine.addConflict(s, { entryAId: "metric-a", entryBId: "metric-b", note: "两个分母不一致" });

    Engine.addEntry(s, { id: "loop-a", activityId: "trip", kind: "todo", title: "订酒店", dependsOn: ["loop-c"] });
    Engine.addEntry(s, { id: "loop-b", activityId: "trip", kind: "todo", title: "提交审批", dependsOn: ["loop-a"] });
    Engine.addEntry(s, { id: "loop-c", activityId: "trip", kind: "todo", title: "确认行程", dependsOn: ["loop-b"] });
    Engine.addEntry(s, { id: "missing", activityId: "trip", kind: "material", title: "会议地址截图", dependsOn: ["not-uploaded"] });
    return s;
  }

  function render() {
    renderActivities();
    const activity = state.activities[selectedActivityId];
    if (!activity) return;
    const analysis = currentAnalysis();
    $("activityTitle").textContent = activity.title;
    $("activityGoal").textContent = activity.goal || "尚未填写活动目标";
    renderBanner(analysis);
    renderRecovery(analysis);
    renderConflicts(analysis);
    renderEntries(analysis);
    persist();
  }

  function renderActivities() {
    const analyses = Engine.deriveAll(state, now()).activities;
    $("activityList").innerHTML = state.activityOrder.map((id) => {
      const activity = state.activities[id];
      const result = analyses[id];
      const count = Object.values(state.entries).filter((entry) => entry.activityId === id).length;
      const statusText = {
        ready: "可续接",
        conflict: `${result.openConflicts.length} 个冲突`,
        untrusted: "不可信"
      }[result.status];
      return `
        <button class="activity-item ${id === selectedActivityId ? "active" : ""}" data-activity="${esc(id)}">
          <strong>${esc(activity.title)}</strong>
          <span>${count} 条上下文 · ${esc(statusText)}</span>
        </button>`;
    }).join("");
  }

  function renderBanner(analysis) {
    const banner = $("statusBanner");
    banner.className = `status-banner ${analysis.status}`;
    const title = {
      ready: "上下文可信：可以按下方顺序续接",
      conflict: "存在未裁决冲突：暂不推导最终续接结论",
      untrusted: "活动不可信：依赖缺失、失效或形成闭环"
    }[analysis.status];
    const reasons = analysis.reasons.map((reason) => `<li>${esc(reason.message)}</li>`).join("");
    const conflicts = analysis.openConflicts.map((conflict) =>
      `<li>冲突待裁决：${esc(entryTitle(conflict.entryAId))} / ${esc(entryTitle(conflict.entryBId))}</li>`).join("");
    const warnings = analysis.warnings.map((warning) => `<li>${esc(warning)}</li>`).join("");
    banner.innerHTML = `<strong>${title}</strong><ul>${reasons}${conflicts}${warnings}</ul>`;
  }

  function entryTitle(id) {
    return state.entries[id] ? state.entries[id].title : id;
  }

  function renderRecovery(analysis) {
    $("anchors").innerHTML = analysis.anchors.length
      ? analysis.anchors.map((item) => `
        <div class="anchor">
          <strong>进度锚点：${esc(item.entry.title)}</strong>
          <span>${esc(item.entry.content || item.entry.source)} · ${esc(item.freshness.label)}</span>
        </div>`).join("")
      : `<div class="empty">暂无当前进度锚点</div>`;

    if (analysis.status !== "ready") {
      $("resumeSteps").innerHTML = `<div class="empty">请先处理上方冲突或不可信依赖，系统再给出完整恢复顺序。</div>`;
      return;
    }
    $("resumeSteps").innerHTML = analysis.steps.length
      ? analysis.steps.map((item) => `
        <li>
          <span class="step-number">${item.step}</span>
          <div><div class="step-title">${esc(item.entry.title)}</div>
          <div class="step-meta">${esc(kindLabels[item.entry.kind])} · ${esc(item.entry.source)} · ${esc(depText(item.entry))}</div></div>
          <span class="badge ${esc(item.freshness.level)}">${esc(item.freshness.label)}</span>
        </li>`).join("")
      : `<div class="empty">没有待执行线索，可新增待办或临时想法。</div>`;
  }

  function depText(entry) {
    if (!entry.dependsOn.length) return "无前置依赖";
    return "依赖：" + entry.dependsOn.map((id) => state.entries[id] ? state.entries[id].title : `缺失(${id})`).join("、");
  }

  function renderConflicts(analysis) {
    const conflicts = Object.values(state.conflicts)
      .filter((conflict) => conflict.activityId === selectedActivityId)
      .sort((a, b) => Number(a.status === "resolved") - Number(b.status === "resolved"));
    if (!conflicts.length) {
      $("conflicts").innerHTML = `<div class="empty">当前没有登记的矛盾上下文。</div>`;
      return;
    }
    $("conflicts").innerHTML = conflicts.map(renderConflictCard).join("");
  }

  function renderConflictCard(conflict) {
    const a = state.entries[conflict.entryAId];
    const b = state.entries[conflict.entryBId];
    const resolution = conflict.resolution
      ? `<p class="step-meta">裁决：${esc(conflict.resolution.choice)} · ${esc(conflict.resolution.rationale || "无补充理由")}</p>`
      : "";
    const actions = conflict.status === "open"
      ? `<div class="conflict-actions">
          <button class="small-btn primary" data-resolve="${esc(conflict.id)}" data-choice="A">采用 A</button>
          <button class="small-btn primary" data-resolve="${esc(conflict.id)}" data-choice="B">采用 B</button>
          <button class="small-btn ghost" data-resolve="${esc(conflict.id)}" data-choice="both">双方成立</button>
          <button class="small-btn ghost" data-resolve="${esc(conflict.id)}" data-choice="neither">均不采用</button>
        </div>`
      : `<button class="small-btn ghost" data-reopen="${esc(conflict.id)}">重新打开冲突</button>`;
    return `
      <article class="conflict-card ${esc(conflict.status)}">
        <strong>${esc(conflict.note || "上下文相互矛盾")}</strong>
        <div class="conflict-sides">
          <div class="conflict-side">A：${esc(a.title)}<br><span class="step-meta">${esc(a.source)}</span></div>
          <div class="conflict-side">B：${esc(b.title)}<br><span class="step-meta">${esc(b.source)}</span></div>
        </div>
        ${resolution}
        ${actions}
      </article>`;
  }

  function renderEntries(analysis) {
    const conflictIds = new Set(analysis.openConflicts.flatMap((conflict) => [conflict.entryAId, conflict.entryBId]));
    const rejectedIds = new Set(analysis.rejectedEntries.map((item) => item.entry.id));
    const cards = analysis.activeEntries.map((item) => {
      const entry = item.entry;
      const reasonCodes = new Set(analysis.reasons.filter((reason) => reason.entryId === entry.id).map((reason) => reason.code));
      const badges = [
        `<span class="badge kind-${esc(entry.kind)}">${kindLabels[entry.kind]}</span>`,
        `<span class="badge ${esc(item.freshness.level)}">${esc(item.freshness.label)}</span>`,
        reasonCodes.size ? `<span class="badge danger">依赖异常</span>` : "",
        conflictIds.has(entry.id) ? `<span class="badge danger">冲突中</span>` : "",
        rejectedIds.has(entry.id) ? `<span class="badge danger">裁决否定</span>` : ""
      ].join("");
      return `
        <article class="entry-card ${conflictIds.has(entry.id) ? "blocked" : ""} ${rejectedIds.has(entry.id) ? "rejected" : ""}">
          <div class="entry-top">
            <div><div class="entry-title">${esc(entry.title)}</div>
            <div class="step-meta">${esc(entry.source)} · ${esc(statusLabels[entry.status])}</div></div>
          </div>
          <div class="entry-content">${esc(entry.content)}</div>
          <div class="badges">${badges}</div>
          <div class="deps">${esc(depText(entry))}</div>
          <div class="entry-actions">
            <button class="small-btn ghost" data-edit-entry="${esc(entry.id)}">编辑</button>
            <button class="small-btn ghost" data-mark-conflict="${esc(entry.id)}">标记冲突</button>
            <button class="small-btn ghost" data-toggle-entry="${esc(entry.id)}">${entry.status === "active" ? "归档" : "恢复有效"}</button>
          </div>
        </article>`;
    }).join("");
    $("entryGrid").innerHTML = cards || `<div class="empty">还没有上下文条目。</div>`;
  }

  function localEntries(excludeId) {
    return Object.values(state.entries)
      .filter((entry) => entry.activityId === selectedActivityId && entry.id !== excludeId)
      .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  }

  function toLocalInput(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
  }

  function openEntryDialog(entryId) {
    const entry = entryId ? state.entries[entryId] : null;
    $("entryDialogTitle").textContent = entry ? "编辑上下文" : "新增上下文";
    $("entryId").value = entry?.id || "";
    $("entryTitle").value = entry?.title || "";
    $("entryKind").value = entry?.kind || "todo";
    $("entrySource").value = entry?.source || "";
    $("entryValidUntil").value = entry ? toLocalInput(entry.validUntil) : "";
    $("entryContent").value = entry?.content || "";
    $("entryStatus").value = entry?.status || "active";
    $("entryDeps").innerHTML = state.activityOrder.map((activityId) => {
      const options = Object.values(state.entries)
        .filter((candidate) => candidate.activityId === activityId && candidate.id !== entryId)
        .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"))
        .map((candidate) => {
          const prefix = activityId === selectedActivityId ? "" : "〔跨活动〕";
          return `<option value="${esc(candidate.id)}" ${entry?.dependsOn.includes(candidate.id) ? "selected" : ""}>${esc(prefix + candidate.title)}</option>`;
        }).join("");
      return options ? `<optgroup label="${esc(state.activities[activityId].title)}">${options}</optgroup>` : "";
    }).join("");
    $("entryDialog").showModal();
  }

  function openActivityDialog() {
    const activity = state.activities[selectedActivityId];
    $("activityDialogTitle").textContent = activity ? "编辑活动" : "新建活动";
    $("activityEditId").value = activity?.id || "";
    $("activityNameInput").value = activity?.title || "";
    $("activityGoalInput").value = activity?.goal || "";
    $("activityDialog").showModal();
  }

  function saveEntryForm() {
    const id = $("entryId").value;
    const patch = {
      activityId: selectedActivityId,
      title: $("entryTitle").value,
      kind: $("entryKind").value,
      source: $("entrySource").value || "手动记录",
      validUntil: $("entryValidUntil").value ? new Date($("entryValidUntil").value).toISOString() : null,
      content: $("entryContent").value,
      dependsOn: [...$("entryDeps").selectedOptions].map((option) => option.value),
      status: $("entryStatus").value
    };
    if (id) Engine.updateEntry(state, id, patch, now());
    else Engine.addEntry(state, patch, now());
    render();
    toast("上下文已保存，续接线索已重推");
  }

  function saveActivityForm() {
    const id = $("activityEditId").value;
    const patch = { title: $("activityNameInput").value, goal: $("activityGoalInput").value };
    if (id) {
      Engine.updateActivity(state, id, patch, now());
      selectedActivityId = id;
    } else {
      const activity = Engine.addActivity(state, patch, now());
      selectedActivityId = activity.id;
    }
    render();
  }

  function bindEvents() {
    $("activityList").addEventListener("click", (event) => {
      const button = event.target.closest("[data-activity]");
      if (button) {
        selectedActivityId = button.dataset.activity;
        render();
      }
    });
    $("newActivity").addEventListener("click", () => {
      selectedActivityId = null;
      openActivityDialog();
    });
    $("editActivity").addEventListener("click", openActivityDialog);
    $("activityForm").addEventListener("submit", (event) => {
      event.preventDefault();
      saveActivityForm();
      $("activityDialog").close();
    });
    $("newEntry").addEventListener("click", () => openEntryDialog());
    $("entryForm").addEventListener("submit", (event) => {
      event.preventDefault();
      saveEntryForm();
      $("entryDialog").close();
    });

    document.body.addEventListener("click", (event) => {
      const resolve = event.target.closest("[data-resolve]");
      const reopen = event.target.closest("[data-reopen]");
      const edit = event.target.closest("[data-edit-entry]");
      const mark = event.target.closest("[data-mark-conflict]");
      const toggle = event.target.closest("[data-toggle-entry]");
      if (resolve) resolveConflictClick(resolve.dataset);
      if (reopen) reopenConflictClick(reopen.dataset.reopen);
      if (edit) openEntryDialog(edit.dataset.editEntry);
      if (mark) markConflictClick(mark.dataset.markConflict);
      if (toggle) toggleEntry(toggle.dataset.toggleEntry);
    });

    $("exportData").addEventListener("click", exportData);
    $("importData").addEventListener("click", () => $("importFile").click());
    $("importFile").addEventListener("change", importData);
    $("resetDemo").addEventListener("click", resetDemo);
  }

  function resolveConflictClick(dataset) {
    const rationale = prompt("可填写裁决理由（可留空）", "") ?? "";
    Engine.resolveConflict(state, dataset.resolve, { choice: dataset.choice, rationale }, now());
    render();
    toast("冲突已裁决，只重推受影响活动");
  }

  function reopenConflictClick(id) {
    Engine.reopenConflict(state, id, "使用者要求重新核对", now());
    render();
    toast("冲突已重新打开，双方上下文均保留");
  }

  function markConflictClick(entryId) {
    const options = localEntries(entryId)
      .filter((entry) => entry.status === "active")
      .map((entry) => `${entry.title}（${entry.id}）`)
      .join("\n");
    const answer = prompt(`选择冲突条目标题：\n${options}`, "");
    if (!answer) return;
    const target = localEntries(entryId).find((entry) => entry.title === answer.trim());
    if (!target) return toast("没有匹配的条目");
    const note = prompt("说明矛盾点", "两条上下文相互矛盾") || "";
    Engine.addConflict(state, { entryAId: entryId, entryBId: target.id, note }, now());
    render();
    toast("已保留双方并标记冲突");
  }

  function toggleEntry(id) {
    const entry = state.entries[id];
    Engine.updateEntry(state, id, { status: entry.status === "active" ? "retired" : "active" }, now());
    render();
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `activity-context-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        if (!imported.activities || !imported.entries) throw new Error("数据结构不正确");
        state = imported;
        state.computed = {};
        selectedActivityId = state.activityOrder[0];
        Object.values(state.activities).forEach((_, id) => id);
        const fresh = Engine.deriveAll(state, now());
        Object.assign(state.computed, fresh.activities);
        render();
        toast("数据已导入");
      } catch (error) {
        toast(`导入失败：${error.message}`);
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  function resetDemo() {
    if (!confirm("重置会覆盖当前浏览器中的全部数据，确定继续吗？")) return;
    state = seedDemo();
    selectedActivityId = state.activityOrder[0];
    render();
    toast("已恢复内置示例");
  }

  bindEvents();
  render();
})();
