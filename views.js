/* 决策回放 - 渲染层 */
"use strict";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTime(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtScore(n) { return (n > 0 ? "+" : "") + round2(n); }

function statusBadge(opt) {
  if (opt.status === "executed") return '<span class="badge executed">已执行</span>';
  if (opt.status === "abandoned") return '<span class="badge abandoned">已放弃</span>';
  return "";
}

function renderDecisionList(state) {
  const ul = document.getElementById("decision-list");
  ul.innerHTML = "";
  for (const d of store.data.decisions) {
    const li = document.createElement("li");
    if (d.id === state.selectedId) li.classList.add("active");
    const open = d.options.filter(o => o.status === "open").length;
    li.innerHTML = `<div class="d-title">${esc(d.title)}</div>
      <div class="d-meta">${d.options.length} 个选项（${open} 个待定） · ${d.snapshots.length} 次评估 · ${fmtTime(d.createdAt)}</div>`;
    li.onclick = () => { state.selectedId = d.id; renderAll(state); };
    ul.appendChild(li);
  }
}

function renderAll(state) {
  renderDecisionList(state);
  const d = store.data.decisions.find(x => x.id === state.selectedId);
  renderDetail(state, d || null);
}

function renderDetail(state, d) {
  const root = document.getElementById("detail");
  if (!d) { root.innerHTML = '<div class="empty-hint">请选择或新建一个决策</div>'; return; }
  const now = Date.now();
  const scores = computeScores(d, now);
  const lastSnap = d.snapshots[d.snapshots.length - 1];

  let html = `<div class="detail-head">
    <div>
      <h2>${esc(d.title)}</h2>
      ${d.context ? `<div class="context">${esc(d.context)}</div>` : ""}
    </div>
    <div class="actions">
      <button class="btn" data-act="add-option">+ 选项</button>
      <button class="btn" data-act="add-info" ${d.options.length ? "" : "disabled"}>+ 新信息</button>
      <button class="btn primary" data-act="recalc" ${d.options.length ? "" : "disabled"}>重新评估</button>
      <button class="btn" data-act="compare" ${d.snapshots.length ? "" : "disabled"}>演变对比</button>
      <button class="btn danger" data-act="del-decision">删除</button>
    </div>
  </div>
  <div class="options-grid">`;

  for (const opt of d.options) {
    const s = scores[opt.id];
    const prev = lastSnap && lastSnap.scores[opt.id] ? lastSnap.scores[opt.id].score : null;
    const delta = (prev === null || s.frozen) ? null : round2(s.score - prev);
    html += `<div class="option-card ${opt.status}">
      <div class="opt-head">
        <span class="opt-name">${esc(opt.name)}${statusBadge(opt)}</span>
        <span>
          <span class="score ${s.score >= 0 ? "pos" : "neg"}">${fmtScore(s.score)}</span>
          ${delta !== null && delta !== 0 ? `<span class="score-delta ${delta > 0 ? "up" : "down"}">${delta > 0 ? "▲" : "▼"}${Math.abs(delta)}</span>` : ""}
        </span>
      </div>`;
    if (s.frozen) {
      html += `<div class="frozen-note">评估已冻结于 ${fmtTime(opt.frozenAt)}，不再参与后续重算。</div>`;
    } else if (s.dominant) {
      html += `<div style="margin-top:4px"><span class="badge dominant">主导依据：${esc(s.dominant.r.text)}</span></div>`;
    }
    html += `<ul class="rat-list">`;
    for (const c of s.contributions) {
      const r = c.r;
      if (c.invalidated) {
        html += `<li class="invalidated">
          <span class="rat-text">${esc(r.text)} <span class="badge invalid">已失效</span>
          ${r.invalidatedBy ? `<br><small>被「${esc(r.invalidatedBy)}」推翻</small>` : ""}</span>
          <span class="rat-eff">0</span></li>`;
      } else {
        const raw = effectiveWeight(r, now);
        const decayPct = Math.round((1 - raw / r.weight) * 100);
        html += `<li>
          <span class="rat-text">${r.direction > 0 ? "＋" : "－"} ${esc(r.text)}</span>
          <span class="rat-eff">${fmtScore(c.eff)}
            <span class="decayed">(权重 ${r.weight}${decayPct > 0 ? `，衰减 ${decayPct}%` : ""})</span></span>
        </li>`;
      }
    }
    if (!s.contributions.length && !s.frozen) html += `<li style="color:var(--muted)">暂无依据</li>`;
    html += `</ul><div class="opt-actions">`;
    if (opt.status === "open") {
      html += `<button class="btn small" data-act="add-rationale" data-opt="${opt.id}">+ 依据</button>
        <button class="btn small" data-act="execute" data-opt="${opt.id}">标记已执行</button>
        <button class="btn small" data-act="abandon" data-opt="${opt.id}">标记放弃</button>`;
    }
    html += `</div></div>`;
  }
  html += `</div>`;
  html += renderTimeline(d);
  root.innerHTML = html;
}

/* 评估历史时间线 */
function renderTimeline(d) {
  if (!d.snapshots.length) return "";
  let html = `<div class="section-title">评估历史（${d.snapshots.length} 次重算，旧结论全部保留）</div>
    <div class="timeline"><table><thead><tr><th>时间</th><th>说明</th>`;
  for (const opt of d.options) html += `<th>${esc(opt.name)}</th>`;
  html += `</tr></thead><tbody>`;
  for (let i = 0; i < d.snapshots.length; i++) {
    const snap = d.snapshots[i];
    html += `<tr><td>${fmtTime(snap.at)}</td><td>${esc(snap.note)}</td>`;
    for (const opt of d.options) {
      const cell = snap.scores[opt.id];
      if (!cell) { html += `<td>—</td>`; continue; }
      let deltaHtml = "";
      if (i > 0) {
        const prev = d.snapshots[i - 1].scores[opt.id];
        if (prev && !cell.frozen) {
          const delta = round2(cell.score - prev.score);
          const cls = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
          deltaHtml = ` <span class="delta-chip ${cls}">${delta > 0 ? "+" : ""}${delta}</span>`;
        }
      }
      html += `<td>${fmtScore(cell.score)}${deltaHtml}${cell.frozen ? ' <span class="badge abandoned">冻结</span>' : ""}
        <br><small>主导：${esc(cell.dominant)}</small>
        ${cell.invalidated && cell.invalidated.length ? `<br><small style="color:var(--bad)">失效：${cell.invalidated.map(esc).join("、")}</small>` : ""}</td>`;
    }
    html += `</tr>`;
  }
  html += `</tbody></table></div>`;
  return html;
}

/* 演变对比：轨迹图 + 主导依据更替表 */
const PALETTE = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed", "#0891b2"];

function renderCompare(d) {
  const body = document.getElementById("compare-body");
  if (!d.snapshots.length) { body.innerHTML = "<p>暂无评估记录。</p>"; return; }
  let legend = '<div class="legend">';
  d.options.forEach((o, i) => {
    legend += `<span style="--c:${PALETTE[i % PALETTE.length]}">${esc(o.name)}</span>`;
  });
  legend += "</div>";
  body.innerHTML = legend + '<canvas id="compare-chart" width="840" height="320"></canvas>'
    + '<div class="section-title">各时间点评估值与主导依据</div><div id="compare-table-wrap"></div>';

  // 表格
  let t = '<table class="compare-table"><thead><tr><th>时间</th>';
  for (const o of d.options) t += `<th>${esc(o.name)}</th>`;
  t += "</tr></thead><tbody>";
  for (const snap of d.snapshots) {
    t += `<tr><td>${fmtTime(snap.at)}<br><small>${esc(snap.note)}</small></td>`;
    for (const o of d.options) {
      const c = snap.scores[o.id];
      t += c ? `<td><b>${fmtScore(c.score)}</b>${c.frozen ? "（冻结）" : ""}<br><small>主导：${esc(c.dominant)}</small></td>` : "<td>—</td>";
    }
    t += "</tr>";
  }
  t += "</tbody></table>";
  document.getElementById("compare-table-wrap").innerHTML = t;

  drawChart(document.getElementById("compare-chart"), d);
}

function drawChart(canvas, d) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height, pad = 44;
  ctx.clearRect(0, 0, W, H);
  const snaps = d.snapshots;
  let min = 0, max = 0;
  for (const s of snaps) for (const o of d.options) {
    const c = s.scores[o.id];
    if (c) { min = Math.min(min, c.score); max = Math.max(max, c.score); }
  }
  if (max === min) { max += 1; min -= 1; }
  const x = i => snaps.length === 1 ? W / 2 : pad + i * (W - 2 * pad) / (snaps.length - 1);
  const y = v => H - pad - (v - min) * (H - 2 * pad) / (max - min);
  // 网格与零线
  ctx.strokeStyle = "#e2e6ec"; ctx.fillStyle = "#6b7686"; ctx.font = "11px sans-serif";
  for (let g = 0; g <= 4; g++) {
    const v = min + (max - min) * g / 4;
    ctx.beginPath(); ctx.moveTo(pad, y(v)); ctx.lineTo(W - pad, y(v)); ctx.stroke();
    ctx.fillText(fmtScore(round2(v)), 4, y(v) + 4);
  }
  if (min < 0 && max > 0) {
    ctx.strokeStyle = "#94a3b8"; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(pad, y(0)); ctx.lineTo(W - pad, y(0)); ctx.stroke();
    ctx.setLineDash([]);
  }
  // 每个选项一条轨迹
  d.options.forEach((o, oi) => {
    ctx.strokeStyle = PALETTE[oi % PALETTE.length]; ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    snaps.forEach((s, i) => {
      const c = s.scores[o.id];
      if (!c) return;
      if (!started) { ctx.moveTo(x(i), y(c.score)); started = true; }
      else ctx.lineTo(x(i), y(c.score));
    });
    ctx.stroke();
    snaps.forEach((s, i) => {
      const c = s.scores[o.id];
      if (!c) return;
      ctx.fillStyle = PALETTE[oi % PALETTE.length];
      ctx.beginPath(); ctx.arc(x(i), y(c.score), 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#1f2733";
      ctx.fillText(fmtScore(c.score), x(i) - 10, y(c.score) - 8);
    });
  });
}
