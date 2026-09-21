"use strict";

const state = {
  data: null,
  budgets: {},
  analysis: null,
  selectedId: null,
  colors: new Map(),
};

const el = {
  batchSummary: document.getElementById("batchSummary"),
  requestList: document.getElementById("requestList"),
  detail: document.getElementById("detail"),
  feedback: document.getElementById("feedback"),
  budgetEditor: document.getElementById("budgetEditor"),
  searchInput: document.getElementById("searchInput"),
};

const palette = ["#2563eb", "#0891b2", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0f766e", "#be185d", "#475569"];

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

function fmt(value, digits = 1) {
  if (value === null || value === undefined) return "—";
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function stageColor(stage) {
  if (!state.colors.has(stage)) {
    state.colors.set(stage, palette[state.colors.size % palette.length]);
  }
  return state.colors.get(stage);
}

function statusText(status) {
  return { valid: "正常", warning: "有警告", invalid: "异常" }[status] || status;
}

function showFeedback(message, isError) {
  if (!message) {
    el.feedback.className = "feedback hidden";
    el.feedback.textContent = "";
    return;
  }
  el.feedback.className = `feedback ${isError ? "error" : "hidden"}`;
  el.feedback.textContent = message;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

async function runAnalysis() {
  if (!state.data) return;
  showFeedback("");
  try {
    state.analysis = await postJson("/api/analyze", {
      data: state.data,
      budgets: state.budgets,
      include_segments: true,
    });
    if (state.analysis.batch_errors && state.analysis.batch_errors.length) {
      showFeedback(state.analysis.batch_errors.map((item) => item.message).join("\n"), true);
    }
    renderBatchSummary();
    renderRequestList();
    renderBudgetEditor();
    renderDetail();
  } catch (error) {
    showFeedback(error.message, true);
  }
}

async function loadSample() {
  showFeedback("");
  try {
    const payload = await fetch("/api/sample").then((r) => r.json());
    if (payload.error) throw new Error(payload.error);
    state.data = payload.data;
    state.budgets = { ...(state.data.default_budgets || {}) };
    state.selectedId = null;
    state.colors.clear();
    await runAnalysis();
  } catch (error) {
    showFeedback(error.message, true);
    el.batchSummary.textContent = "加载失败";
  }
}

function renderBatchSummary() {
  const a = state.analysis;
  el.batchSummary.innerHTML = `请求 ${a.request_count} 条<br>
    <span class="badge valid">正常 ${a.valid_count}</span>
    <span class="badge warning">警告 ${a.warning_count}</span>
    <span class="badge invalid">异常 ${a.invalid_count}</span>`;
}

function requestsForList() {
  const query = el.searchInput.value.trim().toLowerCase();
  const requests = state.analysis?.requests || [];
  if (!query) return requests;
  return requests.filter((item) => `${item.id} ${item.name || ""}`.toLowerCase().includes(query));
}

function renderRequestList() {
  const fragment = document.createDocumentFragment();
  for (const request of requestsForList()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `request-card ${request.id === state.selectedId ? "active" : ""}`;
    const duration = request.status === "invalid" ? "未归因" : `${fmt(request.end_to_end_duration_ms)} ms`;
    button.innerHTML = `
      <span class="request-title"><span>${esc(request.name || request.id)}</span><span class="badge ${request.status}">${statusText(request.status)}</span></span>
      <span class="request-meta">${esc(request.id)} · ${duration}</span>`;
    button.addEventListener("click", () => {
      state.selectedId = request.id;
      renderRequestList();
      renderDetail();
    });
    fragment.appendChild(button);
  }
  el.requestList.replaceChildren(fragment);
}

function renderBudgetEditor() {
  const stages = new Set(Object.keys(state.budgets || {}));
  for (const request of state.analysis?.requests || []) {
    Object.keys(request.stage_attribution || {}).forEach((stage) => stages.add(stage));
  }
  const fragment = document.createDocumentFragment();
  for (const stage of [...stages].sort()) {
    const wrapper = document.createElement("div");
    wrapper.className = "budget-field";
    const value = state.budgets[stage];
    wrapper.innerHTML = `
      <label for="budget-${esc(stage)}">${esc(stage)}</label>
      <input id="budget-${esc(stage)}" data-stage="${esc(stage)}"
             inputmode="decimal" value="${value === undefined || value === null ? "" : fmt(value, 3)}"
             placeholder="未设置">`;
    fragment.appendChild(wrapper);
  }
  el.budgetEditor.replaceChildren(fragment);
}

function readBudgets() {
  const budgets = {};
  for (const input of el.budgetEditor.querySelectorAll("input[data-stage]")) {
    const text = input.value.trim();
    if (!text) continue;
    const value = Number(text);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`阶段“${input.dataset.stage}”的预算必须是非负数字。`);
    }
    budgets[input.dataset.stage] = value;
  }
  return budgets;
}

function issueBlock(request) {
  const issues = [
    ...(request.errors || []).map((x) => ({ ...x, severity: "error" })),
    ...(request.warnings || []),
  ];
  if (!issues.length) return "";
  return `<div class="issues">${issues.map((issue) => `
    <div class="issue ${issue.severity}"><strong>${issue.severity === "error" ? "异常" : "警告"}：</strong>${esc(issue.message)}</div>
  `).join("")}</div>`;
}

function metrics(request) {
  if (request.status === "invalid") return "";
  const values = [
    ["端到端", request.end_to_end_duration_ms],
    ["实际活动", request.active_duration_ms],
    ["独占合计", request.exclusive_duration_ms],
    ["共同占用墙钟", request.shared_wall_duration_ms],
    ["空档", request.idle_duration_ms],
  ];
  return `<div class="metric-grid">${values.map(([label, value]) => `
    <div class="metric"><div class="label">${label}</div><div class="value">${fmt(value)}</div><div class="label">ms</div></div>
  `).join("")}</div>`;
}

function timeline(request) {
  if (!request.segments || !request.segments.length) return "";
  const total = Math.max(1, request.status === "invalid"
    ? Math.max(...request.segments.flatMap((s) => [s.start_ms, s.end_ms]))
    : request.end_to_end_duration_ms);
  const byStage = new Map();
  for (const segment of request.segments) {
    if (!byStage.has(segment.stage)) byStage.set(segment.stage, []);
    byStage.get(segment.stage).push(segment);
  }
  const rows = [...byStage.entries()].map(([stage, segments]) => {
    const bars = segments.map((segment) => {
      const rawWidth = Math.abs(segment.end_ms - segment.start_ms) / total * 100;
      const left = Math.max(0, Math.min(segment.start_ms, segment.end_ms) / total * 100);
      const width = Math.max(0.8, rawWidth);
      const inverted = segment.end_ms < segment.start_ms ? " inverted" : "";
      return `<span class="bar${inverted}" style="left:${left}%;width:${width}%;background:${inverted ? undefined : stageColor(stage)}"
        title="${esc(segment.id)} · ${esc(stage)}&#10;${fmt(segment.start_ms)}–${fmt(segment.end_ms)} ms，${fmt(segment.duration_ms)} ms"></span>`;
    }).join("");
    return `<div class="timeline-row"><div class="lane-label" title="${esc(stage)}">${esc(stage)}</div><div class="lane">${bars}</div></div>`;
  }).join("");
  return `<h3>阶段时间线</h3><div class="timeline">
    <div class="timeline-row"><div class="lane-label muted">0 ms</div><div class="muted">端到端范围：${fmt(total)} ms（相对请求起点）</div></div>
    ${rows}
  </div><p class="legend">同一水平条上同一颜色的多个片段属于该阶段；垂直重叠表示共同占用。</p>`;
}

function attributionTable(request) {
  if (request.status === "invalid") {
    return `<p class="muted">该请求存在硬性不自洽问题，因此不展示归因数字，避免产生误导。请先修正原始时序记录。</p>`;
  }
  const rows = Object.values(request.stage_attribution || {}).map((stat) => {
    const budgeted = stat.budget_ms !== null && stat.budget_ms !== undefined;
    const overrun = stat.overrun_ms || 0;
    const overrunCell = !budgeted ? "—" : overrun > 0 ? `+${fmt(overrun)}` : "未超支";
    return `<tr>
      <td>${esc(stat.stage)}</td>
      <td>${fmt(stat.actual_occupied_duration)}</td>
      <td>${fmt(stat.exclusive_duration)}</td>
      <td>${fmt(stat.shared_wall_duration)}</td>
      <td>${fmt(stat.allocated_shared_duration)}</td>
      <td>${fmt(stat.e2e_contribution_duration)}</td>
      <td>${budgeted ? fmt(stat.budget_ms) : "—"}</td>
      <td class="${overrun > 0 ? "overrun" : budgeted ? "ok" : "muted"}">${overrunCell}</td>
    </tr>`;
  }).join("");
  return `<h3>归因明细</h3>
  <p class="legend">“共同占用墙钟”是重叠实际经过时间；“分摊共同占用”按同时活动阶段数均分。共同占用墙钟只算一次，因此各阶段实际占用不能直接相加为端到端。</p>
  <div class="table-wrap"><table>
    <thead><tr><th>阶段</th><th>实际占用</th><th>独占</th><th>共同墙钟</th><th>分摊共同</th><th>E2E贡献</th><th>预算</th><th>超支</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>${overrunExplanation(request)}`;
}

function overrunExplanation(request) {
  const overruns = request.budget_summary?.overruns || [];
  if (!overruns.length) return "";
  return `<div class="issues">${overruns.map((item) => {
    const sharedNote = item.shared_wall_duration > 0
      ? `其中 ${fmt(item.e2e_contribution_duration)} ms 按共同占用规则计入端到端贡献。`
      : `该阶段为独占耗时，端到端贡献 ${fmt(item.e2e_contribution_duration)} ms。`;
    return `<div class="issue warning"><strong>超支定位：${esc(item.stage)}</strong><br>
      预算 ${fmt(item.budget_ms)} ms，实际占用 ${fmt(item.actual_occupied_duration)} ms，
      超出 <strong>${fmt(item.overrun_ms)} ms</strong>。${sharedNote}</div>`;
  }).join("")}</div>`;
}

function renderDetail() {
  const request = (state.analysis?.requests || []).find((item) => item.id === state.selectedId)
    || state.analysis?.requests?.[0];
  if (!request) {
    el.detail.innerHTML = `<div class="empty-state">暂无可展示请求</div>`;
    return;
  }
  state.selectedId = request.id;
  el.detail.innerHTML = `
    <div class="detail-header">
      <div><h2>${esc(request.name || request.id)}</h2><p>${esc(request.id)} · 原始片段 ${request.fragment_count} 个</p></div>
      <span class="badge ${request.status}">${statusText(request.status)}</span>
    </div>
    ${issueBlock(request)}
    ${metrics(request)}
    ${timeline(request)}
    ${attributionTable(request)}`;
}

document.getElementById("applyBudgetsButton").addEventListener("click", async () => {
  try {
    state.budgets = readBudgets();
    await runAnalysis();
  } catch (error) {
    showFeedback(error.message, true);
  }
});
document.getElementById("reanalyzeButton").addEventListener("click", runAnalysis);
document.getElementById("reloadButton").addEventListener("click", loadSample);
el.searchInput.addEventListener("input", renderRequestList);

loadSample();
