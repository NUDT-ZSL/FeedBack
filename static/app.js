/* 运营指标异常归因分析 — 前端逻辑 */
const S = { data: null, metric: null, segId: null };
const $ = (id) => document.getElementById(id);

async function api(url, opts) {
  const r = await fetch(url, opts);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || ("请求失败 " + r.status));
  return j;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

$("btn-sample").onclick = async () => {
  const d = await api("/api/sample", { method: "POST" });
  S.data = d; S.segId = null; S.metric = null;
  renderAll();
};

$("btn-import").onclick = () => $("import-panel").classList.toggle("hidden");

$("btn-do-import").onclick = async () => {
  $("import-error").textContent = "";
  const mf = $("file-metrics").files[0], ef = $("file-events").files[0];
  if (!mf || !ef) { $("import-error").textContent = "请同时选择指标与事件 CSV 文件"; return; }
  try {
    const [mcsv, ecsv] = await Promise.all([mf.text(), ef.text()]);
    const d = await api("/api/import", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metrics_csv: mcsv, events_csv: ecsv }),
    });
    S.data = d; S.segId = null; S.metric = null;
    $("import-panel").classList.add("hidden");
    renderAll();
  } catch (e) { $("import-error").textContent = e.message; }
};

function renderAll() {
  if (!S.data || !S.data.loaded) return;
  $("main").classList.remove("hidden");
  renderIssues();
  const metrics = Object.keys(S.data.series);
  if (!S.metric || !metrics.includes(S.metric)) S.metric = metrics[0];
  const sel = $("metric-select");
  sel.innerHTML = metrics.map(m => `<option ${m === S.metric ? "selected" : ""}>${esc(m)}</option>`).join("");
  sel.onchange = () => { S.metric = sel.value; renderChart(); };
  renderChart();
  renderSegments();
  if (S.segId) loadSegment(S.segId);
}

function renderIssues() {
  const list = $("issues-list"), issues = S.data.issues || [];
  $("issues-panel").classList.toggle("hidden", issues.length === 0);
  list.innerHTML = issues.map(it =>
    `<li><b>[${esc(it.scope)}]</b> ${esc(it.detail)}` +
    (it.dates && it.dates.length ? `<div class="dates">涉及日期：${it.dates.slice(0, 12).join("、")}${it.dates.length > 12 ? " 等" : ""}</div>` : "") +
    `</li>`).join("");
}

function renderChart() {
  const ser = S.data.series[S.metric];
  const W = Math.max(760, ser.dates.length * 9), H = 260, P = { l: 56, r: 12, t: 14, b: 30 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const vmin = Math.min(...ser.values, ...ser.baseline), vmax = Math.max(...ser.values, ...ser.baseline);
  const pad = (vmax - vmin) * 0.08 || 1;
  const y = v => P.t + ih - (v - vmin + pad) / (vmax - vmin + 2 * pad) * ih;
  const x = i => P.l + i / Math.max(ser.dates.length - 1, 1) * iw;
  const segs = S.data.segments.filter(s => s.metric === S.metric);
  const dateIdx = {}; ser.dates.forEach((d, i) => dateIdx[d] = i);
  let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`;
  for (let g = 0; g <= 4; g++) {
    const gv = vmin - pad + (vmax - vmin + 2 * pad) * g / 4, gy = y(gv);
    svg += `<line x1="${P.l}" y1="${gy}" x2="${W - P.r}" y2="${gy}" stroke="#eef2f7"/>` +
           `<text x="${P.l - 6}" y="${gy + 4}" font-size="10" fill="#8494ab" text-anchor="end">${Math.round(gv * 100) / 100}</text>`;
  }
  segs.forEach(s => {
    const i0 = dateIdx[s.start], i1 = dateIdx[s.end];
    if (i0 === undefined || i1 === undefined) return;
    svg += `<rect x="${x(i0)}" y="${P.t}" width="${Math.max(x(i1) - x(i0), 4)}" height="${ih}" fill="rgba(220,38,38,0.10)" stroke="rgba(220,38,38,0.35)" stroke-dasharray="3 3"/>`;
  });
  const pts = ser.values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const bpts = ser.baseline.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  svg += `<polyline points="${bpts}" fill="none" stroke="#94a3b8" stroke-width="1.2" stroke-dasharray="4 3"/>`;
  svg += `<polyline points="${pts}" fill="none" stroke="#2563eb" stroke-width="1.6"/>`;
  ser.missing.forEach((m, i) => {
    if (m) svg += `<circle cx="${x(i)}" cy="${y(ser.values[i])}" r="3.5" fill="#f59e0b"/>`;
  });
  (S.data.events || []).forEach(ev => {
    const i = dateIdx[ev.date];
    if (i === undefined) return;
    svg += `<line x1="${x(i)}" y1="${P.t}" x2="${x(i)}" y2="${P.t + ih}" stroke="#7c3aed" stroke-width="1" stroke-dasharray="2 2">` +
           `<title>${esc(ev.event_type)}：${esc(ev.description)}</title></line>`;
  });
  const step = Math.ceil(ser.dates.length / 12);
  ser.dates.forEach((d, i) => {
    if (i % step === 0) svg += `<text x="${x(i)}" y="${H - 8}" font-size="10" fill="#8494ab" text-anchor="middle">${d.slice(5)}</text>`;
  });
  $("chart").innerHTML = svg + "</svg>";
  $("chart-legend").innerHTML =
    `<span><i style="background:#2563eb"></i>实际值</span>` +
    `<span><i style="background:#94a3b8"></i>滚动基线</span>` +
    `<span><i style="background:rgba(220,38,38,0.4)"></i>异常区段</span>` +
    `<span><i style="background:#f59e0b"></i>缺失(插值)</span>` +
    `<span><i style="background:#7c3aed"></i>事件</span>`;
}

function renderSegments() {
  const box = $("segments-list");
  if (!S.data.segments.length) { box.innerHTML = `<div class="empty">未检测到异常区段</div>`; return; }
  box.innerHTML = S.data.segments.map(s => {
    const dir = s.direction === "up" ? `<span class="dir-up">↑ 上升</span>` : `<span class="dir-down">↓ 下降</span>`;
    const tops = (s.top_causes || []).map(c =>
      `${esc(c.event_type)} ${c.score}%${c.status === "confirmed" ? " ✓" : ""}`).join("，");
    return `<div class="seg-card ${s.id === S.segId ? "selected" : ""}" data-id="${esc(s.id)}">
      <div><b>${esc(s.metric)}</b> ${dir} <b>${s.start} ~ ${s.end}</b></div>
      <div class="meta">峰值 z=${s.peak_z}，平均偏离 ${s.mean_pct_dev}%</div>
      ${s.covers_missing ? `<div class="warn">⚠ 区段覆盖缺失数据，结论为估计</div>` : ""}
      ${tops ? `<div class="meta">候选：${tops}</div>` : `<div class="meta">时间窗内无关联事件</div>`}
    </div>`;
  }).join("");
  box.querySelectorAll(".seg-card").forEach(el =>
    el.onclick = () => loadSegment(el.dataset.id));
}

async function loadSegment(segId) {
  S.segId = segId;
  renderSegments();
  const d = await api("/api/segment/" + encodeURIComponent(segId));
  $("detail-panel").classList.remove("hidden");
  const s = d.segment;
  $("detail-title").textContent = `候选原因 — ${s.metric} ${s.start} ~ ${s.end}`;
  renderCandidates(d.ranking);
  renderHistory(d.history);
}

async function adjust(eventId, action, weight) {
  const d = await api(`/api/segment/${encodeURIComponent(S.segId)}/adjust`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_id: eventId, action, weight }),
  });
  renderCandidates(d.ranking);
  renderHistory(d.history);
  const ov = await api("/api/overview");
  S.data.segments = ov.segments;
  renderSegments();
}

function renderCandidates(ranking) {
  const box = $("candidates");
  const all = [...ranking.active, ...ranking.excluded];
  if (!all.length) { box.innerHTML = `<div class="empty">该区段时间窗内没有事件记录</div>`; return; }
  box.innerHTML = all.map(c => {
    const cls = c.status === "confirmed" ? "confirmed" : c.status === "excluded" ? "excluded" : "";
    const flags = c.flags.map(f => `<span class="flag">⚠ ${esc(f)}</span>`).join("");
    const scoreBar = c.status !== "excluded"
      ? `<div class="score-bar"><div style="width:${c.score}%"></div></div>
         <div class="meta">匹配度 ${c.score}% ｜ 历史关联强度 ${c.strength} ｜ 样本 ${c.n_events} 次 ｜ 重叠 ${c.overlap_days} 天</div>` : "";
    return `<div class="cand ${cls}">
      <div class="cand-head">
        <span class="cand-title">${esc(c.event_type)} <small>(${esc(c.event_id)}, ${c.date}${c.end_date !== c.date ? " ~ " + c.end_date : ""})</small></span>
        <span>${c.status === "confirmed" ? "✓ 已确认" : c.status === "excluded" ? "✗ 已排除" : ""}</span>
      </div>
      ${c.description ? `<div class="desc">${esc(c.description)}</div>` : ""}
      ${scoreBar}
      ${flags ? `<div class="flags">${flags}</div>` : ""}
      <div class="ops">
        <button data-a="confirm">确认</button>
        <button data-a="exclude">排除</button>
        <label>权重 <input type="range" min="0" max="3" step="0.1" value="${c.weight}" data-a="weight"> <span class="wv">${c.weight}</span></label>
        <button data-a="reset">恢复默认</button>
      </div>
    </div>`;
  }).join("");
  box.querySelectorAll(".cand").forEach((el, i) => {
    const c = all[i];
    el.querySelectorAll("button").forEach(btn => {
      btn.onclick = () => adjust(c.event_id, btn.dataset.a);
    });
    const slider = el.querySelector("input[type=range]");
    slider.oninput = () => el.querySelector(".wv").textContent = slider.value;
    slider.onchange = () => adjust(c.event_id, "weight", parseFloat(slider.value));
  });
}

function rankTable(rows, title) {
  if (!rows.length) return `<div><b>${title}</b><div class="empty">（无候选）</div></div>`;
  const trs = rows.map(r =>
    `<tr><td>${esc(r.event_type)}</td><td>${r.score === null ? "—" : r.score + "%"}</td>` +
    `<td>${r.status === "confirmed" ? "已确认" : r.status === "excluded" ? "已排除" : "待定"}</td>` +
    `<td>${r.weight}</td></tr>`).join("");
  return `<div><b>${title}</b><table><tr><th>事件</th><th>匹配度</th><th>状态</th><th>权重</th></tr>${trs}</table></div>`;
}

function renderHistory(history) {
  const box = $("history");
  if (!history || !history.length) { box.innerHTML = `<div class="empty">尚无调整记录</div>`; return; }
  box.innerHTML = [...history].reverse().map(h => `
    <div class="hist-item">
      <div class="time">#${h.seq} ｜ ${h.time}</div>
      <div>对事件 <b>${esc(h.event_id)}</b> 执行：<b>${esc(h.detail)}</b></div>
      <div class="hist-compare">${rankTable(h.before, "调整前")}${rankTable(h.after, "调整后")}</div>
    </div>`).join("");
}

// 启动后直接呈现可用界面：自动加载示例数据（导入本地数据会覆盖）
window.addEventListener("DOMContentLoaded", async () => {
  try {
    let d = await api("/api/overview");
    if (!d.loaded) d = await api("/api/sample", { method: "POST" });
    S.data = d;

    renderAll();
    const m = location.hash.match(/seg=([^&]+)/);
    if (m) loadSegment(decodeURIComponent(m[1]));
  } catch (e) { /* 服务未就绪时仅展示导入界面 */ }
});
