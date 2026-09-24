"use strict";
/* 位置对象范围推演台前端 */
let STATE = null;
let selectedQueryId = null;
let selectedObjectId = null;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function api(path, body) {
  const opt = body === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
  const resp = await fetch(path, opt);
  const data = await resp.json();
  if (!resp.ok) { alert("操作失败：" + (data.error || resp.status)); return null; }
  return data;
}

function applyPayload(data) {
  if (!data) return;
  STATE = data.state;
  renderConsistency(data.consistency);
  if (data.affected !== undefined) {
    $("affected").textContent = data.affected.length
      ? "本次仅重推：" + data.affected.join("、") : "本次无查找受影响";
  }
  renderAll();
}

function renderConsistency(c) {
  const el = $("consistency");
  el.textContent = c.consistent ? "一致性：增量 = 整体重推 ✓"
    : "一致性：存在偏差 " + c.mismatched.join(",");
  el.className = "badge" + (c.consistent ? "" : " bad");
}

function renderAll() {
  renderQueryList();
  renderResults();
  renderObjectList();
  renderObjectDetail();
  renderLog();
  drawMap();
}

/* ---------------- 查找列表与编辑器 ---------------- */
function queryDesc(q) {
  const s = q.shape;
  const shape = s.type === "circle"
    ? `圆(${s.cx}, ${s.cy}) r=${s.radius}`
    : `矩形[${s.minx},${s.miny}]~[${s.maxx},${s.maxy}]`;
  const f = q.filters || {};
  const bits = [];
  if (f.categories && f.categories.length) bits.push("类别:" + f.categories.join("/"));
  if (f.active_at) bits.push("时点:" + f.active_at);
  return shape + (bits.length ? " ｜ " + bits.join(" ｜ ") : "");
}

function renderQueryList() {
  const ul = $("query-list");
  ul.innerHTML = "";
  for (const q of STATE.queries) {
    const li = document.createElement("li");
    if (q.query_id === selectedQueryId) li.className = "selected";
    const r = STATE.results[q.query_id];
    li.innerHTML = `<b>${esc(q.name)}</b><span class="tag">${esc(q.query_id)}</span>` +
      `<span class="muted">${esc(queryDesc(q))}</span>` +
      (r ? `<span class="tag ok">命中 ${r.hits.length}</span>` +
           (r.undecidable.length ? `<span class="tag warn">待裁决 ${r.undecidable.length}</span>` : "") +
           (r.ambiguities.length ? `<span class="tag warn">歧义 ${r.ambiguities.length}</span>` : "") : "");
    li.onclick = () => { selectedQueryId = q.query_id; fillQueryEditor(q); renderAll(); };
    ul.appendChild(li);
  }
}

function fillQueryEditor(q) {
  $("query-editor").classList.remove("hidden");
  $("qe-title").textContent = "编辑查找 " + q.query_id;
  $("qe-id").value = q.query_id;
  $("qe-name").value = q.name || "";
  $("qe-type").value = q.shape.type;
  toggleShapeInputs();
  $("qe-cx").value = q.shape.cx ?? ""; $("qe-cy").value = q.shape.cy ?? "";
  $("qe-radius").value = q.shape.radius ?? "";
  $("qe-minx").value = q.shape.minx ?? ""; $("qe-miny").value = q.shape.miny ?? "";
  $("qe-maxx").value = q.shape.maxx ?? ""; $("qe-maxy").value = q.shape.maxy ?? "";
  const f = q.filters || {};
  $("qe-cats").value = (f.categories || []).join(",");
  $("qe-active").value = f.active_at || "";
  $("qe-basis").value = q.expected_basis || "";
}

function toggleShapeInputs() {
  const t = $("qe-type").value;
  $("qe-circle").classList.toggle("hidden", t !== "circle");
  $("qe-rect").classList.toggle("hidden", t !== "rect");
}

function collectQueryForm() {
  const t = $("qe-type").value;
  const num = (id) => parseFloat($(id).value);
  const shape = t === "circle"
    ? { type: "circle", cx: num("qe-cx"), cy: num("qe-cy"), radius: num("qe-radius") }
    : { type: "rect", minx: num("qe-minx"), miny: num("qe-miny"),
        maxx: num("qe-maxx"), maxy: num("qe-maxy") };
  return {
    query_id: $("qe-id").value || undefined,
    name: $("qe-name").value,
    shape,
    filters: {
      categories: $("qe-cats").value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      active_at: $("qe-active").value.trim(),
    },
    expected_basis: $("qe-basis").value,
  };
}

/* ---------------- 查找结论 ---------------- */
function entryHtml(e, cls, extra) {
  const flags = (e.flags || []).map((f) => `<span class="tag warn">${esc(f)}</span>`).join(" ");
  const reasons = (e.reasons || []).map((r) => `<li>${esc(r)}</li>`).join("");
  return `<div class="entry ${cls}"><b>${esc(e.object_id)}</b> ${extra || ""} ${flags}` +
         `<ul class="reasons">${reasons}</ul></div>`;
}

function renderResults() {
  const body = $("result-body");
  const notes = $("overlap-notes");
  notes.innerHTML = "";
  if (!selectedQueryId || !STATE.results[selectedQueryId]) {
    body.innerHTML = '<p class="muted">请选择左侧的查找请求。</p>';
    $("result-title").textContent = "查找结论";
    return;
  }
  const q = STATE.queries.find((x) => x.query_id === selectedQueryId);
  const r = STATE.results[selectedQueryId];
  $("result-title").textContent = `查找结论：${q.name}（${q.query_id}）`;
  for (const o of STATE.overlaps) {
    if (o.queries.includes(selectedQueryId)) {
      const div = document.createElement("div");
      div.className = "ambiguity";
      div.textContent = "⚠ " + o.message + (o.shared_hits.length
        ? "，共同命中：" + o.shared_hits.join("、") : "，无共同命中对象");
      notes.appendChild(div);
    }
  }
  let html = "";
  if (q.expected_basis) html += `<p class="muted">期望依据：${esc(q.expected_basis)}</p>`;
  html += `<div class="result-group"><h3>命中（按邻近排序，共 ${r.hits.length} 个）</h3>`;
  html += r.hits.length ? r.hits.map((h, i) =>
    entryHtml(h, "hit", `<span class="tag ok">#${i + 1} 距离 ${h.distance.toFixed(4)}</span>`)
  ).join("") : '<p class="muted">无命中。</p>';
  html += `</div><div class="result-group"><h3>无法判定 / 待裁决（${r.undecidable.length} 个，不参与邻近排序）</h3>`;
  html += r.undecidable.length ? r.undecidable.map((u) => entryHtml(u, "undecidable")).join("")
    : '<p class="muted">无。</p>';
  html += `</div><div class="result-group"><h3>排除（${r.excluded.length} 个）</h3>`;
  html += r.excluded.length ? r.excluded.map((e) => entryHtml(e, "excluded")).join("")
    : '<p class="muted">无。</p>';
  html += "</div>";
  if (r.ambiguities.length) {
    html += `<div class="result-group"><h3>歧义提示</h3>` +
      r.ambiguities.map((a) => `<div class="ambiguity">⚠ ${esc(a.message)}</div>`).join("") + "</div>";
  }
  html += `<p class="muted">评估时间：${esc(r.evaluated_at)}</p>`;
  body.innerHTML = html;
}

/* ---------------- 对象列表与裁决 ---------------- */
function objectTags(o) {
  const tags = [];
  if (o.analysis.trusted_coords) tags.push('<span class="tag ok">坐标可信</span>');
  for (const issue of o.analysis.issues) {
    const cls = issue.kind === "conflict" ? "bad" : "warn";
    tags.push(`<span class="tag ${cls}">${esc(issue.message.slice(0, 14))}…</span>`);
  }
  return tags.join(" ");
}

function renderObjectList() {
  const ul = $("object-list");
  ul.innerHTML = "";
  for (const o of STATE.objects) {
    const li = document.createElement("li");
    if (o.object_id === selectedObjectId) li.className = "selected";
    li.innerHTML = `<b>${esc(o.object_id)}</b> ${objectTags(o)}`;
    li.onclick = () => { selectedObjectId = o.object_id; renderAll(); };
    ul.appendChild(li);
  }
}

function renderObjectDetail() {
  const box = $("object-detail");
  const o = STATE.objects.find((x) => x.object_id === selectedObjectId);
  if (!o) { box.innerHTML = ""; return; }
  let html = `<h3>${esc(o.object_id)} 详情</h3>`;
  html += '<table class="claims"><tr><th>来源</th><th>时间</th><th>纬度</th><th>经度</th>' +
          "<th>类别</th><th>有效期</th><th>说明</th><th></th></tr>";
  for (const c of o.claims) {
    html += `<tr class="${c.retracted ? "retracted" : ""}"><td>${esc(c.source)}</td>` +
      `<td>${esc(c.timestamp)}</td><td>${c.lat ?? "—"}</td><td>${c.lon ?? "—"}</td>` +
      `<td>${esc(c.category ?? "—")}</td>` +
      `<td>${esc(c.valid_from ?? "")} ~ ${esc(c.valid_to ?? "")}</td><td>${esc(c.note)}</td>` +
      (c.retracted ? "<td>已撤回</td>"
        : `<td><button class="small danger" onclick="retractClaim('${c.claim_id}')">撤回</button></td>`) +
      "</tr>";
  }
  html += "</table>";
  html += '<h4>字段解析状态</h4><table class="claims"><tr><th>字段</th><th>状态</th><th>取值</th><th>依据</th></tr>';
  for (const [field, info] of Object.entries(o.analysis.fields)) {
    const basis = info.basis && info.basis.rationale
      ? `${info.basis.by}：${info.basis.rationale}` : "";
    html += `<tr><td>${field}</td><td>${esc(info.status)}</td>` +
            `<td>${esc(info.value ?? "—")}</td><td>${esc(basis)}</td></tr>`;
  }
  html += "</table>";
  for (const issue of o.analysis.issues) html += `<div class="ambiguity">⚠ ${esc(issue.message)}</div>`;
  html += renderAdjudication(o);
  html += renderClaimForm(o);
  box.innerHTML = html;
}

function renderAdjudication(o) {
  const targets = Object.entries(o.analysis.fields)
    .filter(([, info]) => info.status === "conflict");
  if (!targets.length) return "";
  let html = "<h4>人工裁决（选择采信来源或录入裁决值）</h4>";
  for (const [field, info] of targets) {
    html += `<div class="adj-box"><b>字段 ${esc(field)}</b>`;
    (info.basis.candidates || []).forEach((cand, i) => {
      html += `<label><input type="radio" name="adj-${o.object_id}-${field}" ` +
        `value="claim:${cand.claim_id}"> 采信「${esc(cand.source)}」：${esc(cand.value)}</label>`;
    });
    html += `<label><input type="radio" name="adj-${o.object_id}-${field}" value="custom"> ` +
      `录入裁决值 <input id="adjval-${o.object_id}-${field}" size="10"></label>`;
    html += `<label>裁决理由 <input id="adjwhy-${o.object_id}-${field}" size="30"></label>`;
    html += `<button class="small" onclick="adjudicate('${o.object_id}','${field}')">提交裁决</button></div>`;
  }
  return html;
}

function renderClaimForm(o) {
  return `<h4>补录 / 修正来源</h4><div class="form-grid">` +
    `<input id="nc-source" placeholder="来源名称*">` +
    `<input id="nc-lat" placeholder="纬度" type="number" step="any">` +
    `<input id="nc-lon" placeholder="经度" type="number" step="any">` +
    `<input id="nc-cat" placeholder="类别">` +
    `<input id="nc-vf" placeholder="生效起点 2026-01-01T00:00:00">` +
    `<input id="nc-vt" placeholder="有效终点">` +
    `<input id="nc-note" placeholder="说明">` +
    `</div><button class="small" onclick="addClaim('${o.object_id}')">提交新来源</button>`;
}

async function adjudicate(objectId, field) {
  const sel = document.querySelector(`input[name="adj-${objectId}-${field}"]:checked`);
  if (!sel) { alert("请选择采信来源或录入裁决值"); return; }
  const rationale = $(`adjwhy-${objectId}-${field}`).value || "人工裁决";
  const body = { object_id: objectId, field, rationale };
  if (sel.value.startsWith("claim:")) body.claim_id = sel.value.slice(6);
  else {
    const raw = $(`adjval-${objectId}-${field}`).value;
    if (!raw) { alert("请录入裁决值"); return; }
    const n = parseFloat(raw);
    body.value = isNaN(n) ? raw : n;
  }
  applyPayload(await api("/api/adjudicate", body));
}

async function retractClaim(claimId) {
  if (!confirm("确认撤回该来源？撤回后其数据不再参与推演。")) return;
  applyPayload(await api("/api/claim/retract", { claim_id: claimId }));
}

async function addClaim(objectId) {
  const val = (id) => $(id).value.trim();
  if (!val("nc-source")) { alert("请填写来源名称"); return; }
  applyPayload(await api("/api/claim", {
    object_id: objectId,
    source: val("nc-source"),
    lat: val("nc-lat") || null,
    lon: val("nc-lon") || null,
    category: val("nc-cat") || null,
    valid_from: val("nc-vf") || null,
    valid_to: val("nc-vt") || null,
    note: val("nc-note"),
  }));
}

/* ---------------- 地图 ---------------- */
function mapTransform(canvas) {
  const pts = [];
  for (const q of STATE.queries) {
    const s = q.shape;
    if (s.type === "circle") { pts.push([s.cx - s.radius, s.cy - s.radius], [s.cx + s.radius, s.cy + s.radius]); }
    else pts.push([s.minx, s.miny], [s.maxx, s.maxy]);
  }
  for (const o of STATE.objects) {
    const f = o.analysis.fields;
    if (o.analysis.trusted_coords) pts.push([f.lon.value, f.lat.value]);
  }
  if (!pts.length) pts.push([0, 0], [1, 1]);
  let minx = Math.min(...pts.map((p) => p[0])), maxx = Math.max(...pts.map((p) => p[0]));
  let miny = Math.min(...pts.map((p) => p[1])), maxy = Math.max(...pts.map((p) => p[1]));
  const pad = Math.max((maxx - minx), (maxy - miny)) * 0.08 + 1e-6;
  minx -= pad; maxx += pad; miny -= pad; maxy += pad;
  const W = canvas.width, H = canvas.height;
  const sx = W / (maxx - minx), sy = H / (maxy - miny);
  const s = Math.min(sx, sy);
  return {
    toPx: (x, y) => [(x - minx) * s + (W - (maxx - minx) * s) / 2,
                     H - ((y - miny) * s + (H - (maxy - miny) * s) / 2)],
    toWorld: (px, py) => {
      const x = (px - (W - (maxx - minx) * s) / 2) / s + minx;
      const y = (H - py - (H - (maxy - miny) * s) / 2) / s + miny;
      return [x, y];
    },
    scale: s,
  };
}

function drawMap() {
  const canvas = $("map");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const T = mapTransform(canvas);
  const colors = ["#1f6feb", "#8e24aa", "#00838f", "#f4511e", "#5d4037"];
  STATE.queries.forEach((q, i) => {
    const s = q.shape;
    ctx.strokeStyle = colors[i % colors.length];
    ctx.lineWidth = q.query_id === selectedQueryId ? 3 : 1.5;
    ctx.setLineDash(q.query_id === selectedQueryId ? [] : [5, 4]);
    ctx.beginPath();
    if (s.type === "circle") {
      const [px, py] = T.toPx(s.cx, s.cy);
      ctx.arc(px, py, s.radius * T.scale, 0, Math.PI * 2);
    } else {
      const [x1, y1] = T.toPx(s.minx, s.maxy);
      const [x2, y2] = T.toPx(s.maxx, s.miny);
      ctx.rect(x1, y1, x2 - x1, y2 - y1);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    const rp = s.type === "circle" ? [s.cx, s.cy]
      : [(s.minx + s.maxx) / 2, (s.miny + s.maxy) / 2];
    const [lx, ly] = T.toPx(rp[0], rp[1]);
    ctx.fillStyle = colors[i % colors.length];
    ctx.font = "12px sans-serif";
    ctx.fillText(q.name || q.query_id, lx + 4, ly - 4);
  });
  const selRes = selectedQueryId ? STATE.results[selectedQueryId] : null;
  for (const o of STATE.objects) {
    const f = o.analysis.fields;
    if (!o.analysis.trusted_coords) continue;
    const [px, py] = T.toPx(f.lon.value, f.lat.value);
    let color = "#9e9e9e";
    if (selRes) {
      if (selRes.hits.some((h) => h.object_id === o.object_id)) color = "#2e7d32";
      else if (selRes.undecidable.some((u) => u.object_id === o.object_id)) color = "#ef6c00";
    }
    if (o.analysis.has_conflict) color = "#c62828";
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, o.object_id === selectedObjectId ? 7 : 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#333";
    ctx.font = "11px sans-serif";
    ctx.fillText(o.object_id, px + 7, py + 3);
  }
}

let dragQuery = null;
function canvasPos(evt) {
  const rect = $("map").getBoundingClientRect();
  return [(evt.clientX - rect.left) * ($("map").width / rect.width),
          (evt.clientY - rect.top) * ($("map").height / rect.height)];
}

function initMapEvents() {
  const canvas = $("map");
  canvas.addEventListener("mousedown", (evt) => {
    if (!selectedQueryId) return;
    const q = STATE.queries.find((x) => x.query_id === selectedQueryId);
    if (!q) return;
    const T = mapTransform(canvas);
    const [wx, wy] = T.toWorld(...canvasPos(evt));
    const rp = q.shape.type === "circle" ? [q.shape.cx, q.shape.cy]
      : [(q.shape.minx + q.shape.maxx) / 2, (q.shape.miny + q.shape.maxy) / 2];
    const tol = 12 / T.scale;
    if (Math.hypot(wx - rp[0], wy - rp[1]) <= Math.max(tol, q.shape.radius || 0)) {
      dragQuery = { q, dx: wx - rp[0], dy: wy - rp[1] };
    }
  });
  canvas.addEventListener("mousemove", (evt) => {
    if (!dragQuery) return;
    const T = mapTransform(canvas);
    const [wx, wy] = T.toWorld(...canvasPos(evt));
    const nx = wx - dragQuery.dx, ny = wy - dragQuery.dy;
    const s = dragQuery.q.shape;
    if (s.type === "circle") { s.cx = +nx.toFixed(6); s.cy = +ny.toFixed(6); }
    else {
      const w = s.maxx - s.minx, h = s.maxy - s.miny;
      s.minx = +(nx - w / 2).toFixed(6); s.maxx = +(nx + w / 2).toFixed(6);
      s.miny = +(ny - h / 2).toFixed(6); s.maxy = +(ny + h / 2).toFixed(6);
    }
    drawMap();
  });
  canvas.addEventListener("mouseup", async () => {
    if (!dragQuery) return;
    const q = dragQuery.q;
    dragQuery = null;
    fillQueryEditor(q);
    applyPayload(await api("/api/query", q));
  });
  canvas.addEventListener("click", (evt) => {
    if (dragQuery) return;
    const T = mapTransform(canvas);
    const [wx, wy] = T.toWorld(...canvasPos(evt));
    let best = null, bestD = 12 / T.scale;
    for (const o of STATE.objects) {
      const f = o.analysis.fields;
      if (!o.analysis.trusted_coords) continue;
      const d = Math.hypot(wx - f.lon.value, wy - f.lat.value);
      if (d < bestD) { best = o; bestD = d; }
    }
    if (best) { selectedObjectId = best.object_id; renderAll(); }
  });
}

/* ---------------- 日志与初始化 ---------------- */
function renderLog() {
  $("log").innerHTML = STATE.log.slice().reverse()
    .map((l) => `<li>[${esc(l.time)}] ${esc(l.message)}</li>`).join("");
}

function initEvents() {
  $("qe-type").addEventListener("change", toggleShapeInputs);
  $("btn-new-query").onclick = () => {
    selectedQueryId = null;
    $("query-editor").classList.remove("hidden");
    $("qe-title").textContent = "新建查找";
    $("qe-id").value = "";
    $("qe-name").value = "新查找";
    $("qe-type").value = "circle";
    toggleShapeInputs();
    ["qe-cx", "qe-cy", "qe-radius", "qe-minx", "qe-miny", "qe-maxx", "qe-maxy",
     "qe-cats", "qe-active", "qe-basis"].forEach((id) => { $(id).value = ""; });
  };
  $("qe-cancel").onclick = () => $("query-editor").classList.add("hidden");
  $("qe-delete").onclick = async () => {
    const qid = $("qe-id").value;
    if (qid && confirm("确认删除查找 " + qid + "？")) {
      applyPayload(await api("/api/query/delete", { query_id: qid }));
      $("query-editor").classList.add("hidden");
    }
  };
  $("query-editor").addEventListener("submit", async (evt) => {
    evt.preventDefault();
    const q = collectQueryForm();
    const data = await api("/api/query", q);
    if (data) {
      selectedQueryId = data.query_id;
      fillQueryEditor(data.state.queries.find((x) => x.query_id === data.query_id));
    }
    applyPayload(data);
  });
  $("btn-reset").onclick = async () => {
    if (confirm("重置为示例数据？当前修改将丢失。")) applyPayload(await api("/api/reset", {}));
  };
  $("btn-check").onclick = async () => {
    const c = await api("/api/consistency");
    renderConsistency(c);
    alert(c.consistent ? "增量推演结果与整体重推完全一致。"
      : "存在偏差：" + c.mismatched.join(","));
  };
  initMapEvents();
}

(async function init() {
  initEvents();
  const data = await api("/api/state");
  STATE = data.state;
  renderConsistency(data.consistency);
  if (STATE.queries.length) {
    selectedQueryId = STATE.queries[0].query_id;
    fillQueryEditor(STATE.queries[0]);
  }
  renderAll();
})();
