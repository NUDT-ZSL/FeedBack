/* 字幕对齐推演工具前端：时间轴、片段列表、裁决与锚点编辑。 */
let DATA = null;        // {state, result}
let SELECTED = null;    // 选中的片段 id
let AFFECTED = [];      // 最近一次增量重推影响的片段 id
let dragAnchor = null;  // 正在拖动的锚点

const COLORS = {ok: "#3fa34d", warning: "#e6a23c",
                conflict: "#d64545", untrusted: "#8a8a8a"};
const CONF_LABEL = {high: "高", medium: "中", low: "低", untrusted: "不可信"};
const STATUS_LABEL = {ok: "正常", warning: "警告",
                      conflict: "矛盾", untrusted: "不可信"};

function fmt(t) {
  if (t === null || t === undefined) return "--";
  const m = Math.floor(Math.abs(t) / 60), s = Math.abs(t) % 60;
  return (t < 0 ? "-" : "") + m + ":" + s.toFixed(2).padStart(5, "0");
}
function esc(s) {
  return String(s).replace(/[&<>"]/g,
    c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
}

async function api(path, body) {
  const r = await fetch(path, {method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body || {})});
  const j = await r.json();
  if (!r.ok) { alert(j.error || "请求失败"); return null; }
  return j;
}

async function refresh() {
  const r = await fetch("/api/state");
  DATA = await r.json();
  AFFECTED = [];
  renderAll();
}

function applyResp(j) {
  if (!j) return;
  DATA = {state: j.state, result: j.result};
  AFFECTED = j.affected || [];
  renderAll();
}

function renderAll() {
  const m = DATA.result.media;
  document.getElementById("mediaInfo").textContent =
    (m.name || "媒体") + "  时长 " + fmt(m.duration) +
    "  帧率 " + m.fps + "fps";
  renderTimeline();
  renderDrift();
  renderList();
  renderDetail();
  renderAnchors();
  renderWarnings();
}

function segById(id) {
  return DATA.result.segments.find(s => s.id === id);
}

/* ---------- 时间轴 ---------- */
const PAD = 40;
function xOf(t, W, dur) { return PAD + (t / dur) * (W - 2 * PAD); }
function tOf(x, W, dur) { return (x - PAD) / (W - 2 * PAD) * dur; }

function renderTimeline() {
  const cv = document.getElementById("timeline");
  cv.width = cv.clientWidth;
  const ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
  const dur = DATA.result.media.duration || 1;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = "#444"; ctx.fillStyle = "#888";
  ctx.font = "11px Consolas";
  const step = dur > 600 ? 120 : 60;
  for (let t = 0; t <= dur + 0.01; t += step) {
    const x = xOf(t, W, dur);
    ctx.beginPath(); ctx.moveTo(x, 14); ctx.lineTo(x, H - 4); ctx.stroke();
    ctx.fillText(fmt(t), x - 14, 12);
  }
  // 对齐后片段（上排）
  DATA.result.segments.forEach(s => {
    if (s.aligned_start === null) return;
    const x1 = xOf(Math.max(0, s.aligned_start), W, dur);
    const x2 = xOf(Math.min(dur, s.aligned_end), W, dur);
    ctx.fillStyle = COLORS[s.status];
    ctx.globalAlpha = s.id === SELECTED ? 1 : 0.75;
    ctx.fillRect(x1, 30, Math.max(2, x2 - x1), 26);
    ctx.globalAlpha = 1;
    if (AFFECTED.includes(s.id)) {
      ctx.strokeStyle = "#fff"; ctx.strokeRect(x1 - 1, 29, Math.max(2, x2 - x1) + 2, 28);
    }
  });
  // 原始标注位置（下排，灰色描边）
  DATA.result.segments.forEach(s => {
    const x1 = xOf(Math.max(0, s.raw_start), W, dur);
    const x2 = xOf(Math.min(dur, s.raw_end), W, dur);
    ctx.strokeStyle = "#777";
    ctx.strokeRect(x1, 70, Math.max(2, x2 - x1), 18);
  });
  // 锚点
  DATA.result.anchors.forEach(a => {
    const x = xOf(a.media_time, W, dur);
    ctx.fillStyle = "#5ac8fa";
    ctx.beginPath();
    ctx.moveTo(x, 100); ctx.lineTo(x - 7, 116); ctx.lineTo(x + 7, 116);
    ctx.closePath(); ctx.fill();
    ctx.fillText(a.id + " " + fmt(a.media_time), x - 24, 130);
  });
}

function timelineHit(ev) {
  const cv = document.getElementById("timeline");
  const r = cv.getBoundingClientRect();
  const x = ev.clientX - r.left, y = ev.clientY - r.top;
  const dur = DATA.result.media.duration || 1;
  for (const a of DATA.result.anchors) {
    if (Math.abs(x - xOf(a.media_time, cv.width, dur)) < 9 && y > 96 && y < 120)
      return {kind: "anchor", anchor: a};
  }
  if (y >= 30 && y <= 56) {
    const t = tOf(x, cv.width, dur);
    const s = DATA.result.segments.find(s =>
      s.aligned_start !== null && t >= s.aligned_start && t <= s.aligned_end);
    if (s) return {kind: "segment", segment: s};
  }
  return null;
}

/* ---------- 漂移趋势图 ---------- */
function renderDrift() {
  const cv = document.getElementById("drift");
  cv.width = cv.clientWidth;
  const ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const pts = DATA.result.trend.filter(p => p.drift !== null);
  if (!pts.length) {
    ctx.fillStyle = "#888"; ctx.fillText("无可用偏移（缺少锚点）", 10, 20);
    return;
  }
  const maxAbs = Math.max(0.5, ...pts.map(p => Math.abs(p.drift)));
  const yOf = d => H / 2 - (d / maxAbs) * (H / 2 - 10);
  ctx.strokeStyle = "#444";
  ctx.beginPath(); ctx.moveTo(0, yOf(0)); ctx.lineTo(W, yOf(0)); ctx.stroke();
  ctx.strokeStyle = "#5ac8fa"; ctx.lineWidth = 2; ctx.beginPath();
  pts.forEach((p, i) => {
    const x = xOf(DATA.result.segments.find(s => s.id === p.id).aligned_start
                  || 0, W, DATA.result.media.duration || 1);
    const y = yOf(p.drift);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke(); ctx.lineWidth = 1;
  pts.forEach(p => {
    const seg = DATA.result.segments.find(s => s.id === p.id);
    const x = xOf(seg.aligned_start || 0, W, DATA.result.media.duration || 1);
    ctx.fillStyle = COLORS[seg.status];
    ctx.beginPath(); ctx.arc(x, yOf(p.drift), 3.5, 0, 7); ctx.fill();
  });
  ctx.fillStyle = "#888"; ctx.font = "11px Consolas";
  ctx.fillText("+" + maxAbs.toFixed(2) + "s", 4, 12);
  ctx.fillText("-" + maxAbs.toFixed(2) + "s", 4, H - 4);
}

/* ---------- 片段列表 ---------- */
function renderList() {
  const el = document.getElementById("segList");
  let html = "";
  for (const s of DATA.result.segments) {
    const cls = ["segrow",
      s.id === SELECTED ? "sel" : "",
      AFFECTED.includes(s.id) ? "affected" : ""].join(" ");
    html += '<div class="' + cls + '" data-id="' + esc(s.id) + '">' +
      '<span class="dot" style="background:' + COLORS[s.status] + '"></span>' +
      '<b>' + esc(s.id) + '</b>' +
      '<span class="tag">' + esc(s.source) + '</span>' +
      '<span class="mono">原始 ' + fmt(s.raw_start) + "~" + fmt(s.raw_end) + '</span>' +
      '<span class="mono">对齐 ' + fmt(s.aligned_start) + "~" + fmt(s.aligned_end) + '</span>' +
      '<span class="mono">偏移 ' + (s.offset === null ? "--" : s.offset.toFixed(2) + "s") + '</span>' +
      '<span>' + STATUS_LABEL[s.status] + "/" + CONF_LABEL[s.confidence] + '</span>' +
      '<span>' + esc(s.text) + '</span></div>';
  }
  el.innerHTML = html;
  el.querySelectorAll(".segrow").forEach(row =>
    row.addEventListener("click", () => {
      SELECTED = row.dataset.id; renderAll();
    }));
}

/* ---------- 详情与裁决 ---------- */
function renderDetail() {
  const el = document.getElementById("detailBody");
  const s = SELECTED && segById(SELECTED);
  if (!s) { el.innerHTML = "点击左侧片段查看对齐依据与矛盾双方。"; return; }
  let html = "<b>" + esc(s.id) + "</b> <span class='tag'>" + esc(s.source) +
    "</span> " + esc(s.text) + "<br>状态：" + STATUS_LABEL[s.status] +
    "　置信度：" + CONF_LABEL[s.confidence] +
    (s.resolved ? "　<span class='tag'>已裁决</span>" : "") +
    "<br><span class='mono'>原始 [" + fmt(s.raw_start) + ", " + fmt(s.raw_end) +
    "]　对齐 [" + fmt(s.aligned_start) + ", " + fmt(s.aligned_end) + "]</span>";
  html += "<h2>对齐依据</h2>";
  for (const e of s.evidence)
    html += "<div class='ev'>[" + esc(e.type) + "] " + esc(e.detail) + "</div>";
  if (!s.evidence.length) html += "<div class='iss'>无可用依据</div>";
  html += "<h2>矛盾（双方依据均保留）</h2>";
  for (const c of s.conflicts) {
    html += "<div class='cf'><b>" + esc(c.detail) + "</b>";
    for (const p of (c.parties || []))
      html += "<div class='party'>▸ [" + esc(p.type) + "] " +
              esc(p.detail) + "</div>";
    html += "</div>";
  }
  if (!s.conflicts.length) html += "<div class='ev'>无矛盾</div>";
  for (const i of s.issues) html += "<div class='iss'>⚠ " + esc(i) + "</div>";
  html += "<h2>裁决</h2><div class='anchor-row'>" +
    "<button data-act='anchor'>采用锚点</button>" +
    "<button data-act='interp'>采用插值</button>" +
    "<input type='text' id='customOff' placeholder='偏移秒数'>" +
    "<button data-act='custom'>指定偏移</button>" +
    "<button data-act='clear'>清除裁决</button></div>";
  html += "<h2>修正片段时间</h2><div class='anchor-row'>" +
    "<input type='text' id='segStart' value='" + s.raw_start + "'>" +
    "<input type='text' id='segEnd' value='" + s.raw_end + "'>" +
    "<button id='btnSegSave'>应用</button></div>";
  el.innerHTML = html;
  el.querySelectorAll("button[data-act]").forEach(b =>
    b.addEventListener("click", async () => {
      const act = b.dataset.act;
      const body = {segment_id: s.id, choice: act};
      if (act === "custom") {
        const v = parseFloat(document.getElementById("customOff").value);
        if (isNaN(v)) { alert("请输入数值偏移"); return; }
        body.offset = v;
      }
      applyResp(await api("/api/adjudicate", body));
    }));
  document.getElementById("btnSegSave").addEventListener("click", async () => {
    applyResp(await api("/api/segment/update", {
      id: s.id,
      start: parseFloat(document.getElementById("segStart").value),
      end: parseFloat(document.getElementById("segEnd").value)}));
  });
}

/* ---------- 锚点编辑 / 警告 ---------- */
function renderAnchors() {
  const el = document.getElementById("anchorList");
  let html = "";
  for (const a of DATA.result.anchors) {
    html += "<div class='anchor-row'><b>" + esc(a.id) + "</b>" +
      "<span class='tag'>" + esc(a.segment_id) + "</span>" +
      "<input type='text' value='" + a.media_time + "' data-aid='" +
      esc(a.id) + "'>" +
      "<button data-save='" + esc(a.id) + "'>保存</button>" +
      "<button data-del='" + esc(a.id) + "'>删除</button>" +
      "<span class='mono'>偏移 " + a.offset.toFixed(3) + "s</span>" +
      "<span>" + esc(a.note || "") + "</span></div>";
  }
  html += "<div class='anchor-row'><select id='newAnchorSeg'>" +
    DATA.result.segments.map(s =>
      "<option value='" + esc(s.id) + "'>" + esc(s.id) + "</option>").join("") +
    "</select><input type='text' id='newAnchorTime' placeholder='媒体时刻'>" +
    "<button id='btnAddAnchor'>新增锚点</button></div>";
  el.innerHTML = html;
  el.querySelectorAll("button[data-save]").forEach(b =>
    b.addEventListener("click", async () => {
      const id = b.dataset.save;
      const v = parseFloat(
        el.querySelector("input[data-aid='" + id + "']").value);
      if (isNaN(v)) { alert("请输入数值时刻"); return; }
      applyResp(await api("/api/anchor/update", {id: id, media_time: v}));
    }));
  el.querySelectorAll("button[data-del]").forEach(b =>
    b.addEventListener("click", async () => {
      applyResp(await api("/api/anchor/delete", {id: b.dataset.del}));
    }));
  document.getElementById("btnAddAnchor").addEventListener("click", async () => {
    const v = parseFloat(document.getElementById("newAnchorTime").value);
    if (isNaN(v)) { alert("请输入数值时刻"); return; }
    applyResp(await api("/api/anchor/add", {
      segment_id: document.getElementById("newAnchorSeg").value,
      media_time: v}));
  });
}

function renderWarnings() {
  const el = document.getElementById("warnList");
  const w = DATA.result.warnings;
  el.innerHTML = w.length
    ? w.map(x => "<div class='iss'>⚠ 锚点 " + esc(x.anchor_id) + "：" +
        esc(x.reason) + "</div>").join("")
    : "<div class='ev'>无</div>";
}

/* ---------- 事件 ---------- */
document.getElementById("timeline").addEventListener("mousedown", ev => {
  const hit = timelineHit(ev);
  if (!hit) return;
  if (hit.kind === "anchor") dragAnchor = hit.anchor;
  else { SELECTED = hit.segment.id; renderAll(); }
});
document.getElementById("timeline").addEventListener("mousemove", ev => {
  if (!dragAnchor) return;
  const cv = ev.target, r = cv.getBoundingClientRect();
  const t = Math.max(0, Math.min(DATA.result.media.duration,
    tOf(ev.clientX - r.left, cv.width, DATA.result.media.duration)));
  dragAnchor.media_time = Math.round(t * 100) / 100;
  renderTimeline();
});
document.getElementById("timeline").addEventListener("mouseup", async () => {
  if (!dragAnchor) return;
  const a = dragAnchor; dragAnchor = null;
  applyResp(await api("/api/anchor/update",
    {id: a.id, media_time: a.media_time}));
});
document.getElementById("btnReset").addEventListener("click", async () => {
  applyResp(await api("/api/reset", {}));
});
document.getElementById("fileInput").addEventListener("change", ev => {
  const f = ev.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = async () => {
    try { applyResp(await api("/api/load", JSON.parse(rd.result))); }
    catch (e) { alert("JSON 解析失败: " + e); }
  };
  rd.readAsText(f, "utf-8");
});
window.addEventListener("resize", () => { if (DATA) renderAll(); });

refresh();
