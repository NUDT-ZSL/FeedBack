"use strict";

const state = {
  records: [],
  defaultBudgets: {},
  initialBudgets: {},
  budgets: {},
  batch: null,
  selectedId: null,
  selectedRequest: null,
};

const palette = ["#2458d3", "#12a0a6", "#7c5cd6", "#d88218", "#3b8a3d", "#cc4f7a", "#6b7280"];

const els = {
  list: document.getElementById("request-list"),
  summary: document.getElementById("batch-summary"),
  title: document.getElementById("request-title"),
  meta: document.getElementById("request-meta"),
  status: document.getElementById("request-status"),
  anomalies: document.getElementById("anomalies"),
  budgets: document.getElementById("budget-editor"),
  metrics: document.getElementById("timeline-summary"),
  timeline: document.getElementById("timeline"),
  segments: document.getElementById("segment-table-wrap"),
  stages: document.getElementById("stage-table-wrap"),
  error: document.getElementById("global-error"),
};

const fmt = (value, digits = 2) => {
  if (value === null || value === undefined) return "—";
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits).replace(/\.00$/, "") : String(value);
};

function colorFor(name) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return palette[hash % palette.length];
}

function showError(message) {
  els.error.textContent = message;
  els.error.classList.toggle("hidden", !message);
}

async function postJson(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function loadSample() {
  showError("");
  const payload = await fetch("/api/sample").then(r => r.json());
  if (payload.error) throw new Error(payload.error);
  state.records = payload.records;
  state.defaultBudgets = payload.budgets;
  state.initialBudgets = { ...payload.budgets };
  state.budgets = { ...payload.budgets };
  state.selectedId = payload.records.length ? String(payload.records[0].id) : null;
  await refreshBatch();
}

async function refreshBatch() {
  state.batch = await postJson("/api/analyze-batch", {
    records: state.records,
    budgets: state.budgets,
  });
  renderBatch();
  if (state.selectedId !== null) await selectRequest(String(state.selectedId));
  else renderEmpty();
}

function renderBatch() {
  const s = state.batch.summary;
  els.summary.textContent = `${s.request_count} 条 · ${s.invalid_count} 异常 · ${s.warning_count} 警告`;
  els.list.innerHTML = "";
  for (const item of state.batch.results) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `request-card ${String(item.id) === state.selectedId ? "active" : ""}`;
    const e2e = item.end_to_end_ms === null ? "无法归因" : `${fmt(item.end_to_end_ms)} ms`;
    btn.innerHTML = `<span class="line1"><strong>${escapeHtml(item.id)}</strong><span>${e2e}</span></span>
      <small>${escapeHtml(item.name)}</small><small>${statusText(item.status)}</small>`;
    btn.addEventListener("click", () => selectRequest(String(item.id)));
    els.list.appendChild(btn);
  }
}

function statusText(status) {
  return { valid: "正常", warning: "可归因（有警告）", invalid: "异常：未归因" }[status] || status;
}

async function selectRequest(id) {
  state.selectedId = id;
  renderBatch();
  const record = state.records.find(item => String(item.id) === id);
  state.selectedRequest = await postJson("/api/analyze-request", {
    request: record,
    budgets: state.budgets,
  });
  renderRequest();
}

function renderEmpty() {
  state.selectedRequest = null;
  els.title.textContent = "没有可显示的请求";
  els.meta.textContent = "请加载包含 requests 数组的 JSON 文件，或重新载入样例。";
  els.status.textContent = "无数据";
  els.status.className = "status-pill";
  els.anomalies.innerHTML = "";
  els.budgets.innerHTML = "";
  els.metrics.innerHTML = "";
  els.timeline.innerHTML = "";
  els.segments.innerHTML = "";
  els.stages.innerHTML = "";
}

function allStageNames() {
  const names = new Set(Object.keys(state.budgets));
  for (const record of state.records) {
    for (const seg of record.segments || []) {
      const name = seg?.stage ?? seg?.name;
      if (typeof name === "string" && name.trim()) names.add(name.trim());
    }
  }
  return [...names].sort();
}

function renderBudgets() {
  els.budgets.innerHTML = "";
  for (const name of allStageNames()) {
    const box = document.createElement("div");
    box.className = "budget-item";
    const value = state.budgets[name] ?? "";
    box.innerHTML = `<label>${escapeHtml(name)} 预算 (ms)</label><input data-stage="${escapeHtml(name)}" type="number" min="0" step="1" value="${value}" placeholder="不限">`;
    els.budgets.appendChild(box);
  }
}

function renderAnomalies(r) {
  els.anomalies.innerHTML = "";
  for (const anomaly of r.anomalies) {
    const div = document.createElement("div");
    div.className = `anomaly ${anomaly.severity}`;
    const ids = anomaly.segment_ids.length ? `（片段：${anomaly.segment_ids.join(", ")}）` : "";
    div.textContent = `${anomaly.severity === "error" ? "异常" : "警告"} · ${anomaly.message}${ids}`;
    els.anomalies.appendChild(div);
  }
}

function renderMetrics(r) {
  if (r.status === "invalid") {
    els.metrics.innerHTML = `<div class="metric"><span>归因状态</span><strong>未计算</strong></div>
      <div class="metric"><span>原因</span><strong>${r.anomalies.filter(a => a.severity === "error").length} 个错误</strong></div>`;
    return;
  }
  const items = [
    ["端到端", `${fmt(r.end_to_end_ms)} ms`],
    ["已归因", `${fmt(r.attributed_ms)} ms`],
    ["空档", `${fmt(r.unattributed_gap_ms)} ms`],
    ["阶段数", r.stages.length],
    ["超支阶段", r.budget_overruns.length],
  ];
  els.metrics.innerHTML = items.map(([label, value]) =>
    `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`).join("");
}

function renderTimeline(r) {
  const rawSegments = r.status === "invalid" ? r.input_segments : r.segments;
  const drawable = rawSegments.filter(seg =>
    seg && typeof (seg.stage ?? seg.name) === "string" && Number.isFinite(Number(seg.start_ms ?? seg.start))
      && Number.isFinite(Number(seg.end_ms ?? seg.end)));
  if (!drawable.length) {
    els.timeline.innerHTML = `<p class="muted">没有可绘制的时间片段。</p>`;
    return;
  }
  const start = Math.min(...drawable.map(seg => Number(seg.start_ms ?? seg.start)));
  const end = Math.max(...drawable.map(seg => Number(seg.end_ms ?? seg.end)));
  const span = Math.max(end - start, 1);
  const byStage = new Map();
  for (const seg of drawable) {
    const name = String(seg.stage ?? seg.name).trim();
    if (!byStage.has(name)) byStage.set(name, []);
    byStage.get(name).push(seg);
  }
  const rows = [];
  for (const [name, segments] of [...byStage.entries()].sort()) {
    const bars = segments.map(seg => {
      const segStart = Number(seg.start_ms ?? seg.start);
      const segEnd = Number(seg.end_ms ?? seg.end);
      const left = (segStart - start) / span * 100;
      const width = Math.max((segEnd - segStart) / span * 100, 0);
      return `<div class="bar" title="${escapeHtml(name)} ${fmt(segStart)}–${fmt(segEnd)} ms"
        style="left:${left}%;width:${width}%;background:${colorFor(name)}"></div>`;
    }).join("");
    rows.push(`<div class="track-row"><div class="track-label" title="${escapeHtml(name)}">${escapeHtml(name)}</div><div class="track">${bars}</div></div>`);
  }
  rows.push(`<div class="axis"><div></div><div class="axis-end"><span>${fmt(start)}</span><span>${fmt(end)} ms</span></div></div>`);
  els.timeline.innerHTML = rows.join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}

function renderTables(r) {
  const rawSegments = r.status === "invalid" ? r.input_segments : r.segments;
  els.segments.innerHTML = `<table>
    <thead><tr><th>片段</th><th>阶段</th><th>开始</th><th>结束</th><th>声明时长</th></tr></thead>
    <tbody>${rawSegments.map(seg => {
      const start = seg?.start_ms ?? seg?.start;
      const end = seg?.end_ms ?? seg?.end;
      const length = Number.isFinite(Number(start)) && Number.isFinite(Number(end)) ? Number(end) - Number(start) : null;
      return `<tr><td>${escapeHtml(seg?.id ?? "")}</td><td>${escapeHtml(seg?.stage ?? seg?.name ?? "无效名称")}</td>
        <td>${fmt(start)}</td><td>${fmt(end)}</td>
        <td class="${length !== null && length < 0 ? "overage" : ""}">${length === null ? "无效时间" : fmt(length)}</td></tr>`;
    }).join("")}</tbody></table>`;

  if (r.status === "invalid") {
    els.stages.innerHTML = `<p class="muted">该请求存在错误级异常，系统未生成阶段归因，避免把不可信片段用于预算判断。</p>`;
    return;
  }
  els.stages.innerHTML = `<table>
    <thead><tr><th>阶段</th><th>实际占用</th><th>独占</th><th>共同占用墙钟</th><th>归因耗时</th>
    <th>预算</th><th>超支</th><th>对端到端增加</th><th>被重叠遮蔽</th></tr></thead>
    <tbody>${r.stages.map(s => `<tr>
      <td>${escapeHtml(s.stage)}${s.occurrences > 1 ? ` <span class="muted">×${s.occurrences}</span>` : ""}</td>
      <td>${fmt(s.gross_duration_ms)}</td>
      <td>${fmt(s.exclusive_ms)}</td>
      <td>${fmt(s.shared_wall_ms)}</td>
      <td>${fmt(s.allocated_ms)}</td>
      <td>${s.budget_ms === null ? "不限" : fmt(s.budget_ms)}</td>
      <td class="${s.overage_ms > 0 ? "overage" : ""}">${s.overage_ms === null ? "—" : fmt(s.overage_ms)}</td>
      <td class="${s.e2e_overrun_contribution_ms > 0 ? "overage" : ""}">${s.e2e_overrun_contribution_ms === null ? "—" : fmt(s.e2e_overrun_contribution_ms)}</td>
      <td>${s.overrun_hidden_by_overlap_ms === null ? "—" : fmt(s.overrun_hidden_by_overlap_ms)}</td>
    </tr>`).join("")}</tbody></table>
    ${r.budget_overruns.length ? `<p class="muted">说明：共同占用墙钟不重复计入归因耗时；并发片段按当时活动阶段数均分。“对端到端增加”是预算尾部实际落在端到端时间轴上的份额。</p>` : ""}`;
}

function renderRequest() {
  const r = state.selectedRequest;
  if (!r) return;
  els.title.textContent = `${r.id} · ${r.name}`;
  els.meta.textContent = r.status === "invalid"
    ? "原始片段仍被展示，但错误级异常会阻止归因。"
    : `时间范围 ${fmt(r.start_ms)}–${fmt(r.end_ms)} ms · ${r.segment_count} 个片段`;
  els.status.textContent = statusText(r.status);
  els.status.className = `status-pill status-${r.status}`;
  renderAnomalies(r);
  renderBudgets();
  renderMetrics(r);
  renderTimeline(r);
  renderTables(r);
}

async function applyBudgets() {
  const next = {};
  for (const input of els.budgets.querySelectorAll("input")) {
    const value = input.value.trim();
    if (!value) continue;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
      showError(`阶段 ${input.dataset.stage} 的预算必须是非负数字，或留空表示不限。`);
      return;
    }
    next[input.dataset.stage] = number;
  }
  showError("");
  state.budgets = next;
  await refreshBatch();
}

async function loadLocalFile(file) {
  showError("");
  try {
    const payload = JSON.parse(await file.text());
    const records = Array.isArray(payload) ? payload : payload?.requests;
    if (!Array.isArray(records)) throw new Error("JSON 必须是请求数组，或包含 requests 数组的对象。");
    const budgets = payload?.budgets && typeof payload.budgets === "object" && !Array.isArray(payload.budgets)
      ? payload.budgets
      : {};
    state.records = records;
    state.defaultBudgets = budgets;
    state.initialBudgets = { ...budgets };
    state.budgets = { ...budgets };
    state.selectedId = records.length && records[0]?.id !== undefined ? String(records[0].id) : null;
    await refreshBatch();
  } catch (error) {
    showError(`无法加载本地文件：${error.message}`);
  }
}

document.getElementById("apply-budgets").addEventListener("click", applyBudgets);
document.getElementById("reset-budgets").addEventListener("click", async () => {
  state.budgets = { ...state.initialBudgets };
  await refreshBatch();
});
document.getElementById("reload-sample").addEventListener("click", async () => {
  try { await loadSample(); } catch (error) { showError(error.message); }
});
document.getElementById("load-file").addEventListener("change", async event => {
  if (event.target.files?.length) await loadLocalFile(event.target.files[0]);
  event.target.value = "";
});

loadSample().catch(error => showError(error.message));
