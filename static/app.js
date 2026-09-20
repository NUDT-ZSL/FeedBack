/* 数据血缘推演台前端(原生 JS + SVG, 无任何外部依赖) */
let S = null;          // 服务端状态快照
let selected = null;   // 当前选中数据集 id

const STATE_COLOR = {ok:"#16a34a", stale:"#d97706", invalid:"#dc2626",
                     conflict:"#7c3aed", disabled:"#94a3b8"};

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g,
    c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

async function api(path, method, body) {
  const opt = {method: method || "GET", headers: {"Content-Type": "application/json"}};
  if (body !== undefined) opt.body = JSON.stringify(body);
  const r = await fetch(path, opt);
  const j = await r.json();
  if (!r.ok) { alert(j.error || r.statusText); throw new Error(j.error); }
  return j;
}

async function refresh() {
  S = await api("/api/state");
  if (selected && !S.datasets[selected]) selected = null;
  render();
}

function badge(st) {
  return '<span class="badge st-' + st + '">' + esc(S.state_labels[st] || st) + "</span>";
}

function render() {
  renderLegend(); renderList(); renderGraph(); renderDetail();
  renderDiagnostics(); renderEvents();
}

function renderLegend() {
  document.getElementById("legend").innerHTML =
    Object.keys(S.state_labels).map(k =>
      '<span style="--c:' + STATE_COLOR[k] + '">' + esc(S.state_labels[k]) + "</span>").join("");
}

function renderList() {
  const ul = document.getElementById("dataset-list");
  ul.innerHTML = Object.values(S.datasets).map(d => {
    const st = S.states[d.id] ? S.states[d.id].state : "ok";
    return '<li data-id="' + esc(d.id) + '" class="' + (d.id === selected ? "sel" : "") + '">' +
      '<span class="name" title="' + esc(d.id) + '">' + esc(d.name) + "</span>" + badge(st) + "</li>";
  }).join("");
  ul.querySelectorAll("li").forEach(li =>
    li.onclick = () => { selected = li.dataset.id; render(); });
}

/* ---- 血缘图: 按拓扑深度分列布局 ---- */
function computeLayout() {
  const depth = {};
  Object.keys(S.datasets).forEach(id => depth[id] = 0);
  const ders = Object.values(S.derivations).filter(d => d.status === "active");
  for (let it = 0; it < 30; it++) {
    for (const d of ders) for (const inp of (d.inputs || [])) {
      if (depth[inp.dataset] != null && depth[d.target] != null)
        depth[d.target] = Math.max(depth[d.target], depth[inp.dataset] + 1);
    }
  }
  const W = 168, H = 50, GX = 90, GY = 26, cols = {};
  const pos = {};
  Object.keys(S.datasets).sort().forEach(id => {
    const c = depth[id];
    cols[c] = (cols[c] || 0);
    pos[id] = {x: 24 + c * (W + GX), y: 24 + cols[c] * (H + GY)};
    cols[c]++;
  });
  return {pos, W, H};
}

function renderGraph() {
  const {pos, W, H} = computeLayout();
  let maxX = 0, maxY = 0;
  Object.values(pos).forEach(p => { maxX = Math.max(maxX, p.x + W); maxY = Math.max(maxY, p.y + H); });
  let edges = "";
  for (const d of Object.values(S.derivations)) {
    if (d.status !== "active") continue;
    const tp = pos[d.target];
    if (!tp) continue;
    const multi = Object.values(S.derivations)
      .filter(x => x.target === d.target && x.status === "active").length > 1;
    for (const inp of (d.inputs || [])) {
      const sp = pos[inp.dataset];
      if (!sp) continue;
      const x1 = sp.x + W, y1 = sp.y + H / 2, x2 = tp.x, y2 = tp.y + H / 2;
      const mx = (x1 + x2) / 2;
      edges += '<path class="edge' + (multi ? " conflict" : "") +
        '" d="M' + x1 + "," + y1 + " C" + mx + "," + y1 + " " + mx + "," + y2 + " " + x2 + "," + y2 + '"/>';
    }
  }
  let nodes = "";
  for (const [id, p] of Object.entries(pos)) {
    const d = S.datasets[id];
    const st = S.states[id] ? S.states[id].state : "ok";
    const c = STATE_COLOR[st];
    nodes += '<g class="node' + (id === selected ? " sel" : "") + '" data-id="' + esc(id) + '">' +
      '<rect x="' + p.x + '" y="' + p.y + '" width="' + W + '" height="' + H +
      '" rx="7" fill="#fff" stroke="' + c + '"/>' +
      '<rect x="' + p.x + '" y="' + p.y + '" width="6" height="' + H + '" rx="3" fill="' + c + '"/>' +
      '<text x="' + (p.x + 14) + '" y="' + (p.y + 20) + '">' + esc(d.name) + "</text>" +
      '<text x="' + (p.x + 14) + '" y="' + (p.y + 38) + '" fill="' + c + '" font-size="10">' +
      esc(S.state_labels[st]) + " · v" + d.version + "</text></g>";
  }
  const svg = document.getElementById("graph");
  svg.setAttribute("width", maxX + 40);
  svg.setAttribute("height", maxY + 40);
  svg.innerHTML = edges + nodes;
  svg.querySelectorAll(".node").forEach(n =>
    n.onclick = () => { selected = n.dataset.id; render(); });
}

/* ---- 详情 / 变更操作面板 ---- */
function renderDetail() {
  const el = document.getElementById("detail");
  const d = S.datasets[selected];
  if (!d) { el.innerHTML = '<p class="hint">在左侧或图中选择一个数据集</p>'; return; }
  const st = S.states[d.id] || {state: "ok", reasons: []};
  const reasons = st.reasons.length
    ? '<ul class="reasons">' + st.reasons.map(r => "<li>" + esc(r) + "</li>").join("") + "</ul>" : "";
  const ders = Object.values(S.derivations).filter(x => x.target === d.id);
  let html = "<h3>" + esc(d.name) + ' <span class="hint">' + esc(d.id) + "</span></h3>" +
    "<div>状态: " + badge(st.state) + " · 类型: " + esc(d.kind) + " · v" + d.version + "</div>" +
    reasons +
    '<div class="row"><label>名称</label><input type="text" id="ed-name" value="' + esc(d.name) + '"></div>' +
    '<div class="row"><label>字段定义 (JSON, 保存后版本+1并触发下游影响分析)</label>' +
    '<textarea id="ed-fields">' + esc(JSON.stringify(d.fields, null, 1)) + "</textarea></div>" +
    '<div class="btns">' +
    '<button id="btn-save-ds">保存定义</button>' +
    '<button id="btn-toggle" class="ghost">' + (d.status === "disabled" ? "启用" : "停用") + "</button>" +
    '<button id="btn-recomputed" class="ghost">标记已重算</button>' +
    '<button id="btn-add-der" class="ghost">+ 派生依据</button>' +
    "</div>";
  html += '<h3>派生依据 (' + ders.length + ")</h3>";
  for (const der of ders) {
    html += '<div class="der-card ' + der.status + '" data-id="' + esc(der.id) + '">' +
      "<h4>" + esc(der.id) + " · " + esc(der.status) + " · v" + der.version + "</h4>" +
      '<div class="row"><label>说明</label><input type="text" class="der-note" value="' + esc(der.note) + '"></div>' +
      '<div class="row"><label>加工步骤 (JSON)</label><textarea class="der-steps">' +
      esc(JSON.stringify(der.steps, null, 1)) + "</textarea></div>" +
      '<div class="row"><label>上游与字段映射 (JSON)</label><textarea class="der-inputs">' +
      esc(JSON.stringify(der.inputs, null, 1)) + "</textarea></div>" +
      '<div class="btns">' +
      '<button class="der-save">保存</button>' +
      '<button class="der-adopt" title="裁决: 采用此条, 其余弃用">采用此条</button>' +
      '<button class="der-del danger">删除</button>' +
      "</div></div>";
  }
  el.innerHTML = html;
  document.getElementById("btn-save-ds").onclick = saveDataset;
  document.getElementById("btn-toggle").onclick = toggleDataset;
  document.getElementById("btn-recomputed").onclick = markRecomputed;
  document.getElementById("btn-add-der").onclick = addDerivation;
  el.querySelectorAll(".der-card").forEach(card => {
    const id = card.dataset.id;
    card.querySelector(".der-save").onclick = () => saveDerivation(card, id);
    card.querySelector(".der-adopt").onclick = () =>
      api("/api/derivations/" + id + "/adopt", "POST", {}).then(refresh);
    card.querySelector(".der-del").onclick = () => {
      if (confirm("删除派生依据 " + id + "?"))
        api("/api/derivations/" + id, "DELETE").then(refresh);
    };
  });
}

function parseJson(id, what) {
  try { return JSON.parse(document.getElementById(id).value); }
  catch (e) { alert(what + " JSON 解析失败: " + e.message); throw e; }
}

function saveDataset() {
  const name = document.getElementById("ed-name").value;
  const fields = parseJson("ed-fields", "字段定义");
  api("/api/datasets/" + selected, "PUT", {name, fields}).then(refresh);
}

function toggleDataset() {
  const cur = S.datasets[selected].status;
  api("/api/datasets/" + selected + "/status", "POST",
      {status: cur === "disabled" ? "active" : "disabled"}).then(refresh);
}

function markRecomputed() {
  api("/api/datasets/" + selected + "/recomputed", "POST", {}).then(refresh);
}

function addDerivation() {
  api("/api/derivations", "POST", {
    target: selected, note: "新派生依据",
    steps: [{name: "step1", operation: "", description: ""}],
    inputs: []}).then(refresh);
}

function saveDerivation(card, id) {
  let steps, inputs;
  try {
    steps = JSON.parse(card.querySelector(".der-steps").value);
    inputs = JSON.parse(card.querySelector(".der-inputs").value);
  } catch (e) { alert("派生依据 JSON 解析失败: " + e.message); return; }
  const note = card.querySelector(".der-note").value;
  api("/api/derivations/" + id, "PUT", {note, steps, inputs}).then(refresh);
}

/* ---- 诊断与操作日志 ---- */
function renderDiagnostics() {
  const ul = document.getElementById("diagnostics");
  if (!S.diagnostics.length) { ul.innerHTML = '<li class="hint">当前没有异常, 血缘链路健康</li>'; return; }
  ul.innerHTML = S.diagnostics.map(d =>
    '<li class="' + esc(d.severity) + '" data-id="' + esc(d.dataset || "") + '">' +
    "[" + esc(d.code) + "] " + esc(d.message) +
    (d.derivation ? ' <span class="hint">(' + esc(d.derivation) + ")</span>" : "") + "</li>").join("");
  ul.querySelectorAll("li[data-id]").forEach(li => li.onclick = () => {
    if (li.dataset.id && S.datasets[li.dataset.id]) { selected = li.dataset.id; render(); }
  });
}

function renderEvents() {
  const ul = document.getElementById("events");
  const evs = S.events.slice().reverse();
  if (!evs.length) { ul.innerHTML = '<li class="hint">暂无操作</li>'; return; }
  ul.innerHTML = evs.map(e => {
    const chgs = (e.changes || []).map(c =>
      '<span class="chg">' + esc(c.dataset) + ": " +
      esc(S.state_labels[c.from] || c.from || "无") + " → " +
      esc(S.state_labels[c.to] || c.to || "无") + "</span>").join("");
    return "<li><b>" + esc(e.time) + "</b> " + esc(e.action) +
      (e.consistent === false ? ' <span class="bad">[增量与全量不一致, 已回退全量]</span>' : "") +
      "<br>影响 " + (e.affected || []).length + " 个节点; 状态变化: " + (chgs || "无") + "</li>";
  }).join("");
}

document.getElementById("btn-reset").onclick = () => {
  if (confirm("重置为内置演示数据? 当前修改将丢失"))
    api("/api/reset", "POST", {}).then(refresh);
};
document.getElementById("btn-new-dataset").onclick = () => {
  const name = prompt("新数据集名称", "新数据集");
  if (name) api("/api/datasets", "POST",
    {name, kind: "source", fields: [{name: "id", type: "string"}]})
    .then(j => { selected = Object.keys(j.datasets).pop(); refresh(); });
};
refresh();
