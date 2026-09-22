"use strict";
/* 离线笔记前端：本地存储 + 待提交队列 + 顺序同步 + 冲突解决 */

const LS_NOTES = "offnotes.notes";
const LS_QUEUE = "offnotes.queue";
const LS_ONLINE = "offnotes.online";

function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; }
  catch (e) { return fallback; }
}
function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
function uuid() {
  return "xxxxxxxx-4xxx".replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16)) + "-" + Date.now();
}
function fmtTime(ts) { return new Date(ts).toLocaleTimeString(); }

// ---- 全局状态 ----
let notes = load(LS_NOTES, {});      // id -> {id,title,content,version,updated_at}
let queue = load(LS_QUEUE, []);      // 待提交队列（含历史状态）
let online = load(LS_ONLINE, true);
let currentId = null;
let flushing = false;
let activeConflictNote = null;
const logs = [];

function persist() { save(LS_NOTES, notes); save(LS_QUEUE, queue); }

function log(msg) {
  logs.unshift(`[${fmtTime(Date.now())}] ${msg}`);
  if (logs.length > 40) logs.pop();
  renderLogs();
}

const $ = (id) => document.getElementById(id);

// ---- 网络开关（模拟断网/重连）----
function setOnline(v, reason) {
  online = v;
  save(LS_ONLINE, v);
  $("netToggle").checked = v;
  $("netDot").className = "dot " + (v ? "on" : "off");
  $("netLabel").textContent = v ? "在线" : "离线（改动将暂存本地队列）";
  if (reason) log(reason);
  if (v) tryFlush();
}

// ---- 本地编辑：所有改动先进入队列 ----
function enqueue(type, note) {
  // 同一笔记的连续 update 且尚未提交时，合并为一条（保留最新快照）
  if (type === "update") {
    // 同一笔记尚未提交的 create/update 直接合并快照，避免产生过期基线
    const last = [...queue].reverse().find(
      (it) => it.note_id === note.id && it.status === "pending");
    if (last && (last.type === "update" || last.type === "create")) {
      last.title = note.title; last.content = note.content; last.ts = Date.now();
      persist(); renderAll(); tryFlush();
      return;
    }
  }
  queue.push({
    op_id: uuid(), note_id: note.id, type,
    title: note.title, content: note.content,
    base_version: note.version, ts: Date.now(),
    status: "pending", message: "等待提交", server_note: null, reason: null,
  });
  persist(); renderAll(); tryFlush();
}

function createNote() {
  const id = "n-" + uuid();
  notes[id] = { id, title: "未命名笔记", content: "", version: 0,
                updated_at: Date.now() / 1000 };
  currentId = id;
  enqueue("create", notes[id]);
}

function editCurrent(field, value) {
  const n = notes[currentId];
  if (!n) return;
  n[field] = value;
  n.updated_at = Date.now() / 1000;
  persist(); renderNoteList(); renderMeta();
  clearTimeout(editCurrent._t);
  editCurrent._t = setTimeout(() => enqueue("update", n), 500);
}

function deleteCurrent() {
  const n = notes[currentId];
  if (!n) return;
  if (!confirm(`删除笔记「${n.title}」？`)) return;
  if (n.version === 0) {
    // 从未同步过：直接丢弃本地待提交的 create/update
    queue.forEach((it) => {
      if (it.note_id === n.id && (it.status === "pending" || it.status === "blocked")) {
        it.status = "resolved"; it.message = "笔记未同步即被删除，无需提交";
      }
    });
  } else {
    enqueue("delete", n);
  }
  delete notes[n.id];
  currentId = null;
  persist(); renderAll();
}

// ---- 顺序提交队列；网络中断时保留未完成项，已完成项不重复提交 ----
async function tryFlush() {
  if (!online || flushing) return;
  flushing = true;
  try {
    for (const it of queue) {
      if (it.status !== "pending") continue;
      it.status = "sending"; it.message = "提交中…"; persist(); renderQueue();
      let resp;
      try {
        resp = await fetch("/api/op", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(it),
        });
      } catch (e) {
        it.status = "pending"; it.message = "网络中断，等待下次重连";
        persist(); renderAll();
        setOnline(false, "提交过程中网络中断，剩余改动保留在队列中");
        return;
      }
      const data = await resp.json();
      if (resp.status === 200) {
        it.status = "done";
        it.message = data.message || "已提交";
        const n = notes[it.note_id];
        if (n && data.version) n.version = data.version;
        // 同一笔记后续排队的改动，基线版本顺延到刚提交的版本，
        // 保证 create→update→delete 链按顺序提交时基线始终正确
        if (data.version) {
          queue.forEach((o) => {
            if (o.note_id === it.note_id && o.status === "pending")
              o.base_version = data.version;
          });
        }
        if (it.type === "delete") log(`删除已提交：${it.title}`);
        else log(`已提交 ${it.type}：${it.title}（${it.message}）`);
      } else if (resp.status === 409) {
        it.status = "conflict";
        it.reason = data.reason;
        it.server_note = data.server_note;
        it.message = "冲突：" + data.reason;
        // 同一笔记后续的改动被阻塞，等待冲突解决
        queue.forEach((o) => {
          if (o.note_id === it.note_id && o.status === "pending") {
            o.status = "blocked"; o.message = "等待冲突解决后再提交";
          }
        });
        log(`冲突：${it.title} — ${data.reason}`);
      } else {
        it.status = "pending"; it.message = "服务端错误，稍后重试";
      }
      persist(); renderAll();
    }
  } finally {
    flushing = false;
  }
}

// ---- 冲突解决 ----
function conflictItem(noteId) {
  return [...queue].reverse().find(
    (it) => it.note_id === noteId && it.status === "conflict");
}

function markResolved(noteId, msg) {
  queue.forEach((it) => {
    if (it.note_id === noteId &&
        ["conflict", "blocked", "pending"].includes(it.status)) {
      it.status = "resolved"; it.message = msg;
    }
  });
  persist(); renderAll();
}

async function resolveKeepLocal(noteId, title, content) {
  const it = conflictItem(noteId);
  if (!it) return;
  if (!online) { alert("当前离线，无法提交解决结果，请恢复网络后再试"); return; }
  const resp = await fetch("/api/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      op_id: uuid(), note_id: noteId,
      base_version: it.server_note ? it.server_note.version : 0,
      title, content,
    }),
  });
  const data = await resp.json();
  if (resp.status === 200) {
    const n = notes[noteId];
    if (n) { n.title = title; n.content = content; n.version = data.version; }
    markResolved(noteId, "已解决：采用本地/合并内容，结果已提交服务端");
    log(`冲突已解决（保留本地/合并）：${title} → 服务端 v${data.version}`);
    closePanel();
  } else {
    alert("解决失败：" + (data.reason || "未知错误"));
  }
}

function resolveKeepServer(noteId) {
  const it = conflictItem(noteId);
  if (!it) return;
  const s = it.server_note;
  if (s && !s.deleted) {
    notes[noteId] = { id: noteId, title: s.title, content: s.content,
                      version: s.version, updated_at: s.updated_at };
  } else {
    delete notes[noteId];  // 服务端已删除，本地同步移除
    if (currentId === noteId) currentId = null;
  }
  markResolved(noteId, "已解决：采用服务端版本，本地改动已放弃");
  log(`冲突已解决（保留服务端）：${s ? s.title : noteId}`);
  closePanel();
}

// ---- 行级 diff（LCS），用于并排展示 ----
function diffLines(a, b) {
  const A = a.split("\n"), B = b.split("\n");
  const m = A.length, n = B.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1
                               : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (A[i] === B[j]) { ops.push(["same", A[i], B[j]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push(["del", A[i], ""]); i++; }
    else { ops.push(["add", "", B[j]]); j++; }
  }
  while (i < m) ops.push(["del", A[i++], ""]);
  while (j < n) ops.push(["add", "", B[j++]]);
  return ops;
}

function renderDiff(ops) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  let left = "", right = "";
  for (const [op, a, b] of ops) {
    if (op === "same") {
      left += `<span class="same">${esc(a)}</span>`;
      right += `<span class="same">${esc(b)}</span>`;
    } else if (op === "del") {
      left += `<span class="del">${esc(a)}</span>`;
      right += `<span class="empty-line">&nbsp;</span>`;
    } else {
      left += `<span class="empty-line">&nbsp;</span>`;
      right += `<span class="add">${esc(b)}</span>`;
    }
  }
  $("diffLocal").innerHTML = left;
  $("diffServer").innerHTML = right;
}

// ---- 冲突面板 ----
function openConflict(noteId) {
  const it = conflictItem(noteId);
  const local = notes[noteId];
  if (!it) return;
  activeConflictNote = noteId;
  // 服务端可能已删除该笔记，此时用空快照占位，仍允许保留本地重建
  const s = it.server_note ||
    { title: "（服务端不存在）", content: "", version: 0,
      updated_at: it.ts / 1000 };
  const localTitle = local ? local.title : it.title;
  const localContent = local ? local.content : it.content;
  $("conflictReason").textContent =
    `冲突原因：${it.reason}。你在离线期间基于服务端 v${it.base_version} ` +
    `修改了这条笔记，而服务端已被更新到 v${s.version}` +
    `（${new Date(s.updated_at * 1000).toLocaleString()}）。` +
    `两侧修改互不知情，系统不会自动覆盖任何一方，请选择如何处理。`;
  $("localHead").textContent =
    `本地版本（基于 v${it.base_version} 修改）：${localTitle}`;
  $("serverHead").textContent = `服务端版本 v${s.version}：${s.title}`;
  renderDiff(diffLines(
    localTitle + "\n" + localContent, s.title + "\n" + s.content));
  $("mergeArea").hidden = true;
  $("mergeSubmitBtn").hidden = true;
  $("mergeBtn").hidden = false;
  $("mergeTitle").value = localTitle;
  $("mergeContent").value = localContent;
  $("conflictPanel").hidden = false;
}

function closePanel() {
  $("conflictPanel").hidden = true;
  activeConflictNote = null;
}

// ---- 渲染 ----
const STATUS_LABEL = { pending: "待提交", sending: "提交中", done: "已提交",
  conflict: "冲突", blocked: "已阻塞", resolved: "已解决" };

function pendingCount(noteId) {
  return queue.filter((it) => it.note_id === noteId &&
    ["pending", "sending", "blocked"].includes(it.status)).length;
}

function renderNoteList() {
  const ul = $("noteList");
  ul.innerHTML = "";
  Object.values(notes).sort((a, b) => b.updated_at - a.updated_at)
    .forEach((n) => {
      const li = document.createElement("li");
      li.className = n.id === currentId ? "active" : "";
      li.textContent = n.title || "（无标题）";
      const pc = pendingCount(n.id);
      if (pc > 0) {
        const b = document.createElement("span");
        b.className = "badge"; b.textContent = `待提交 ${pc}`;
        li.appendChild(b);
      }
      if (conflictItem(n.id)) {
        const b = document.createElement("span");
        b.className = "badge"; b.style.color = "#c53030";
        b.textContent = "冲突"; li.appendChild(b);
      }
      li.onclick = () => { currentId = n.id; renderAll(); };
      ul.appendChild(li);
    });
}

function renderMeta() {
  const n = notes[currentId];
  if (!n) return;
  $("noteMeta").textContent =
    `服务端版本 v${n.version} · 待提交 ${pendingCount(n.id)} 条 · ` +
    `更新于 ${new Date(n.updated_at * 1000).toLocaleTimeString()}`;
}

function renderEditor() {
  const n = notes[currentId];
  $("editorEmpty").hidden = !!n;
  $("editorBody").hidden = !n;
  if (!n) return;
  if (document.activeElement !== $("noteTitle")) $("noteTitle").value = n.title;
  if (document.activeElement !== $("noteContent"))
    $("noteContent").value = n.content;
  renderMeta();
}

function renderQueue() {
  const ul = $("queueList");
  ul.innerHTML = "";
  const active = queue.filter((it) => it.status !== "done" &&
                                it.status !== "resolved").length;
  $("queueCount").textContent = active ? `（${active} 条未完成）` : "";
  [...queue].reverse().forEach((it) => {
    const li = document.createElement("li");
    li.innerHTML =
      `<span class="st st-${it.status}">${STATUS_LABEL[it.status]}</span>` +
      `<b>${it.type}</b> ${it.title || "(无标题)"}<br>` +
      `<small>${fmtTime(it.ts)} · ${it.message || ""}</small>`;
    ul.appendChild(li);
  });
}

function renderConflicts() {
  const ul = $("conflictList");
  ul.innerHTML = "";
  const items = queue.filter((it) => it.status === "conflict");
  $("conflictCount").textContent = items.length ? `（${items.length}）` : "";
  items.forEach((it) => {
    const li = document.createElement("li");
    li.textContent = `${it.title} — 点击查看差异并解决`;
    li.onclick = () => openConflict(it.note_id);
    ul.appendChild(li);
  });
}

function renderLogs() {
  const ul = $("logList");
  if (!ul) return;
  ul.innerHTML = "";
  logs.forEach((l) => {
    const li = document.createElement("li"); li.textContent = l;
    ul.appendChild(li);
  });
}

function renderAll() {
  renderNoteList(); renderEditor(); renderQueue(); renderConflicts();
}

// ---- 初始化与事件绑定 ----
async function hydrateFromServer() {
  if (!online) return;
  try {
    const resp = await fetch("/api/notes");
    const data = await resp.json();
    data.notes.forEach((s) => {
      if (!notes[s.id] && !queue.some((it) => it.note_id === s.id)) {
        notes[s.id] = { id: s.id, title: s.title, content: s.content,
                        version: s.version, updated_at: s.updated_at };
      }
    });
    persist(); renderAll();
  } catch (e) {
    setOnline(false, "无法连接服务端，已进入离线模式");
  }
}

async function simulateServerEdit() {
  const n = notes[currentId];
  if (!n) return;
  if (!online) { alert("离线状态下无法模拟服务端修改"); return; }
  const resp = await fetch("/api/debug/server-edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      note_id: n.id, title: n.title,
      content: n.content + `\n[服务端在 ${fmtTime(Date.now())} 被他人修改]`,
    }),
  });
  const data = await resp.json();
  log(`模拟：他人在服务端修改了「${n.title}」，服务端版本 → v${data.note.version}`);
}

window.addEventListener("DOMContentLoaded", () => {
  $("netToggle").onchange = (e) =>
    setOnline(e.target.checked, e.target.checked ? "网络已恢复，开始自动提交"
                                                 : "已断网，改动将暂存本地");
  $("syncNowBtn").onclick = () => tryFlush();
  $("newNoteBtn").onclick = () => createNote();
  $("noteTitle").oninput = (e) => editCurrent("title", e.target.value);
  $("noteContent").oninput = (e) => editCurrent("content", e.target.value);
  $("deleteBtn").onclick = () => deleteCurrent();
  $("serverEditBtn").onclick = () => simulateServerEdit();
  $("closePanelBtn").onclick = () => closePanel();
  $("keepLocalBtn").onclick = () => {
    const n = notes[activeConflictNote];
    if (n) resolveKeepLocal(activeConflictNote, n.title, n.content);
  };
  $("keepServerBtn").onclick = () => resolveKeepServer(activeConflictNote);
  $("mergeBtn").onclick = () => {
    $("mergeArea").hidden = false;
    $("mergeSubmitBtn").hidden = false;
    $("mergeBtn").hidden = true;
  };
  $("mergeSubmitBtn").onclick = () =>
    resolveKeepLocal(activeConflictNote,
                     $("mergeTitle").value, $("mergeContent").value);
  window.addEventListener("online", () => setOnline(true, "浏览器检测到网络恢复"));
  window.addEventListener("offline", () => setOnline(false, "浏览器检测到网络断开"));
  setOnline(online);
  renderAll();
  hydrateFromServer();
  setInterval(() => { if (online) tryFlush(); }, 4000);
});
