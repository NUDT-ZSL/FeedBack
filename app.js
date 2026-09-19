/* 多人共编协调工具 —— 合成引擎 + 界面（纯本地，无依赖） */
"use strict";

/* ---------------- 状态 ---------------- */
const App = {
  segments: [],    // {id, base} 有序片段
  edits: [],       // {id, source, seq, segmentId, content, status, invalidReason}
                   // status: "active" | "retracted" | "invalid"
  resolutions: {}, // segmentId -> {type:"pick", editId} | {type:"manual", text}
  derived: {},     // segmentId -> 推导结果（见 deriveSegment）
  dirty: {},       // segmentId -> true 表示因撤回/改写被重新推导过
  seqCounter: 1,
  editCounter: 1,
  segCounter: 1,
  editingEditId: null, // 表单处于“改写某条修改”模式时为该修改 id
  log: [],
};

/* ---------------- 引擎 ---------------- */
function findSegment(id) {
  return App.segments.find((s) => s.id === id) || null;
}
function findEdit(id) {
  return App.edits.find((e) => e.id === id) || null;
}

/* 校验一条修改：返回 null 表示合法，否则返回可读原因 */
function validateEdit(e) {
  if (!e.source || !e.source.trim()) return "缺少来源（编辑者）";
  if (!findSegment(e.segmentId)) return "指向不存在的片段「" + e.segmentId + "」";
  return null;
}

/* 收集某片段的有效候选：内容相同的修改合并为一候选项，按 (顺序, id) 确定排序 */
function candidatesFor(segId) {
  const map = new Map();
  App.edits
    .filter((e) => e.status === "active" && e.segmentId === segId)
    .sort((a, b) => a.seq - b.seq || a.id - b.id)
    .forEach((e) => {
      if (!map.has(e.content)) map.set(e.content, { content: e.content, editIds: [], sources: [] });
      const c = map.get(e.content);
      c.editIds.push(e.id);
      c.sources.push(e.source);
    });
  return Array.from(map.values());
}

/* 由当前全部有效修改推导单个片段 */
function deriveSegment(segId) {
  const seg = findSegment(segId);
  const cands = candidatesFor(segId);
  let res = App.resolutions[segId] || null;

  // 冲突已消失或裁决引用的修改已失效时，自动清理过期裁决
  if (res) {
    const stale =
      cands.length < 2 ||
      (res.type === "pick" && !cands.some((c) => c.editIds.includes(res.editId)));
    if (stale) {
      delete App.resolutions[segId];
      res = null;
    }
  }

  if (cands.length === 0) {
    return { final: seg.base, kind: "base", sources: [], candidates: [], conflictOpen: false };
  }
  if (cands.length === 1) {
    return { final: cands[0].content, kind: "edit", sources: cands[0].sources.slice(),
             candidates: cands, conflictOpen: false };
  }
  // 多个不同候选：冲突必须保留，绝不静默择一
  const allSources = cands.reduce((acc, c) => acc.concat(c.sources), []);
  if (res && res.type === "manual") {
    return { final: res.text, kind: "manual", sources: allSources,
             candidates: cands, conflictOpen: false };
  }
  if (res && res.type === "pick") {
    const c = cands.find((x) => x.editIds.includes(res.editId));
    return { final: c.content, kind: "pick", sources: c.sources.slice(),
             candidates: cands, conflictOpen: false };
  }
  return { final: null, kind: "conflict", sources: allSources,
           candidates: cands, conflictOpen: true };
}

/* 增量重推导：只重算受影响的片段，并给结果发生变化的片段打“重新推导”标记 */
function rederive(segIds, reason) {
  const changed = [];
  Array.from(new Set(segIds)).forEach((id) => {
    if (!findSegment(id)) return;
    const before = JSON.stringify(App.derived[id] || null);
    App.derived[id] = deriveSegment(id);
    if (JSON.stringify(App.derived[id]) !== before) {
      App.dirty[id] = true;
      changed.push(id);
    }
  });
  if (changed.length) addLog("重新推导片段：" + changed.join("、") + "（" + reason + "）", "info");
  render();
}

/* 从头全量重算，并与当前增量结果逐片段比对（需求 4 的一致性保证） */
function verifyFromScratch() {
  const mismatches = [];
  App.segments.forEach((s) => {
    const fresh = deriveSegment(s.id);
    if (JSON.stringify(fresh) !== JSON.stringify(App.derived[s.id])) mismatches.push(s.id);
  });
  if (mismatches.length === 0) {
    addLog("从头校验通过：增量重推导结果与全量重新合成完全一致（共 " +
           App.segments.length + " 个片段）。", "ok");
  } else {
    addLog("从头校验发现不一致的片段：" + mismatches.join("、"), "warn");
  }
  render();
}
/* ---------------- 操作 ---------------- */
function addLog(msg, level) {
  const t = new Date();
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  const ss = String(t.getSeconds()).padStart(2, "0");
  App.log.unshift({ time: hh + ":" + mm + ":" + ss, msg: msg, level: level || "info" });
  if (App.log.length > 60) App.log.pop();
}

function submitEdit(fields) {
  const e = {
    id: App.editCounter++,
    source: (fields.source || "").trim(),
    seq: fields.seq,
    segmentId: fields.segmentId,
    content: fields.content,
    status: "active",
    invalidReason: null,
  };
  const reason = validateEdit(e);
  App.edits.push(e);
  if (reason) {
    e.status = "invalid";
    e.invalidReason = reason;
    addLog("修改 #" + e.id + " 未参与合成：" + reason + "。其余内容不受影响。", "warn");
    render();
    return;
  }
  addLog("修改 #" + e.id + "（来源 " + e.source + "，顺序 " + e.seq +
         "，片段 " + e.segmentId + "）已纳入合成。", "info");
  rederive([e.segmentId], "新修改 #" + e.id);
}

function retractEdit(id) {
  const e = findEdit(id);
  if (!e || e.status !== "active") return;
  e.status = "retracted";
  addLog("修改 #" + id + " 已撤回。", "info");
  rederive([e.segmentId], "修改 #" + id + " 被撤回");
}

function restoreEdit(id) {
  const e = findEdit(id);
  if (!e || e.status === "active") return;
  const reason = validateEdit(e);
  if (reason) {
    e.status = "invalid";
    e.invalidReason = reason;
    addLog("修改 #" + id + " 恢复失败：" + reason + "。", "warn");
    render();
    return;
  }
  e.status = "active";
  e.invalidReason = null;
  addLog("修改 #" + id + " 已恢复。", "info");
  rederive([e.segmentId], "修改 #" + id + " 被恢复");
}

/* 改写一条修改：保持 id 不变，重校验后只重推导新旧两个片段 */
function rewriteEdit(id, fields) {
  const e = findEdit(id);
  if (!e) return;
  const oldSeg = e.segmentId;
  e.source = (fields.source || "").trim();
  e.seq = fields.seq;
  e.segmentId = fields.segmentId;
  e.content = fields.content;
  const reason = validateEdit(e);
  if (reason) {
    e.status = "invalid";
    e.invalidReason = reason;
    addLog("修改 #" + id + " 改写后未参与合成：" + reason + "。其余内容不受影响。", "warn");
    rederive([oldSeg], "修改 #" + id + " 被改写为非法");
    return;
  }
  e.status = "active";
  e.invalidReason = null;
  addLog("修改 #" + id + " 已改写。", "info");
  rederive([oldSeg, e.segmentId], "修改 #" + id + " 被改写");
}

function resolvePick(segId, editId) {
  App.resolutions[segId] = { type: "pick", editId: editId };
  addLog("片段 " + segId + " 的冲突已裁决：采纳修改 #" + editId + "。", "ok");
  rederive([segId], "冲突裁决");
}

function resolveManual(segId, text) {
  if (!text.trim()) {
    addLog("手动改写内容不能为空。", "warn");
    render();
    return;
  }
  App.resolutions[segId] = { type: "manual", text: text };
  addLog("片段 " + segId + " 的冲突已手动改写。", "ok");
  rederive([segId], "冲突手动改写");
}

function clearResolution(segId) {
  if (App.resolutions[segId]) {
    delete App.resolutions[segId];
    addLog("片段 " + segId + " 的裁决已撤销，冲突重新开放。", "info");
    rederive([segId], "撤销裁决");
  }
}

function addSegment() {
  const id = "S" + App.segCounter++;
  App.segments.push({ id: id, base: "（空白片段，等待修改）" });
  App.derived[id] = deriveSegment(id);
  addLog("已新增片段 " + id + "。", "info");
  render();
}
/* ---------------- 渲染 ---------------- */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function kindLabel(kind) {
  return { base: "基础内容", edit: "已合成", pick: "已裁决·采纳一方",
           manual: "已裁决·手动改写", conflict: "冲突未决" }[kind] || kind;
}

function renderSegments() {
  const box = document.getElementById("segments");
  if (!App.segments.length) {
    box.innerHTML = '<p class="empty">暂无片段，点击“＋ 新增片段”开始。</p>';
    return;
  }
  box.innerHTML = App.segments.map((seg) => {
    const d = App.derived[seg.id] || deriveSegment(seg.id);
    App.derived[seg.id] = d;
    const cls = ["segment-card"];
    if (App.dirty[seg.id]) cls.push("dirty");
    if (d.conflictOpen) cls.push("has-conflict");
    const srcBadges = d.sources.map((s) =>
      '<span class="badge src">来源：' + esc(s) + "</span>").join(" ");
    const dirtyBadge = App.dirty[seg.id]
      ? '<span class="badge dirty" data-clear-dirty="' + seg.id +
        '" title="点击标记为已查看">⟳ 已重新推导</span>' : "";
    const stateBadge = d.conflictOpen
      ? '<span class="badge conflict">未决冲突 ×' + d.candidates.length + "</span>"
      : '<span class="badge ok">' + kindLabel(d.kind) + "</span>";
    const finalHtml = d.conflictOpen
      ? '<div class="seg-final unresolved">⟪ 冲突未解决：请在下方选择采纳或手动改写 ⟫</div>'
      : '<div class="seg-final">' + esc(d.final) + "</div>";
    return '<div class="' + cls.join(" ") + '">' +
      '<div class="seg-head"><span class="seg-id">片段 ' + esc(seg.id) + "</span>" +
      stateBadge + dirtyBadge + srcBadges + "</div>" +
      '<div class="seg-base">基础内容：' + esc(seg.base) + "</div>" +
      finalHtml + renderConflict(seg.id, d) + "</div>";
  }).join("");
}

function renderConflict(segId, d) {
  if (!d.candidates || d.candidates.length < 2) return "";
  let html = '<div class="conflict-box"><h3>冲突候选（' + d.candidates.length + " 方）</h3>";
  d.candidates.forEach((c) => {
    const picked = App.resolutions[segId] && App.resolutions[segId].type === "pick" &&
                   c.editIds.includes(App.resolutions[segId].editId);
    html += '<div class="candidate"><div class="who">' +
      c.sources.map((s, i) => esc(s) + "（#" + c.editIds[i] + "）").join("、") +
      '</div><div>' + esc(c.content) + '</div><div>' +
      (picked
        ? '<span class="badge ok">已采纳</span>'
        : '<button class="small primary" data-pick="' + segId + ":" + c.editIds[0] +
          '">采纳此方</button>') +
      "</div></div>";
  });
  if (App.resolutions[segId]) {
    html += '<div class="resolved-note">当前裁决：' +
      (App.resolutions[segId].type === "manual" ? "手动改写" : "采纳候选") +
      ' <button class="small" data-unresolve="' + segId + '">撤销裁决</button></div>';
  }
  html += '<div class="manual-row"><input type="text" id="manual-' + segId +
    '" placeholder="手动改写为…"><button class="small" data-manual="' + segId +
    '">采用手动改写</button></div></div>';
  return html;
}
function renderEdits() {
  const box = document.getElementById("edit-list");
  if (!App.edits.length) {
    box.innerHTML = '<p class="empty">尚无修改记录。</p>';
    return;
  }
  box.innerHTML = App.edits.map((e) => {
    const cls = "edit-item" + (e.status === "retracted" ? " retracted" : "") +
                (e.status === "invalid" ? " invalid" : "");
    const statusText = { active: "生效中", retracted: "已撤回", invalid: "非法·未参与合成" }[e.status];
    let html = '<div class="' + cls + '"><div class="meta">#' + e.id +
      " · 来源 " + (e.source ? esc(e.source) : "（缺失）") +
      " · 顺序 " + e.seq + " · 片段 " + esc(e.segmentId) + " · " + statusText + "</div>" +
      '<div class="content">' + esc(e.content) + "</div>";
    if (e.status === "invalid")
      html += '<div class="meta">原因：' + esc(e.invalidReason) + "</div>";
    html += '<div class="ops">';
    if (e.status === "active")
      html += '<button class="small" data-retract="' + e.id + '">撤回</button>';
    else
      html += '<button class="small" data-restore="' + e.id + '">恢复</button>';
    html += '<button class="small" data-rewrite="' + e.id + '">改写</button></div></div>';
    return html;
  }).join("");
}

function renderLog() {
  const box = document.getElementById("log");
  box.innerHTML = App.log.length
    ? App.log.map((l) => '<div class="log-entry ' + l.level + '"><span class="time">' +
        l.time + "</span>" + esc(l.msg) + "</div>").join("")
    : '<p class="empty">暂无日志。</p>';
}

function renderSegmentOptions() {
  const sel = document.getElementById("f-segment");
  const cur = sel.value;
  sel.innerHTML = App.segments.map((s) =>
    '<option value="' + s.id + '">' + s.id + "</option>").join("");
  if (cur && findSegment(cur)) sel.value = cur;
}

function render() {
  renderSegments();
  renderEdits();
  renderLog();
  renderSegmentOptions();
  const seqInput = document.getElementById("f-seq");
  if (!seqInput.value) seqInput.value = App.seqCounter;
}
/* ---------------- 事件 ---------------- */
function readForm() {
  return {
    source: document.getElementById("f-source").value,
    seq: parseInt(document.getElementById("f-seq").value, 10) || App.seqCounter,
    segmentId: document.getElementById("f-segment").value,
    content: document.getElementById("f-content").value,
  };
}

function resetForm() {
  App.editingEditId = null;
  document.getElementById("form-title").textContent = "提交修改";
  document.getElementById("f-submit").textContent = "提交修改";
  document.getElementById("f-cancel").classList.add("hidden");
  document.getElementById("f-source").value = "";
  document.getElementById("f-content").value = "";
  document.getElementById("f-seq").value = App.seqCounter;
}

function enterRewriteMode(id) {
  const e = findEdit(id);
  if (!e) return;
  App.editingEditId = id;
  document.getElementById("form-title").textContent = "改写修改 #" + id;
  document.getElementById("f-submit").textContent = "保存改写";
  document.getElementById("f-cancel").classList.remove("hidden");
  document.getElementById("f-source").value = e.source;
  document.getElementById("f-seq").value = e.seq;
  document.getElementById("f-segment").value = e.segmentId;
  document.getElementById("f-content").value = e.content;
  document.getElementById("f-source").focus();
}

function bindEvents() {
  document.getElementById("edit-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const fields = readForm();
    App.seqCounter = Math.max(App.seqCounter, fields.seq + 1);
    if (App.editingEditId) rewriteEdit(App.editingEditId, fields);
    else submitEdit(fields);
    resetForm();
  });
  document.getElementById("f-cancel").addEventListener("click", resetForm);
  document.getElementById("btn-add-segment").addEventListener("click", addSegment);
  document.getElementById("btn-verify").addEventListener("click", verifyFromScratch);
  document.getElementById("btn-clear-dirty").addEventListener("click", () => {
    App.dirty = {};
    render();
  });
  document.getElementById("btn-reset").addEventListener("click", () => {
    seed();
    addLog("已重置为演示数据。", "info");
    render();
  });

  document.body.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.dataset.retract) retractEdit(parseInt(t.dataset.retract, 10));
    else if (t.dataset.restore) restoreEdit(parseInt(t.dataset.restore, 10));
    else if (t.dataset.rewrite) enterRewriteMode(parseInt(t.dataset.rewrite, 10));
    else if (t.dataset.pick) {
      const seg = t.dataset.pick.split(":")[0];
      const eid = parseInt(t.dataset.pick.split(":")[1], 10);
      resolvePick(seg, eid);
    } else if (t.dataset.manual) {
      const input = document.getElementById("manual-" + t.dataset.manual);
      resolveManual(t.dataset.manual, input ? input.value : "");
    } else if (t.dataset.unresolve) clearResolution(t.dataset.unresolve);
    else if (t.dataset.clearDirty) {
      delete App.dirty[t.dataset.clearDirty];
      render();
    }
  });
}

/* ---------------- 演示数据与启动 ---------------- */
function seed() {
  App.segments = [
    { id: "S1", base: "项目目标：发布 1.0 版本" },
    { id: "S2", base: "预算：10 万元" },
    { id: "S3", base: "上线日期：待定" },
  ];
  App.edits = [];
  App.resolutions = {};
  App.derived = {};
  App.dirty = {};
  App.log = [];
  App.seqCounter = 1;
  App.editCounter = 1;
  App.segCounter = 4;
  App.editingEditId = null;

  submitEdit({ source: "编辑者甲", seq: 1, segmentId: "S1",
               content: "项目目标：发布 1.0 版本（含移动端）" });
  submitEdit({ source: "编辑者乙", seq: 2, segmentId: "S1",
               content: "项目目标：直接发布 2.0 版本" });
  submitEdit({ source: "编辑者丙", seq: 3, segmentId: "S2",
               content: "预算：12 万元（追加测试费用）" });
  App.log = [];
  App.dirty = {};
  addLog("演示数据已载入：S1 存在双方冲突，S2 为单方修改，S3 保持基础内容。", "info");
}

bindEvents();
seed();
render();