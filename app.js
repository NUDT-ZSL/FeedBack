/* app.js — 界面 wiring：画布渲染、编辑面板、冲突清单、增量重推 */
"use strict";

var SAMPLE = {
  container: { width: 560, padL: 20, padR: 20, padT: 16, padB: 16, gapX: 12, gapY: 10 },
  blocks: [
    { id: "title", name: "标题", width: 220, height: 40, grow: 1, shrink: 1, minW: 140, maxW: 520, canBreakBefore: false, baseline: 32 },
    { id: "badge", name: "角标", width: 72, height: 24, grow: 0, shrink: 1, minW: 56, maxW: 120, canBreakBefore: true, baseline: 19 },
    { id: "cover", name: "封面图", width: 200, height: 130, grow: 0, shrink: 1, minW: 120, maxW: 520, canBreakBefore: true, baseline: 130 },
    { id: "intro", name: "简介", width: 280, height: 64, grow: 1, shrink: 2, minW: 160, maxW: 520, canBreakBefore: true, baseline: 50 },
    { id: "meta", name: "元信息", width: 150, height: 28, grow: 0, shrink: 1, minW: 110, maxW: 300, canBreakBefore: true, baseline: 22 },
    { id: "action", name: "操作区", width: 180, height: 36, grow: 0, shrink: 0, minW: 180, maxW: 180, canBreakBefore: true, baseline: 30 }
  ]
};

var state = {
  container: null,
  blocks: [],
  selectedId: null,
  lastResult: null,
  lastIncremental: null
};

function $(id) { return document.getElementById(id); }

function loadData(data) {
  state.container = LayoutEngine.normalizeContainer(data.container);
  state.blocks = (data.blocks || []).map(function (b, i) {
    return LayoutEngine.normalizeBlock(b, i);
  });
  state.selectedId = state.blocks.length ? state.blocks[0].id : null;
  state.lastResult = null;
  recompute(null); // 结构性变化：整链全推
}

/* changedIds 为 null → 全量重推；否则增量重推并校验与全量一致 */
function recompute(changedIds) {
  var t0 = performance.now();
  if (changedIds && state.lastResult) {
    var inc = LayoutEngine.solveIncremental(state.lastResult, state.container, state.blocks, changedIds);
    state.lastResult = inc.result;
    state.lastIncremental = inc;
  } else {
    state.lastResult = LayoutEngine.solve(state.container, state.blocks);
    state.lastIncremental = null;
  }
  var ms = (performance.now() - t0).toFixed(1);
  renderAll(ms);
}

function renderAll(ms) {
  renderBadge(ms);
  renderCanvas();
  renderBlockList();
  renderConflicts();
  renderEditor();
  renderReasons();
  syncContainerInputs();
}

function renderBadge(ms) {
  var el = $("recomputeBadge");
  var inc = state.lastIncremental;
  if (inc) {
    el.textContent = "增量重推：自第 " + (inc.resolvedFromLine + 1) + " 行起 / 共 " +
      inc.totalLines + " 行 · " +
      (inc.consistentWithFull ? "与整链全推一致 ✓" : "已回退全量重推") +
      " · " + ms + "ms";
    el.className = "badge" + (inc.consistentWithFull ? "" : " mismatch");
  } else {
    el.textContent = "整链全量重推 · " + state.lastResult.lines.length + " 行 · " + ms + "ms";
    el.className = "badge";
  }
}

var STATE_LABEL = {
  normal: "固有", grow: "拉伸", shrink: "压缩",
  squeezed: "被挤压", overflow: "溢出", pinned: "固定"
};

function renderCanvas() {
  var stage = $("stage");
  stage.innerHTML = "";
  var r = state.lastResult;
  var c = r.container;
  var box = document.createElement("div");
  box.className = "container-box";
  box.style.width = c.width + "px";
  box.style.height = r.totalHeight + "px";

  // 内边距参考区
  var pad = document.createElement("div");
  pad.className = "pad-guide";
  pad.style.left = c.padL + "px"; pad.style.top = c.padT + "px";
  pad.style.width = Math.max(0, c.width - c.padL - c.padR) + "px";
  pad.style.height = Math.max(0, r.totalHeight - c.padT - c.padB) + "px";
  box.appendChild(pad);

  // 行分隔与基线参考线
  r.lines.forEach(function (line) {
    var lg = document.createElement("div");
    lg.className = "line-guide";
    lg.style.top = (line.y + line.height) + "px";
    box.appendChild(lg);
    var bg = document.createElement("div");
    bg.className = "baseline-guide";
    bg.style.top = (line.y + line.baseline) + "px";
    bg.title = "行 " + (line.index + 1) + " 基线";
    box.appendChild(bg);
  });

  state.blocks.forEach(function (b) {
    var p = r.placements[b.id];
    if (!p) return;
    var el = document.createElement("div");
    el.className = "blk " + p.state + (b.id === state.selectedId ? " sel" : "");
    el.style.left = p.x + "px"; el.style.top = p.y + "px";
    el.style.width = Math.max(2, p.width) + "px";
    el.style.height = Math.max(2, p.height) + "px";
    el.innerHTML = "<span></span> <span class='dim'></span>";
    el.children[0].textContent = b.name;
    el.children[1].textContent = Math.round(p.width) + "×" + Math.round(p.height);
    el.title = b.name + " · " + STATE_LABEL[p.state];
    el.onclick = function () { state.selectedId = b.id; renderAll("-"); };
    box.appendChild(el);
  });

  stage.appendChild(box);
}

function renderBlockList() {
  var ul = $("blockList");
  ul.innerHTML = "";
  var r = state.lastResult;
  state.blocks.forEach(function (b) {
    var li = document.createElement("li");
    if (b.id === state.selectedId) li.className = "sel";
    var st = r.placements[b.id] ? STATE_LABEL[r.placements[b.id].state] : "";
    var name = document.createElement("span");
    name.textContent = b.name + " ";
    var stEl = document.createElement("span");
    stEl.className = "st"; stEl.textContent = st;
    var del = document.createElement("span");
    del.className = "del"; del.textContent = "×"; del.title = "删除";
    del.onclick = function (ev) {
      ev.stopPropagation();
      state.blocks = state.blocks.filter(function (x) { return x.id !== b.id; });
      if (state.selectedId === b.id) {
        state.selectedId = state.blocks.length ? state.blocks[0].id : null;
      }
      state.lastResult = null;
      recompute(null);
    };
    li.appendChild(name); li.appendChild(stEl); li.appendChild(del);
    li.onclick = function () { state.selectedId = b.id; renderAll("-"); };
    ul.appendChild(li);
  });
}

function renderConflicts() {
  var ul = $("conflictList");
  ul.innerHTML = "";
  var cs = state.lastResult.conflicts;
  $("conflictCount").textContent = cs.length ? cs.length + " 项" : "";
  if (!cs.length) {
    var li = document.createElement("li");
    li.className = "none";
    li.textContent = "当前无冲突，所有约束均可满足。";
    ul.appendChild(li);
    return;
  }
  cs.forEach(function (c) {
    var li = document.createElement("li");
    var d = document.createElement("div");
    d.textContent = "[" + c.type + "] " + c.detail;
    var sides = document.createElement("div");
    sides.className = "sides";
    sides.textContent = "保留双方 — A: " + c.keepA + " ｜ B: " + c.keepB;
    li.appendChild(d); li.appendChild(sides);
    li.onclick = function () {
      if (c.blockIds.length) { state.selectedId = c.blockIds[0]; renderAll("-"); }
    };
    ul.appendChild(li);
  });
}

function findBlock(id) {
  for (var i = 0; i < state.blocks.length; i++) {
    if (state.blocks[i].id === id) return state.blocks[i];
  }
  return null;
}

var ED_FIELDS = [
  ["name", "名称", "text"], ["width", "固有宽", "number"], ["height", "高度", "number"],
  ["grow", "伸展倾向", "number"], ["shrink", "收缩倾向", "number"],
  ["minW", "最小宽", "number"], ["maxW", "最大宽", "text"],
  ["baseline", "基线偏移", "number"]
];

function renderEditor() {
  var ed = $("editor");
  ed.innerHTML = "";
  var b = findBlock(state.selectedId);
  $("edName").textContent = b ? "· " + b.name : "";
  if (!b) { ed.textContent = "未选中内容块"; return; }

  ED_FIELDS.forEach(function (f) {
    var lab = document.createElement("label");
    var sp = document.createElement("span"); sp.textContent = f[1];
    var inp = document.createElement("input");
    inp.type = f[2];
    inp.value = f[0] === "maxW" && !isFinite(b.maxW) ? "" : b[f[0]];
    if (f[0] === "maxW") inp.placeholder = "∞";
    inp.onchange = function () {
      var v = inp.value;
      if (f[0] === "name") b.name = v;
      else if (f[0] === "maxW") b.maxW = v === "" ? Infinity : Math.max(0, Number(v) || 0);
      else b[f[0]] = Number(v) || 0;
      recompute([b.id]);
    };
    lab.appendChild(sp); lab.appendChild(inp);
    ed.appendChild(lab);
  });

  var wrapLab = document.createElement("label");
  var wsp = document.createElement("span"); wsp.textContent = "允许前换行";
  var wcb = document.createElement("input");
  wcb.type = "checkbox"; wcb.checked = b.canBreakBefore;
  wcb.onchange = function () { b.canBreakBefore = wcb.checked; recompute([b.id]); };
  wrapLab.appendChild(wsp); wrapLab.appendChild(wcb);
  ed.appendChild(wrapLab);

  var pinLab = document.createElement("label");
  var psp = document.createElement("span"); psp.textContent = "手动固定宽";
  var pcb = document.createElement("input");
  pcb.type = "checkbox"; pcb.checked = b.pinned;
  var pinNum = document.createElement("input");
  pinNum.type = "number"; pinNum.value = b.pinnedWidth; pinNum.style.width = "70px";
  pinNum.disabled = !b.pinned;
  pcb.onchange = function () {
    b.pinned = pcb.checked;
    if (b.pinned) b.pinnedWidth = Number(pinNum.value) || b.width;
    recompute([b.id]); // 手动固定 → 只重推受影响相邻区域
  };
  pinNum.onchange = function () {
    b.pinnedWidth = Math.max(0, Number(pinNum.value) || 0);
    if (b.pinned) recompute([b.id]);
  };
  pinLab.appendChild(psp); pinLab.appendChild(pcb); pinLab.appendChild(pinNum);
  ed.appendChild(pinLab);
}

function renderReasons() {
  var box = $("reasons");
  box.innerHTML = "";
  var b = findBlock(state.selectedId);
  if (!b) { box.innerHTML = "<span class='empty'>选择一个内容块查看其约束依据。</span>"; return; }
  var p = state.lastResult.placements[b.id];
  var head = document.createElement("div");
  head.textContent = b.name + " · 状态：" + STATE_LABEL[p.state] +
    " · 第 " + (p.line + 1) + " 行 · 位置 (" + Math.round(p.x) + ", " + Math.round(p.y) +
    ") · " + Math.round(p.width) + "×" + Math.round(p.height);
  box.appendChild(head);
  var ul = document.createElement("ul");
  var basis = [
    "固有尺寸 " + b.width + "×" + b.height + "，边界 [" + b.minW + ", " +
      (isFinite(b.maxW) ? b.maxW : "∞") + "]",
    "伸缩倾向 grow=" + b.grow + " / shrink=" + b.shrink,
    "容器内容宽 " + Math.round(state.lastResult.contentWidth) +
      "（内边距 " + state.container.padL + "/" + state.container.padR +
      "，间距 " + state.container.gapX + "/" + state.container.gapY + "）",
    "基线偏移 " + b.baseline + "，参与行基线对齐"
  ];
  if (b.pinned) basis.unshift("手动固定宽度 " + b.pinnedWidth + "（硬约束）");
  p.reasons.forEach(function (r) { basis.push("推导：" + r); });
  basis.forEach(function (t) {
    var li = document.createElement("li"); li.textContent = t; ul.appendChild(li);
  });
  box.appendChild(ul);
}

/* ---------- 容器控件与文件读写 ---------- */
var C_INPUTS = ["cWidth", "cPadL", "cPadR", "cPadT", "cPadB", "cGapX", "cGapY"];
var C_KEYS = ["width", "padL", "padR", "padT", "padB", "gapX", "gapY"];

function syncContainerInputs() {
  C_INPUTS.forEach(function (id, i) {
    var el = $(id);
    if (document.activeElement !== el) el.value = state.container[C_KEYS[i]];
  });
  if (document.activeElement !== $("cWidthNum")) $("cWidthNum").value = state.container.width;
}

function wireContainerInputs() {
  C_INPUTS.forEach(function (id, i) {
    $(id).oninput = function () {
      state.container[C_KEYS[i]] = Math.max(0, Number(this.value) || 0);
      recompute(null); // 容器变化影响整条链 → 全量重推
    };
  });
  $("cWidthNum").oninput = function () {
    state.container.width = Math.max(0, Number(this.value) || 0);
    recompute(null);
  };
}

function wireToolbar() {
  $("btnSample").onclick = function () { loadData(JSON.parse(JSON.stringify(SAMPLE))); };
  $("btnAdd").onclick = function () {
    var id = "blk-" + Date.now().toString(36);
    state.blocks.push(LayoutEngine.normalizeBlock({
      id: id, name: "新块 " + (state.blocks.length + 1), width: 120, height: 40,
      grow: 0, shrink: 1, minW: 60, canBreakBefore: true
    }));
    state.selectedId = id;
    state.lastResult = null;
    recompute(null);
  };
  $("btnSave").onclick = function () {
    var data = JSON.stringify({ container: state.container, blocks: state.blocks }, null, 2);
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    a.download = "layout-blocks.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $("btnLoad").onclick = function () { $("fileInput").click(); };
  $("fileInput").onchange = function () {
    var f = this.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try { loadData(JSON.parse(rd.result)); }
      catch (e) { alert("JSON 解析失败：" + e.message); }
    };
    rd.readAsText(f);
    this.value = "";
  };
}

wireContainerInputs();
wireToolbar();
loadData(JSON.parse(JSON.stringify(SAMPLE)));
