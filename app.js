/* 界面逻辑：状态管理、增量重推、一致性校验、渲染 */
"use strict";
const E = window.ValueEngine;
const LS_KEY = "assetValueDemo.v1";
let seqCounter = 1;
let state = load() || seed();
let results = {};                 // assetId -> 推导结果（增量缓存）
let selectedId = state.assets.length ? state.assets[0].id : null;

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY));
    if (s && Array.isArray(s.assets)) { seqCounter = s.seq || 1; return s; }
  } catch (e) { /* 忽略损坏的存档 */ }
  return null;
}
function save() {
  state.seq = seqCounter;
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}
function uid(prefix) { return prefix + "_" + Date.now().toString(36) + "_" + (seqCounter++); }
function assetById(id) { return state.assets.find(a => a.id === id); }

function seed() {
  const a1 = {
    id: "A1", name: "数控机床", cost: 120000, start: "2024-03", lifeYears: 10,
    salvage: 6000, disposalTime: "2028-06", disposalProceeds: 50000,
    adjustments: [
      { id: "J1", time: "2026-06", type: "impairment", amount: 15000,
        pending: false, excluded: false, note: "市场价下跌", seq: 1 },
    ],
  };
  const a2 = {
    id: "A2", name: "运输货车", cost: 80000, start: "2025-01", lifeYears: 5,
    salvage: 8000, disposalTime: "", disposalProceeds: null,
    adjustments: [
      { id: "J2", time: "2026-03", type: "impairment", amount: 10000,
        pending: false, excluded: false, note: "财务部估计", seq: 2 },
      { id: "J3", time: "2026-03", type: "impairment", amount: 4000,
        pending: true, excluded: false, note: "评估机构初稿（待核实）", seq: 3 },
    ],
  };
  const a3 = {
    id: "A3", name: "实验设备（资料不全）", cost: 30000, start: "2026-02",
    lifeYears: 3, salvage: null, disposalTime: "", disposalProceeds: null,
    adjustments: [],
  };
  seqCounter = 4;
  return { assets: [a1, a2, a3], seq: seqCounter };
}

/* —— 推导与一致性 —— */
function recompute(assetId) {          // 只重推受影响资产
  results[assetId] = E.computeAsset(assetById(assetId));
  checkConsistency();
}
function recomputeAll() {              // 整体重推
  results = E.computeAll(state.assets);
  checkConsistency(true);
}
function checkConsistency(skip) {
  const full = E.computeAll(state.assets);
  const same = JSON.stringify(full) === JSON.stringify(results);
  const badge = document.getElementById("consistencyBadge");
  badge.textContent = same ? "一致性：增量=整体 ✓" : "一致性：不一致 ✗";
  badge.className = "badge " + (same ? "ok" : "err");
}

/* —— 渲染入口 —— */
function renderAll() { renderList(); renderDetail(); }
function statusOf(r) {
  if (!r.ok) return { cls: "bad", text: "数据不足" };
  if (r.hasConflicts) return { cls: "conflict", text: "存在冲突" };
  if (!r.trustworthy) return { cls: "bad", text: "结论不可信" };
  if (r.hasPending) return { cls: "pending", text: "有待核实" };
  return { cls: "ok", text: "可信" };
}
function renderList() {
  const ul = document.getElementById("assetList");
  ul.innerHTML = "";
  for (const a of state.assets) {
    const r = results[a.id];
    const st = r ? statusOf(r) : { cls: "bad", text: "未推导" };
    const li = document.createElement("li");
    li.className = a.id === selectedId ? "selected" : "";
    li.title = st.text;
    const dot = document.createElement("span");
    dot.className = "dot " + st.cls;
    const name = document.createElement("span");
    name.textContent = a.name || "（未命名）";
    li.appendChild(dot); li.appendChild(name);
    li.onclick = () => { selectedId = a.id; renderAll(); };
    ul.appendChild(li);
  }
}
/* —— 详情面板 —— */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmt(n) {
  if (n == null || !isFinite(n)) return "—";
  return Number(n).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}
function renderDetail() {
  const panel = document.getElementById("detailPanel");
  const a = assetById(selectedId);
  if (!a) { panel.innerHTML = '<p class="empty-hint">请选择或新增一项资产</p>'; return; }
  const r = results[a.id];
  const st = statusOf(r);
  let html = "";
  // 基本信息
  html += '<div class="card"><h3>基本信息</h3><div class="form-grid">'
    + field("名称", '<input data-f="name" value="' + esc(a.name) + '">')
    + field("投入成本", '<input type="number" min="0" data-f="cost" value="' + nv(a.cost) + '">')
    + field("启用时刻", '<input type="month" data-f="start" value="' + esc(a.start || "") + '">')
    + field("预计使用年限", '<input type="number" min="0" step="0.5" data-f="lifeYears" value="' + nv(a.lifeYears) + '">')
    + field("残值预期", '<input type="number" min="0" data-f="salvage" value="' + nv(a.salvage) + '">')
    + field("处置时刻（可空）", '<input type="month" data-f="disposalTime" value="' + esc(a.disposalTime || "") + '">')
    + field("处置收入（可空）", '<input type="number" min="0" data-f="disposalProceeds" value="' + nv(a.disposalProceeds) + '">')
    + "</div>"
    + '<div style="margin-top:10px"><button class="danger" data-action="delAsset">删除该资产</button></div>'
    + "</div>";
  // 结论状态
  html += '<div class="card"><h3>推导结论</h3>'
    + '<span class="badge ' + (r.ok && r.trustworthy ? "ok" : "err") + '">'
    + (r.ok ? (r.trustworthy ? "结论可信" : "结论不可信") : "无法推导（数据不足）") + "</span>"
    + (r.hasConflicts ? '<span class="badge err">冲突 ' + r.conflicts.length + " 处</span>" : "")
    + (r.hasPending ? '<span class="badge warn">含待核实调整</span>' : "")
    + (r.ok ? '<span class="badge gray">期末账面价值 ' + fmt(r.finalValue) + "</span>" : "");
  if (r.issues.length) {
    html += '<ul class="issues">';
    for (const i of r.issues) html += "<li>" + esc(i.message) + "</li>";
    html += "</ul>";
  }
  if (r.disposal) {
    const d = r.disposal;
    const gl = d.gainLoss;
    html += '<div class="disposal-box" style="margin-top:10px">'
      + "<div>处置时点<br><b>" + esc(d.time) + "</b></div>"
      + "<div>处置时账面价值<br><span class='num'>" + fmt(d.bookValue) + "</span></div>"
      + "<div>处置收入<br><span class='num'>" + fmt(d.proceeds) + "</span></div>"
      + "<div>处置损益<br><span class='num " + (gl == null ? "" : gl >= 0 ? "gain" : "loss") + "'>"
      + (gl == null ? "—" : (gl >= 0 ? "+" : "") + fmt(gl)) + "</span></div>"
      + "</div>";
  }
  html += "</div>";
  // 价值曲线
  html += '<div class="card"><h3>价值曲线</h3><div id="chartWrap">'
    + (r.ok ? renderChart(a, r) : '<p class="hint">数据不足，无法绘制曲线</p>')
    + "</div></div>";
  // 调整明细
  html += renderAdjustments(a, r);
  // 逐期推导
  html += renderPeriods(r);
  panel.innerHTML = html;
}
function field(label, inputHtml) {
  return "<label>" + label + inputHtml + "</label>";
}
function nv(v) { return v == null ? "" : String(v); }
/* —— 价值曲线（SVG） —— */
function renderChart(a, r) {
  const ps = r.periods;
  if (!ps.length) return '<p class="hint">无可推导期间</p>';
  const W = Math.max(640, ps.length * 44 + 70), H = 280;
  const L = 60, R = 16, T = 16, B = 34;
  const iw = W - L - R, ih = H - T - B;
  let maxV = Math.max(a.cost || 0, a.salvage || 0);
  for (const p of ps) maxV = Math.max(maxV, p.openValue + p.adjDelta, p.closeValue);
  maxV = maxV * 1.08 || 1;
  const minV = Math.min(0, ...ps.map(p => p.closeValue));
  const x = i => L + (ps.length === 1 ? iw / 2 : (i / (ps.length - 1)) * iw);
  const y = v => T + ih - ((v - minV) / (maxV - minV)) * ih;
  let s = '<svg width="' + W + '" height="' + H + '">';
  // 坐标轴与网格
  s += line(L, T, L, T + ih, "#d0d7de") + line(L, T + ih, L + iw, T + ih, "#d0d7de");
  for (let g = 0; g <= 4; g++) {
    const v = minV + (maxV - minV) * g / 4, yy = y(v);
    s += line(L, yy, L + iw, yy, "#eef1f4");
    s += '<text x="' + (L - 6) + '" y="' + (yy + 3) + '" text-anchor="end">' + fmt(Math.round(v)) + "</text>";
  }
  // 残值虚线
  if (isFinite(a.salvage)) {
    s += '<line x1="' + L + '" y1="' + y(a.salvage) + '" x2="' + (L + iw) + '" y2="' + y(a.salvage)
      + '" stroke="#bf8700" stroke-dasharray="5,4"/>'
      + '<text x="' + (L + iw) + '" y="' + (y(a.salvage) - 4) + '" text-anchor="end">残值 ' + fmt(a.salvage) + "</text>";
  }
  // 价值折线（期末价值）
  let d = "";
  ps.forEach((p, i) => { d += (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p.closeValue).toFixed(1); });
  s += '<path d="' + d + '" fill="none" stroke="#0969da" stroke-width="2"/>';
  // 处置时刻竖线
  if (r.disposal) {
    const di = ps.findIndex(p => p.time === r.disposal.time);
    if (di >= 0) s += line(x(di), T, x(di), T + ih, "#6e7781", "4,3")
      + '<text x="' + x(di) + '" y="' + (T + 10) + '" text-anchor="middle">处置</text>';
  }
  // 调整标记
  ps.forEach((p, i) => {
    if (!p.adjDetails.length) return;
    const vAfter = p.openValue + p.adjDelta;
    const color = p.adjDetails.some(d2 => d2.type === "revaluation") ? "#8250df"
      : p.adjDelta < 0 ? "#cf222e" : "#1a7f37";
    const label = p.time + " " + p.adjDetails.map(d2 => d2.label + " " + fmt(d2.delta)).join("；")
      + (p.conflict ? "（冲突！）" : "") + (p.pending ? "（待核实）" : "");
    s += '<g><title>' + esc(label) + "</title>"
      + '<rect x="' + (x(i) - 5) + '" y="' + (y(vAfter) - 5) + '" width="10" height="10"'
      + ' transform="rotate(45 ' + x(i) + " " + y(vAfter) + ')" fill="' + color + '"'
      + (p.pending ? ' stroke="#bf8700" stroke-width="2" stroke-dasharray="2,2"' : "")
      + "/>";
    if (p.conflict)
      s += '<circle cx="' + x(i) + '" cy="' + y(vAfter) + '" r="10" fill="none" stroke="#cf222e" stroke-width="2"/>';
    s += "</g>";
  });
  // x 轴时间标签（抽样）
  const step = Math.max(1, Math.ceil(ps.length / 12));
  ps.forEach((p, i) => {
    if (i % step) return;
    s += '<text x="' + x(i) + '" y="' + (T + ih + 16) + '" text-anchor="middle"'
      + ' transform="rotate(30 ' + x(i) + " " + (T + ih + 16) + ')">' + p.time + "</text>";
  });
  s += "</svg>";
  s += '<p class="hint">菱形=价值调整（红=减值 绿=增值 紫=重估）；红圈=冲突未裁决；虚线框=含待核实调整；黄虚线=残值。悬停查看明细。</p>';
  return s;
}
function line(x1, y1, x2, y2, color, dash) {
  return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2
    + '" stroke="' + color + '"' + (dash ? ' stroke-dasharray="' + dash + '"' : "") + "/>";
}
/* —— 调整明细 —— */
function renderAdjustments(a, r) {
  const conflictTimes = {};
  for (const c of r.conflicts) conflictTimes[c.time] = c.adjustmentIds;
  let html = '<div class="card"><h3>价值调整动作</h3>'
    + '<div class="form-grid" style="margin-bottom:10px">'
    + field("发生时刻", '<input type="month" id="adjTime">')
    + field("类型", '<select id="adjType"><option value="impairment">减值</option>'
      + '<option value="appreciation">增值</option><option value="revaluation">重估（设为该价值）</option></select>')
    + field("金额", '<input type="number" min="0" id="adjAmount">')
    + field("备注", '<input id="adjNote" placeholder="来源 / 依据">')
    + field("待核实", '<input type="checkbox" id="adjPending" style="width:18px;height:18px">')
    + "<label>&nbsp;<button class='primary' data-action='addAdj'>＋ 添加调整</button></label>"
    + "</div>";
  const list = a.adjustments.slice().sort((x, y) =>
    (x.time || "").localeCompare(y.time || "") || (x.seq || 0) - (y.seq || 0));
  if (!list.length) html += '<p class="hint">暂无调整记录</p>';
  else {
    html += "<table><tr><th class='l'>时刻</th><th class='l'>类型</th><th>金额</th>"
      + "<th class='l'>状态</th><th class='l'>备注</th><th class='l'>裁决 / 操作</th></tr>";
    for (const j of list) {
      const inConflict = !j.excluded && conflictTimes[j.time];
      const cls = j.excluded ? "excluded-row" : inConflict ? "conflict-row" : j.pending ? "pending-row" : "";
      html += '<tr class="' + cls + '">'
        + "<td class='l'>" + esc(j.time || "（无效时刻）") + "</td>"
        + "<td class='l'>" + esc(E.TYPE_LABEL[j.type] || j.type) + "</td>"
        + "<td>" + fmt(j.amount) + "</td>"
        + "<td class='l'>"
        + (inConflict ? '<span class="tag conflict">冲突</span>' : "")
        + (j.pending ? '<span class="tag pending">待核实</span>' : "")
        + (j.excluded ? '<span class="tag excluded">已排除</span>' : "")
        + "</td>"
        + "<td class='l'>" + esc(j.note || "") + "</td>"
        + "<td class='l'>"
        + '<label><input type="checkbox" data-action="togglePending" data-id="' + j.id + '"'
        + (j.pending ? " checked" : "") + ">待核实</label> "
        + '<label><input type="checkbox" data-action="toggleExcluded" data-id="' + j.id + '"'
        + (j.excluded ? " checked" : "") + ">排除</label> "
        + '<button class="small danger" data-action="delAdj" data-id="' + j.id + '">删除</button>'
        + "</td></tr>";
      if (inConflict) {
        const ids = conflictTimes[j.time];
        if (ids[0] === j.id)
          html += '<tr class="conflict-row"><td colspan="6" class="l">⚠ 该时点共有 '
            + ids.length + " 条相互矛盾的调整，已全部保留并同时参与推导；请通过“排除”或“删除”裁决，"
            + "裁决前该项结论标记为不可信。</td></tr>";
      }
    }
    html += "</table>";
  }
  return html + "</div>";
}
/* —— 逐期推导表 —— */
function renderPeriods(r) {
  if (!r.ok || !r.periods.length) return "";
  let html = '<div class="card"><h3>逐期推导（月度）</h3>'
    + '<div style="max-height:320px;overflow:auto"><table>'
    + "<tr><th class='l'>期间</th><th>期初价值</th><th>价值调整</th><th>当期折旧</th>"
    + "<th>期末价值</th><th class='l'>标记</th></tr>";
  for (const p of r.periods) {
    const cls = p.conflict ? "conflict-row" : p.pending ? "pending-row" : "";
    const marks = []
      .concat(p.adjDetails.map(d2 => esc(d2.label + " " + fmt(d2.delta) + (d2.pending ? "（待核实）" : ""))))
      .concat(p.flags.map(f => "⚠ " + esc(f.message)));
    if (p.conflict) marks.unshift("⚠ 冲突");
    html += '<tr class="' + cls + '"><td class="l">' + p.time + "</td>"
      + "<td>" + fmt(p.openValue) + "</td>"
      + "<td>" + (p.adjDelta ? fmt(p.adjDelta) : "—") + "</td>"
      + "<td>" + fmt(p.dep) + "</td>"
      + "<td>" + fmt(p.closeValue) + "</td>"
      + "<td class='l'>" + (marks.join("；") || "") + "</td></tr>";
  }
  return html + "</table></div></div>";
}
/* —— 事件与数据变更 —— */
function numOrNull(v) {
  if (v === "" || v == null) return null;
  const n = parseFloat(v);
  return isFinite(n) ? n : null;
}
function mutate(assetId, fn) {         // 修改后只重推受影响资产
  fn(assetById(assetId));
  save();
  recompute(assetId);
  renderAll();
}
document.getElementById("detailPanel").addEventListener("change", ev => {
  const t = ev.target, a = assetById(selectedId);
  if (!a) return;
  const f = t.dataset.f;
  if (f) {
    mutate(a.id, asset => {
      if (f === "name") asset.name = t.value;
      else if (f === "cost" || f === "lifeYears" || f === "salvage" || f === "disposalProceeds")
        asset[f] = numOrNull(t.value);
      else if (f === "start" || f === "disposalTime") asset[f] = t.value || "";
    });
    return;
  }
  const act = t.dataset.action, id = t.dataset.id;
  if (act === "togglePending")
    mutate(a.id, asset => { asset.adjustments.find(j => j.id === id).pending = t.checked; });
  else if (act === "toggleExcluded")
    mutate(a.id, asset => { asset.adjustments.find(j => j.id === id).excluded = t.checked; });
});
document.getElementById("detailPanel").addEventListener("click", ev => {
  const t = ev.target.closest("[data-action]");
  if (!t) return;
  const a = assetById(selectedId);
  const act = t.dataset.action;
  if (act === "delAsset") {
    if (!confirm("确认删除资产「" + (a.name || "未命名") + "」及其全部调整记录？")) return;
    state.assets = state.assets.filter(x => x.id !== a.id);
    delete results[a.id];
    selectedId = state.assets.length ? state.assets[0].id : null;
    save(); recomputeAll(); renderAll();
  } else if (act === "addAdj" && a) {
    const time = document.getElementById("adjTime").value;
    const type = document.getElementById("adjType").value;
    const amount = numOrNull(document.getElementById("adjAmount").value);
    if (!time || amount === null) { alert("请填写发生时刻与金额"); return; }
    mutate(a.id, asset => {
      asset.adjustments.push({
        id: uid("J"), time, type, amount,
        pending: document.getElementById("adjPending").checked,
        excluded: false,
        note: document.getElementById("adjNote").value.trim(),
        seq: seqCounter++,
      });
    });
  } else if (act === "delAdj" && a) {
    mutate(a.id, asset => {
      asset.adjustments = asset.adjustments.filter(j => j.id !== t.dataset.id);
    });
  }
});
document.getElementById("btnAddAsset").onclick = () => {
  const a = {
    id: uid("A"), name: "新资产", cost: null, start: "", lifeYears: null,
    salvage: null, disposalTime: "", disposalProceeds: null, adjustments: [],
  };
  state.assets.push(a);
  selectedId = a.id;
  save(); recompute(a.id); renderAll();
};
document.getElementById("btnRecomputeAll").onclick = () => { recomputeAll(); renderAll(); };
document.getElementById("btnExport").onclick = () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "资产价值推演数据.json";
  link.click();
  URL.revokeObjectURL(link.href);
};
document.getElementById("btnImport").onclick = () =>
  document.getElementById("fileImport").click();
document.getElementById("fileImport").addEventListener("change", ev => {
  const file = ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const s = JSON.parse(reader.result);
      if (!s || !Array.isArray(s.assets)) throw new Error("bad");
      state = s;
      selectedId = state.assets.length ? state.assets[0].id : null;
      save(); recomputeAll(); renderAll();
    } catch (e) { alert("导入失败：文件格式不正确"); }
  };
  reader.readAsText(file);
  ev.target.value = "";
});
/* —— 启动 —— */
(function init() {
  const h = (location.hash || "").slice(1);
  if (h && assetById(h)) selectedId = h;
  recomputeAll();
  renderAll();
})();
