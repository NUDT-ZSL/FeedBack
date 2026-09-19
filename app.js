/* 创作版本回看工作台 - 纯本地离线逻辑 */
const state = {
  records: new Map(),      // id -> {id,parent,author,time,summary,retracted,pending,suggestedParent}
  selected: [],            // 最多两个版本 id
  cache: new Map(),        // pairKey -> {result, basis:[ids]}
  problems: { missing: [], cycles: [] },
  lastInvalidation: null,  // {updated, kept, reason}
};

const LS_KEY = "versionWorkbench.records";

/* ---------- 数据载入与持久化 ---------- */
function loadRecords(arr) {
  state.records.clear();
  state.cache.clear();
  state.selected = [];
  for (const r of arr) {
    if (!r || !r.id) continue;
    state.records.set(String(r.id), {
      id: String(r.id),
      parent: r.parent ? String(r.parent) : null,
      author: r.author || "未知",
      time: r.time || "",
      summary: r.summary || "",
      retracted: !!r.retracted,
      pending: false,
      suggestedParent: null,
    });
  }
  persist(); revalidate(); renderAll();
}
function persist() {
  const arr = [...state.records.values()].map(r => ({
    id: r.id, parent: r.parent, author: r.author, time: r.time,
    summary: r.summary, retracted: r.retracted || undefined,
  }));
  try { localStorage.setItem(LS_KEY, JSON.stringify(arr)); } catch (e) {}
}

/* ---------- 校验：缺失父版本 + 血缘闭环 ---------- */
function revalidate() {
  const missing = [];
  for (const r of state.records.values()) {
    if (r.parent && !state.records.has(r.parent)) {
      missing.push({ id: r.id, parent: r.parent });
    }
  }
  // Tarjan 强连通分量，大小>1 或自环即闭环
  const index = new Map(), low = new Map(), onStack = new Set(), stack = [];
  let counter = 0; const cycles = [];
  function strongconnect(v) {
    index.set(v, counter); low.set(v, counter); counter++;
    stack.push(v); onStack.add(v);
    const rec = state.records.get(v);
    const w = rec && rec.parent;
    if (w && state.records.has(w)) {
      if (!index.has(w)) { strongconnect(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) { low.set(v, Math.min(low.get(v), index.get(w))); }
    }
    if (low.get(v) === index.get(v)) {
      const scc = [];
      let w2;
      do { w2 = stack.pop(); onStack.delete(w2); scc.push(w2); } while (w2 !== v);
      const selfLoop = scc.length === 1 && state.records.get(scc[0]).parent === scc[0];
      if (scc.length > 1 || selfLoop) cycles.push(scc);
    }
  }
  for (const id of state.records.keys()) if (!index.has(id)) strongconnect(id);
  state.problems = { missing, cycles };
}
function inCycle(id) { return state.problems.cycles.some(c => c.includes(id)); }
function hasMissingParent(id) { return state.problems.missing.some(m => m.id === id); }
/* ---------- 血缘推导：祖先、分叉点、差异摘要 ---------- */
function ancestorsOf(id) {
  // 返回 Map: 祖先id -> 最短步数（含自身，自身为0）；带环保护
  const dist = new Map();
  const queue = [[id, 0]];
  while (queue.length) {
    const [cur, d] = queue.shift();
    if (dist.has(cur) && dist.get(cur) <= d) continue;
    dist.set(cur, d);
    const r = state.records.get(cur);
    if (r && r.parent && state.records.has(r.parent)) queue.push([r.parent, d + 1]);
  }
  return dist;
}
function findFork(a, b) {
  const aa = ancestorsOf(a), ab = ancestorsOf(b);
  let fork = null, best = Infinity;
  for (const [id, da] of aa) {
    if (ab.has(id)) {
      const s = da + ab.get(id);
      if (s < best) { best = s; fork = id; }
    }
  }
  return fork;
}
function pathFromTo(fork, target) {
  // 从 target 沿父链向上走到 fork，返回 fork 之后、target 及其中间的记录（未撤销的）
  const seq = []; const guard = new Set();
  let cur = target;
  while (cur && cur !== fork && !guard.has(cur)) {
    guard.add(cur);
    const r = state.records.get(cur);
    if (!r) break;
    if (!r.retracted) seq.push(r);
    cur = r.parent;
  }
  return seq.reverse();
}
function pairKey(a, b) { return [a, b].sort().join("|"); }

function computeCompare(a, b) {
  const fork = findFork(a, b);
  if (!fork) return null;
  const pathA = pathFromTo(fork, a);
  const pathB = pathFromTo(fork, b);
  const basis = [fork, ...pathA.map(r => r.id), ...pathB.map(r => r.id)];
  return { a, b, fork, pathA, pathB, basis };
}
function getCompare(a, b) {
  const key = pairKey(a, b);
  if (state.cache.has(key)) return state.cache.get(key).result;
  const result = computeCompare(a, b);
  if (result) state.cache.set(key, { result, basis: result.basis });
  return result;
}

/* ---------- 精准失效：只更新受影响的对比结论 ---------- */
function invalidateByIds(changedIds, reason) {
  const changed = new Set(changedIds);
  let updated = 0, kept = 0;
  for (const [key, entry] of [...state.cache.entries()]) {
    if (entry.basis.some(id => changed.has(id))) { state.cache.delete(key); updated++; }
    else kept++;
  }
  state.lastInvalidation = { updated, kept, reason };
}
/* ---------- 编辑操作：保存、撤销、恢复、重接父版本 ---------- */
function nearestActiveAncestor(id) {
  const guard = new Set(); let cur = state.records.get(id);
  let p = cur ? cur.parent : null;
  while (p && !guard.has(p)) {
    guard.add(p);
    const r = state.records.get(p);
    if (r && !r.retracted) return p;
    p = r ? r.parent : null;
  }
  return null;
}
function saveRecord() {
  const id = document.getElementById("fId").value.trim();
  if (!id) { alert("请填写版本标识"); return; }
  const existed = state.records.get(id);
  const rec = existed || { id, retracted: false, pending: false, suggestedParent: null };
  const summaryChanged = existed && existed.summary !== document.getElementById("fSummary").value;
  const parentChanged = existed && (existed.parent || "") !== (document.getElementById("fParent").value.trim() || "");
  rec.parent = document.getElementById("fParent").value.trim() || null;
  rec.author = document.getElementById("fAuthor").value.trim() || "未知";
  rec.time = document.getElementById("fTime").value.trim();
  rec.summary = document.getElementById("fSummary").value;
  rec.pending = false; rec.suggestedParent = null;
  state.records.set(id, rec);
  // 父链变化会影响所有后代的对比；摘要变化只影响以该版本为依据的结论
  const affected = [id];
  if (parentChanged) {
    for (const r of state.records.values()) {
      if (r.id !== id && ancestorsOf(r.id).has(id)) affected.push(r.id);
    }
  }
  invalidateByIds(affected, existed ? (parentChanged ? `修正 ${id} 的父版本` : `修正 ${id} 的摘要`) : `新增 ${id}`);
  persist(); revalidate(); renderAll();
  fillForm(id);
}
function retractRecord(id) {
  const rec = state.records.get(id);
  if (!rec || rec.retracted) return;
  rec.retracted = true;
  // 后代标为待处理，并给出可选的新父版本（最近的未撤销祖先）
  const children = [...state.records.values()].filter(r => r.parent === id);
  for (const c of children) {
    c.pending = true;
    c.suggestedParent = nearestActiveAncestor(id);
  }
  invalidateByIds([id], `撤销 ${id}`);
  persist(); revalidate(); renderAll();
}
function restoreRecord(id) {
  const rec = state.records.get(id);
  if (!rec || !rec.retracted) return;
  rec.retracted = false;
  invalidateByIds([id], `恢复 ${id}`);
  persist(); revalidate(); renderAll();
}
function acceptSuggestedParent(id) {
  const rec = state.records.get(id);
  if (!rec || !rec.pending) return;
  const oldParent = rec.parent;
  rec.parent = rec.suggestedParent;
  rec.pending = false; rec.suggestedParent = null;
  // 该子树血缘变化，失效以它为依据的结论
  const affected = [id];
  for (const r of state.records.values()) {
    if (r.id !== id && ancestorsOf(r.id).has(id)) affected.push(r.id);
  }
  invalidateByIds(affected, `${id} 重接父版本 ${oldParent} → ${rec.parent || "(根)"}`);
  persist(); revalidate(); renderAll();
  fillForm(id);
}
/* ---------- 血缘图渲染（SVG 分层布局） ---------- */
function computeLayers() {
  // 深度 = 到根的最长链；根 = 无父或父缺失/成环断点的记录
  const depth = new Map();
  const visiting = new Set();
  function depthOf(id) {
    if (depth.has(id)) return depth.get(id);
    if (visiting.has(id)) return 0; // 环内按0处理，避免死循环
    visiting.add(id);
    const r = state.records.get(id);
    let d = 0;
    if (r && r.parent && state.records.has(r.parent)) d = depthOf(r.parent) + 1;
    visiting.delete(id);
    depth.set(id, d);
    return d;
  }
  for (const id of state.records.keys()) depthOf(id);
  const layers = new Map();
  for (const [id, d] of depth) {
    if (!layers.has(d)) layers.set(d, []);
    layers.get(d).push(id);
  }
  for (const arr of layers.values()) arr.sort();
  return layers;
}
function nodeColor(r) {
  if (r.retracted) return "#9ca3af";
  if (r.pending) return "#f59e0b";
  if (inCycle(r.id) || hasMissingParent(r.id)) return "#dc2626";
  return "#2563eb";
}
function renderGraph() {
  const wrap = document.getElementById("graphWrap");
  const layers = computeLayers();
  const X = 130, Y = 74, R = 16, PAD = 40;
  const maxLayer = layers.size ? Math.max(...layers.keys()) : 0;
  let maxRow = 0;
  const pos = new Map();
  for (const [d, ids] of layers) {
    ids.forEach((id, i) => { pos.set(id, { x: PAD + d * X, y: PAD + i * Y }); maxRow = Math.max(maxRow, i); });
  }
  const W = PAD * 2 + maxLayer * X + 60, H = PAD * 2 + (maxRow + 1) * Y;
  let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`;
  for (const r of state.records.values()) {
    if (!r.parent) continue;
    const p1 = pos.get(r.id);
    const p2 = pos.get(r.parent);
    if (!p1) continue;
    if (!p2) {
      svg += `<line class="edge missing" x1="${p1.x}" y1="${p1.y}" x2="${p1.x - 46}" y2="${p1.y - 26}"/>`;
      svg += `<text x="${p1.x - 50}" y="${p1.y - 32}" fill="#dc2626" text-anchor="end">父版本 ${esc(r.parent)} 缺失</text>`;
      continue;
    }
    const cls = inCycle(r.id) && inCycle(r.parent) ? "edge cycle" : "edge";
    const mx = (p1.x + p2.x) / 2;
    svg += `<path class="${cls}" d="M ${p1.x} ${p1.y} C ${mx} ${p1.y}, ${mx} ${p2.y}, ${p2.x} ${p2.y}"/>`;
  }
  for (const r of state.records.values()) {
    const p = pos.get(r.id); if (!p) continue;
    const sel = state.selected.includes(r.id) ? " selected" : "";
    const color = nodeColor(r);
    svg += `<g class="node${sel}" data-id="${esc(r.id)}" transform="translate(${p.x},${p.y})">`;
    svg += `<circle r="${R}" fill="${color}"/>`;
    if (r.retracted) svg += `<line x1="-9" y1="0" x2="9" y2="0" stroke="#fff" stroke-width="2"/>`;
    svg += `<text y="${R + 14}" text-anchor="middle" fill="#374151">${esc(r.id)}</text>`;
    let badge = "";
    if (r.retracted) badge = "已撤销";
    else if (r.pending) badge = "待处理";
    else if (inCycle(r.id)) badge = "闭环";
    else if (hasMissingParent(r.id)) badge = "父缺失";
    if (badge) svg += `<text y="${-R - 6}" text-anchor="middle" fill="${color}" font-weight="bold">${badge}</text>`;
    svg += `<title>${esc(r.id)} | ${esc(r.author)} | ${esc(r.time)}\n${esc(r.summary)}</title></g>`;
  }
  svg += "</svg>";
  wrap.innerHTML = svg;
  wrap.querySelectorAll(".node").forEach(n => n.addEventListener("click", () => toggleSelect(n.dataset.id)));
}
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
/* ---------- 选择与对比面板 ---------- */
function toggleSelect(id) {
  const i = state.selected.indexOf(id);
  if (i >= 0) state.selected.splice(i, 1);
  else { state.selected.push(id); if (state.selected.length > 2) state.selected.shift(); }
  renderGraph(); renderCompare(); fillForm(id);
}
function diffList(path) {
  if (!path.length) return "<li style='color:#8b949e'>(无有效改动，可能已撤销或即分叉点)</li>";
  return path.map(r => `<li><b>${esc(r.id)}</b> [${esc(r.author)} ${esc(r.time)}]<br>${esc(r.summary)}</li>`).join("");
}
function renderCompare() {
  const el = document.getElementById("compare");
  const sel = state.selected;
  if (sel.length < 2) {
    el.innerHTML = `<div class="selinfo">已选 ${sel.length}/2：${sel.map(s => "<b>" + esc(s) + "</b>").join("、") || "（在左侧血缘图点击两个版本）"}</div>`;
    return;
  }
  const [a, b] = sel;
  const res = getCompare(a, b);
  if (!res) { el.innerHTML = `<div class="selinfo">${esc(a)} 与 ${esc(b)} 没有共同祖先，无法推出分叉点。</div>`; return; }
  const cached = state.cache.has(pairKey(a, b)) ? "" : "";
  el.innerHTML = `
    <div class="selinfo">对比 <b>${esc(a)}</b> ↔ <b>${esc(b)}</b> ｜ 分叉点：<b>${esc(res.fork)}</b>${state.records.get(res.fork) ? "（" + esc(state.records.get(res.fork).summary) + "）" : ""}</div>
    <div class="diffcols">
      <div class="diffcol"><h3>分叉点 → ${esc(a)} 的改动</h3><ul>${diffList(res.pathA)}</ul></div>
      <div class="diffcol"><h3>分叉点 → ${esc(b)} 的改动</h3><ul>${diffList(res.pathB)}</ul></div>
    </div>
    <div class="basis">差异依据来自版本：${res.basis.map(id => `<code>${esc(id)}</code>`).join("")}</div>`;
}
function renderProblems() {
  const el = document.getElementById("problems");
  const items = [];
  for (const m of state.problems.missing) {
    items.push(`<div class="item err">⚠ 版本 <b>${esc(m.id)}</b> 的父版本 <b>${esc(m.parent)}</b> 不存在，未强行挂接，请修正父版本指向。</div>`);
  }
  for (const c of state.problems.cycles) {
    items.push(`<div class="item err">⚠ 检测到血缘闭环：${c.map(esc).join(" → ")} → ${esc(c[0])}，涉及版本均已在图中标红。</div>`);
  }
  for (const r of state.records.values()) {
    if (r.pending) {
      items.push(`<div class="item warn">◆ <b>${esc(r.id)}</b> 的父版本已被撤销，待处理。建议新父版本：<b>${esc(r.suggestedParent || "(设为根版本)")}</b>，可在右侧表单接受或手动指定。</div>`);
    }
  }
  el.innerHTML = items.length ? items.join("") : `<div class="ok">✓ 未发现缺失父版本、血缘闭环或待处理后代。</div>`;
}
function renderCachebar() {
  const bar = document.getElementById("cachebar");
  let txt = `对比结论缓存：${state.cache.size} 条`;
  if (state.lastInvalidation) {
    const li = state.lastInvalidation;
    txt += ` ｜ 最近改动（${esc(li.reason)}）：更新 ${li.updated} 条结论，保持 ${li.kept} 条不变`;
  }
  bar.textContent = txt;
}
function renderStat() {
  const n = state.records.size;
  const rt = [...state.records.values()].filter(r => r.retracted).length;
  document.getElementById("stat").textContent = `共 ${n} 个版本，已撤销 ${rt} 个`;
}
/* ---------- 表单与事件 ---------- */
function fillForm(id) {
  const r = state.records.get(id);
  if (!r) return;
  document.getElementById("fId").value = r.id;
  document.getElementById("fParent").value = r.parent || "";
  document.getElementById("fAuthor").value = r.author;
  document.getElementById("fTime").value = r.time;
  document.getElementById("fSummary").value = r.summary;
  const hint = document.getElementById("pendingHint");
  if (r.pending) {
    hint.style.display = "block";
    hint.textContent = `该版本父版本已被撤销，待处理。建议新父版本：${r.suggestedParent || "(设为根版本)"}。可点击“接受建议的新父版本”，或手动修改父版本后保存。`;
  } else hint.style.display = "none";
}
function renderDatalist() {
  document.getElementById("idList").innerHTML =
    [...state.records.keys()].map(id => `<option value="${esc(id)}">`).join("");
}
function renderAll() {
  renderGraph(); renderCompare(); renderProblems(); renderCachebar(); renderStat(); renderDatalist();
}

document.getElementById("btnSave").addEventListener("click", saveRecord);
document.getElementById("btnRetract").addEventListener("click", () => {
  const id = document.getElementById("fId").value.trim();
  if (state.records.has(id)) retractRecord(id);
});
document.getElementById("btnRestore").addEventListener("click", () => {
  const id = document.getElementById("fId").value.trim();
  if (state.records.has(id)) restoreRecord(id);
});
document.getElementById("btnAcceptParent").addEventListener("click", () => {
  const id = document.getElementById("fId").value.trim();
  if (state.records.has(id)) acceptSuggestedParent(id);
});
document.getElementById("btnLoad").addEventListener("click", () => document.getElementById("fileInput").click());
document.getElementById("fileInput").addEventListener("change", e => {
  const f = e.target.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const arr = Array.isArray(data) ? data : data.versions;
      if (!Array.isArray(arr)) throw new Error("JSON 应为数组或含 versions 字段");
      loadRecords(arr);
    } catch (err) { alert("载入失败：" + err.message); }
  };
  reader.readAsText(f, "utf-8");
  e.target.value = "";
});
document.getElementById("btnExport").addEventListener("click", () => {
  const arr = [...state.records.values()].map(r => ({
    id: r.id, parent: r.parent, author: r.author, time: r.time,
    summary: r.summary, retracted: r.retracted || undefined,
  }));
  const blob = new Blob([JSON.stringify(arr, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "versions.json";
  a.click();
  URL.revokeObjectURL(a.href);
});
document.getElementById("btnSample").addEventListener("click", () => loadRecords(SAMPLE_DATA));

/* ---------- 示例数据与启动 ---------- */
const SAMPLE_DATA = [
  { id: "v1", parent: null, author: "林然", time: "2026-08-01 09:30", summary: "初稿：搭建全书框架与章节大纲" },
  { id: "v2", parent: "v1", author: "周航", time: "2026-08-03 14:10", summary: "扩写第一章背景与人物设定" },
  { id: "v3", parent: "v2", author: "林然", time: "2026-08-05 10:02", summary: "修订第一章措辞，补充时间线" },
  { id: "v4", parent: "v2", author: "陈默", time: "2026-08-06 16:40", summary: "分支：重写第二章冲突场景" },
  { id: "v5", parent: "v3", author: "周航", time: "2026-08-08 11:25", summary: "合并第一章反馈，新增附录草稿" },
  { id: "v6", parent: "v4", author: "陈默", time: "2026-08-09 09:15", summary: "第二章补充分镜与对白" },
  { id: "v7", parent: "v5", author: "林然", time: "2026-08-11 15:55", summary: "全书一致性校对（人名、时间线）" },
  { id: "v8", parent: "v6", author: "周航", time: "2026-08-12 13:20", summary: "第二章结尾改写，呼应第一章伏笔" },
  { id: "v9", parent: "v7", author: "陈默", time: "2026-08-14 10:40", summary: "根据审校意见调整第三章节奏" },
  { id: "v10", parent: "v0", author: "外部来稿", time: "2026-08-15 09:00", summary: "外部作者提交的番外章节（父版本 v0 不在记录中）" },
  { id: "v11", parent: "v12", author: "系统导入", time: "2026-08-16 11:00", summary: "批量导入的历史稿 A（与 B 互相指向）" },
  { id: "v12", parent: "v11", author: "系统导入", time: "2026-08-16 11:01", summary: "批量导入的历史稿 B（与 A 互相指向）" }
];

(function init() {
  let arr = null;
  try { arr = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (e) {}
  loadRecords(Array.isArray(arr) && arr.length ? arr : SAMPLE_DATA);
})();