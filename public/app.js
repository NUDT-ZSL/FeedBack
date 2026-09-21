// Offline-first work order client.
// State persisted in localStorage so the whole flow survives reloads.
"use strict";

const LS_KEY = "offline-wo-state-v1";
const FIELD_LABELS = { title: "标题", body: "正文", assignee: "负责人" };

const state = {
  online: true,          // actual reachability is simulated by the toggle
  workorders: [],        // last known server snapshot merged with local edits
  serverSnapshot: {},    // id -> last synced server copy (for oldValue tracking)
  ops: [],               // ordered offline op log: {seq, workorderId, field, oldValue, newValue, time, status}
  seq: 0,
  selectedId: null,
  conflicts: [],         // conflicts returned by last sync
  resolutions: {},       // "woId|field" -> {mode: 'local'|'server'|'manual', value}
};

function saveState() {
  const persist = {
    workorders: state.workorders,
    serverSnapshot: state.serverSnapshot,
    ops: state.ops,
    seq: state.seq,
    selectedId: state.selectedId,
  };
  localStorage.setItem(LS_KEY, JSON.stringify(persist));
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    state.workorders = p.workorders || [];
    state.serverSnapshot = p.serverSnapshot || {};
    state.ops = p.ops || [];
    state.seq = p.seq || 0;
    state.selectedId = p.selectedId || null;
  } catch (e) {
    console.warn("failed to load local state", e);
  }
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function findWO(id) {
  return state.workorders.find((w) => w.id === id);
}

function pendingOpsFor(woId, field) {
  return state.ops.filter(
    (o) => o.workorderId === woId && o.field === field && o.status === "pending"
  );
}

function hasPending() {
  return state.ops.some((o) => o.status === "pending");
}

// ---------- API ----------
async function api(path, body) {
  if (!state.online) throw new Error("offline");
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error("http " + res.status);
  return res.json();
}

// ---------- rendering ----------
function renderConn() {
  const badge = $("#connBadge");
  badge.classList.toggle("online", state.online);
  badge.classList.toggle("offline", !state.online);
  $("#connText").textContent = state.online ? "在线" : "离线（改动仅保存在本地）";
  const btn = $("#toggleNetBtn");
  btn.textContent = state.online ? "模拟断网" : "恢复连接";
  btn.classList.toggle("online-mode", !state.online);
  $("#syncBtn").disabled = !state.online || !hasPending();
}

function renderList() {
  const box = $("#woList");
  box.innerHTML = "";
  for (const wo of state.workorders) {
    const div = document.createElement("div");
    div.className = "wo-item" + (wo.id === state.selectedId ? " active" : "");
    const pending = state.ops.some((o) => o.workorderId === wo.id && o.status === "pending");
    div.innerHTML =
      `<div class="wo-id">${wo.id} · v${wo.version}</div>` +
      `<div class="wo-title">${escapeHtml(wo.title)}</div>` +
      `<div class="wo-meta"><span>${escapeHtml(wo.assignee)}</span>` +
      (pending ? `<span class="badge pending">待同步</span>` : `<span class="badge synced">已同步</span>`) +
      `</div>`;
    div.onclick = () => {
      state.selectedId = wo.id;
      saveState();
      renderAll();
    };
    box.appendChild(div);
  }
}

function renderEditor() {
  const wo = findWO(state.selectedId);
  $("#editorEmpty").classList.toggle("hidden", !!wo);
  $("#editor").classList.toggle("hidden", !wo);
  if (!wo) return;
  $("#editVersion").textContent = `${wo.id} · 本地版本 v${wo.version}`;
  const map = { title: "#fTitle", body: "#fBody", assignee: "#fAssignee" };
  for (const [field, sel] of Object.entries(map)) {
    const el = $(sel);
    if (document.activeElement !== el) el.value = wo[field];
    const dirty = pendingOpsFor(wo.id, field).length > 0;
    el.classList.toggle("dirty", dirty);
    document.querySelector(`[data-pending="${field}"]`).classList.toggle("hidden", !dirty);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---------- op log ----------
// Final intent per (wo, field): last pending op. Earlier ones stay visible
// but are marked as superseded so the user can review the full history.
function renderOpLog() {
  const box = $("#opLog");
  box.innerHTML = "";
  $("#opCount").textContent = String(state.ops.filter((o) => o.status === "pending").length);
  const lastPendingKey = {};
  for (const op of state.ops) {
    if (op.status === "pending") lastPendingKey[op.workorderId + "|" + op.field] = op.seq;
  }
  const sorted = [...state.ops].sort((a, b) => b.seq - a.seq);
  for (const op of sorted) {
    const key = op.workorderId + "|" + op.field;
    const isFinal = op.status === "pending" && lastPendingKey[key] === op.seq;
    const superseded = op.status === "pending" && !isFinal;
    const div = document.createElement("div");
    div.className =
      "op-entry" + (superseded ? " superseded" : "") + (isFinal ? " final-intent" : "");
    const statusTag =
      op.status === "pending"
        ? isFinal
          ? `<span class="badge pending op-status">最终意图</span>`
          : `<span class="badge op-status">已被后续修改覆盖</span>`
        : `<span class="badge synced op-status">${{ applied: "已同步", resolved: "已裁决同步", orphaned: "工单已删除" }[op.status] || op.status}</span>`;
    div.innerHTML =
      `<div class="op-head"><span class="op-seq">#${op.seq}</span>` +
      `<span>${op.workorderId}</span><span class="op-field">${FIELD_LABELS[op.field]}</span>` +
      statusTag +
      `<span class="op-time">${new Date(op.time).toLocaleTimeString()}</span></div>` +
      `<div class="op-change"><span class="old">${escapeHtml(op.oldValue)}</span>` +
      `<span class="arrow">→</span><span class="new">${escapeHtml(op.newValue)}</span></div>`;
    box.appendChild(div);
  }
}

function logSync(msg, cls) {
  const box = $("#syncLog");
  const div = document.createElement("div");
  div.className = "sync-entry " + (cls || "info");
  div.innerHTML = `<span class="t">${new Date().toLocaleTimeString()}</span>${escapeHtml(msg)}`;
  box.prepend(div);
}

// ---------- editing ----------
function onEdit(field, value) {
  const wo = findWO(state.selectedId);
  if (!wo || wo[field] === value) return;
  const oldValue = wo[field];
  wo[field] = value;
  state.seq += 1;
  state.ops.push({
    seq: state.seq,
    workorderId: wo.id,
    field,
    oldValue,
    newValue: value,
    time: new Date().toISOString(),
    status: "pending",
  });
  saveState();
  renderList();
  renderEditor();
  renderOpLog();
  renderConn();
}

// ---------- sync ----------
async function doSync() {
  const pending = state.ops.filter((o) => o.status === "pending");
  if (pending.length === 0) {
    logSync("没有待同步的本地操作", "noop");
    return;
  }
  logSync(`按顺序提交 ${pending.length} 条操作…`, "info");
  let resp;
  try {
    resp = await api("/api/sync", { ops: pending });
  } catch (e) {
    logSync("同步失败：" + e.message + "（操作保留在本地队列）", "conflict");
    return;
  }
  for (const r of resp.results) {
    const label = `${r.workorderId} · ${FIELD_LABELS[r.field]}`;
    if (r.status === "applied") {
      logSync(`${label}：已应用（第 ${r.firstSeq}~${r.lastSeq} 条合并为最终意图）`, "applied");
      markOpsSynced(r, "applied");
    } else if (r.status === "noop") {
      logSync(`${label}：服务端已是该值，无需变更`, "noop");
      markOpsSynced(r, "applied");
    } else if (r.status === "conflict") {
      logSync(`${label}：冲突！服务端当前值与本地基线不一致`, "conflict");
    } else if (r.status === "orphaned") {
      logSync(`${label}：${r.reason}`, "conflict");
      markOpsSynced(r, "orphaned");
    }
  }
  state.conflicts = resp.conflicts || [];
  state.resolutions = {};
  // Refresh snapshot from authoritative server state, but keep local values
  // for fields still in conflict so the user's intent stays visible.
  mergeServerState(resp.workorders, state.conflicts);
  saveState();
  renderAll();
}

function markOpsSynced(result, status) {
  for (const op of state.ops) {
    if (
      op.workorderId === result.workorderId &&
      op.field === result.field &&
      op.status === "pending"
    ) {
      op.status = status;
    }
  }
}

function mergeServerState(serverWOs, conflicts) {
  const conflictKeys = new Set(conflicts.map((c) => c.workorderId + "|" + c.field));
  for (const s of serverWOs) {
    state.serverSnapshot[s.id] = { ...s };
    let local = findWO(s.id);
    if (!local) {
      state.workorders.push({ ...s });
      continue;
    }
    for (const f of ["title", "body", "assignee"]) {
      if (!conflictKeys.has(s.id + "|" + f)) local[f] = s[f];
    }
    local.version = s.version;
    local.updatedAt = s.updatedAt;
  }
}

// ---------- conflict resolution UI ----------
function renderConflicts() {
  const panel = $("#conflictPanel");
  panel.classList.toggle("hidden", state.conflicts.length === 0);
  if (state.conflicts.length === 0) return;
  $("#conflictCount").textContent = `${state.conflicts.length} 个字段待裁决`;
  const box = $("#conflictList");
  box.innerHTML = "";
  for (const c of state.conflicts) {
    const key = c.workorderId + "|" + c.field;
    const div = document.createElement("div");
    div.className = "conflict-item";
    div.innerHTML =
      `<div class="cf-field">${c.workorderId} · ${FIELD_LABELS[c.field]}` +
      (c.opCount > 1 ? `（本地共修改 ${c.opCount} 次，以下为最终意图）` : "") +
      `</div>` +
      `<div class="cf-compare">` +
      `<div class="cf-side" data-key="${key}" data-mode="local">` +
      `<span class="cf-tag">本地意图</span>${escapeHtml(c.localValue)}</div>` +
      `<div class="cf-side" data-key="${key}" data-mode="server">` +
      `<span class="cf-tag">服务端当前值</span>${escapeHtml(c.serverValue)}</div>` +
      `</div>` +
      `<div class="cf-manual-row">` +
      `<input type="text" placeholder="或手工输入合并结果…" data-manual="${key}" />` +
      `<button class="btn" data-use-manual="${key}">采用手工值</button>` +
      `</div>`;
    box.appendChild(div);
  }
  box.querySelectorAll(".cf-side").forEach((el) => {
    el.onclick = () => {
      const key = el.dataset.key;
      const mode = el.dataset.mode;
      const c = state.conflicts.find((x) => x.workorderId + "|" + x.field === key);
      state.resolutions[key] = {
        mode,
        value: mode === "local" ? c.localValue : c.serverValue,
      };
      paintResolution(box, key);
    };
  });
  box.querySelectorAll("[data-use-manual]").forEach((btn) => {
    btn.onclick = () => {
      const key = btn.dataset.useManual;
      const input = box.querySelector(`[data-manual="${CSS.escape(key)}"]`);
      if (!input.value.trim()) return;
      state.resolutions[key] = { mode: "manual", value: input.value };
      paintResolution(box, key);
    };
  });
}

function paintResolution(box, key) {
  box.querySelectorAll(`.cf-side[data-key="${CSS.escape(key)}"]`).forEach((el) => {
    el.classList.toggle("selected", state.resolutions[key] && state.resolutions[key].mode === el.dataset.mode);
  });
}

async function applyResolutions() {
  const missing = state.conflicts.filter(
    (c) => !state.resolutions[c.workorderId + "|" + c.field]
  );
  if (missing.length > 0) {
    logSync(`还有 ${missing.length} 个冲突未裁决`, "conflict");
    return;
  }
  const decisions = state.conflicts.map((c) => {
    const key = c.workorderId + "|" + c.field;
    return {
      workorderId: c.workorderId,
      field: c.field,
      value: state.resolutions[key].value,
      expectedServerValue: c.serverValue,
    };
  });
  let resp;
  try {
    resp = await api("/api/resolve", { decisions });
  } catch (e) {
    logSync("裁决提交失败：" + e.message, "conflict");
    return;
  }
  for (const a of resp.applied) {
    const label = `${a.workorderId} · ${FIELD_LABELS[a.field]}`;
    if (a.status === "resolved") {
      logSync(`${label}：裁决已应用，仅重算该字段`, "applied");
      markOpsSynced(a, "resolved");
    } else if (a.status === "stale") {
      logSync(`${label}：服务端值在裁决期间又变了，请重新同步`, "conflict");
    }
  }
  state.conflicts = [];
  state.resolutions = {};
  mergeServerState(resp.workorders, []);
  saveState();
  renderAll();
  logSync("冲突处理完成，未涉及字段保持原同步结果不变", "info");
}

// ---------- misc actions ----------
async function refreshFromServer() {
  try {
    const resp = await api("/api/workorders");
    if (!hasPending() && state.conflicts.length === 0) {
      state.workorders = resp.workorders.map((w) => ({ ...w }));
      for (const w of resp.workorders) state.serverSnapshot[w.id] = { ...w };
      if (!findWO(state.selectedId) && state.workorders.length > 0) {
        state.selectedId = state.workorders[0].id;
      }
      saveState();
      renderAll();
    }
  } catch (e) {
    /* stay offline-quiet */
  }
}

async function simulateServerEdit() {
  const wo = findWO(state.selectedId);
  if (!wo) return;
  const fields = ["title", "body", "assignee"];
  const field = fields[Math.floor(Math.random() * fields.length)];
  const value = wo[field] + "（服务端修改 " + new Date().toLocaleTimeString() + "）";
  try {
    await api("/api/server-edit", { workorderId: wo.id, field, value });
    logSync(`模拟：他人在服务端修改了 ${wo.id} 的${FIELD_LABELS[field]}`, "info");
  } catch (e) {
    logSync("模拟服务端变更失败（当前离线）", "conflict");
  }
}

function renderAll() {
  renderConn();
  renderList();
  renderEditor();
  renderOpLog();
  renderConflicts();
}

// ---------- init ----------
function init() {
  loadState();
  $("#toggleNetBtn").onclick = async () => {
    state.online = !state.online;
    renderConn();
    if (state.online) {
      logSync("连接已恢复，开始自动同步…", "info");
      await doSync();
      await refreshFromServer();
    } else {
      logSync("已断网，编辑将记录到本地队列", "info");
    }
  };
  $("#syncBtn").onclick = doSync;
  $("#applyResolveBtn").onclick = applyResolutions;
  $("#serverEditBtn").onclick = simulateServerEdit;
  $("#resetBtn").onclick = async () => {
    try {
      await api("/api/reset", {});
      localStorage.removeItem(LS_KEY);
      location.reload();
    } catch (e) {
      logSync("重置失败（当前离线）", "conflict");
    }
  };
  $("#fTitle").addEventListener("input", (e) => onEdit("title", e.target.value));
  $("#fBody").addEventListener("input", (e) => onEdit("body", e.target.value));
  $("#fAssignee").addEventListener("input", (e) => onEdit("assignee", e.target.value));
  renderAll();
  refreshFromServer();
}

document.addEventListener("DOMContentLoaded", init);
