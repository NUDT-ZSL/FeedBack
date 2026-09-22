"use strict";
/* 组件变体与约束管理台 —— 纯前端离线应用，无外部依赖 */

// ---------- 工具 ----------
const uid = () => "id_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LS_KEY = "variant-constraint-studio-v1";

function toast(msg, kind) {
  const box = $("#toasts");
  const el = document.createElement("div");
  el.className = "toast" + (kind ? " " + kind : "");
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

// ---------- 数据模型 ----------
// component: { id, name, dims:[{id,name,values:[str]}],
//   constraints:[{id,type:'mutex'|'requires',a:{dimId,value},b:{dimId,value},ignored:bool}] }
let state = null;
// 每个组件的判定缓存：Map<comboKey, result>，配合增量重评
const comboCache = new Map(); // compId -> Map
let lastUpdateInfo = { reevaluated: 0, total: 0, reason: "初始化" };

function seedState() {
  const dSize = uid(), dState = uid(), dTheme = uid();
  return {
    activeId: null,
    components: [{
      id: uid(), name: "按钮 Button",
      dims: [
        { id: dSize, name: "尺寸", values: ["小", "中", "大"] },
        { id: dState, name: "状态", values: ["默认", "悬停", "禁用"] },
        { id: dTheme, name: "主题", values: ["浅色", "深色"] },
      ],
      constraints: [
        { id: uid(), type: "mutex", a: { dimId: dSize, value: "大" }, b: { dimId: dState, value: "禁用" }, ignored: false },
        { id: uid(), type: "requires", a: { dimId: dState, value: "悬停" }, b: { dimId: dTheme, value: "浅色" }, ignored: false },
      ],
    }],
    selection: {},
    filter: "all",
  };
}

function save() { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) { state = JSON.parse(raw); return; }
  } catch (e) { /* 损坏则重建 */ }
  state = seedState();
  state.activeId = state.components[0].id;
}

function activeComp() { return state.components.find((c) => c.id === state.activeId) || null; }
function dimOf(comp, dimId) { return comp.dims.find((d) => d.id === dimId) || null; }
function dimName(comp, dimId) { const d = dimOf(comp, dimId); return d ? d.name : "（已删除维度）"; }
function refText(comp, ref) {
  const d = dimOf(comp, ref.dimId);
  const ok = d && d.values.includes(ref.value);
  return (d ? d.name : "??") + " = " + (ok ? ref.value : "「" + ref.value + "」（取值不存在）");
}

// ---------- 完整性分析：失效引用 + 依赖闭环 ----------
// 返回 { broken:Set<conId>, cycle:Set<conId>, cycleNodes:Set<valKey> }
// valKey 形如 dimId + "\u0001" + value
function analyzeIntegrity(comp) {
  const broken = new Set();
  const valKey = (r) => r.dimId + "\u0001" + r.value;
  const refOk = (r) => { const d = dimOf(comp, r.dimId); return !!(d && d.values.includes(r.value)); };
  for (const c of comp.constraints) {
    if (!refOk(c.a) || !refOk(c.b)) broken.add(c.id);
  }
  // 依赖图：仅取引用有效的 requires 约束，a -> b
  const adj = new Map();
  const edgeCon = new Map(); // "from>to" -> [conId]
  for (const c of comp.constraints) {
    if (c.type !== "requires" || broken.has(c.id)) continue;
    const ka = valKey(c.a), kb = valKey(c.b);
    if (!adj.has(ka)) adj.set(ka, []);
    adj.get(ka).push(kb);
    const ek = ka + ">" + kb;
    if (!edgeCon.has(ek)) edgeCon.set(ek, []);
    edgeCon.get(ek).push(c.id);
  }
  // Tarjan 强连通分量，大小>1 或自环即闭环
  const index = new Map(), low = new Map(), onStack = new Set(), stack = [];
  let counter = 0;
  const cycleNodes = new Set();
  function strongconnect(v) {
    index.set(v, counter); low.set(v, counter); counter++;
    stack.push(v); onStack.add(v);
    for (const w of (adj.get(v) || [])) {
      if (!index.has(w)) { strongconnect(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) { low.set(v, Math.min(low.get(v), index.get(w))); }
    }
    if (low.get(v) === index.get(v)) {
      const scc = [];
      let w;
      do { w = stack.pop(); onStack.delete(w); scc.push(w); } while (w !== v);
      const selfLoop = scc.length === 1 && (adj.get(v) || []).includes(v);
      if (scc.length > 1 || selfLoop) scc.forEach((n) => cycleNodes.add(n));
    }
  }
  for (const v of adj.keys()) if (!index.has(v)) strongconnect(v);
  // 标记落在闭环上的约束
  const cycle = new Set();
  for (const c of comp.constraints) {
    if (c.type !== "requires" || broken.has(c.id)) continue;
    if (cycleNodes.has(valKey(c.a)) || cycleNodes.has(valKey(c.b))) cycle.add(c.id);
  }
  return { broken, cycle, cycleNodes };
}

// ---------- 组合枚举 ----------
function comboKeyOf(comp, combo) {
  return comp.dims.map((d) => combo[d.id] ?? "").join("\u0001");
}
function enumerateCombos(comp) {
  const out = [];
  (function rec(i, acc) {
    if (i === comp.dims.length) { out.push({ ...acc }); return; }
    const d = comp.dims[i];
    for (const v of d.values) { acc[d.id] = v; rec(i + 1, acc); }
  })(0, {});
  return out;
}

// ---------- 组合判定 ----------
// result: { status:'valid'|'invalid'|'untrusted', verdicts:[{conId,kind,msg}] }
// kind: 'violation'(互斥冲突) | 'unmet'(依赖未满足) | 'broken'(引用失效) | 'cycle'(依赖闭环)
function evaluateCombo(comp, combo, integrity) {
  const verdicts = [];
  const has = (ref) => combo[ref.dimId] === ref.value;
  const valKey = (r) => r.dimId + "\u0001" + r.value;
  for (const c of comp.constraints) {
    if (c.ignored) continue; // 用户已裁决忽略此约束
    if (integrity.broken.has(c.id)) {
      // 引用失效：只要组合触及该约束仍有效的一端，结论不可信
      if (has(c.a) || has(c.b)) {
        verdicts.push({ conId: c.id, kind: "broken",
          msg: "约束引用了不存在的取值（" + refText(comp, c.a) + " / " + refText(comp, c.b) + "），无法判定" });
      }
      continue;
    }
    if (integrity.cycle.has(c.id)) {
      if (has(c.a) || has(c.b)) {
        verdicts.push({ conId: c.id, kind: "cycle",
          msg: "依赖关系存在闭环（涉及 " + refText(comp, c.a) + "），结论不可信" });
      }
      continue;
    }
    if (c.type === "mutex") {
      if (has(c.a) && has(c.b)) {
        verdicts.push({ conId: c.id, kind: "violation",
          msg: "互斥冲突：" + refText(comp, c.a) + " 与 " + refText(comp, c.b) + " 不可共存" });
      }
    } else { // requires
      if (has(c.a) && !has(c.b)) {
        verdicts.push({ conId: c.id, kind: "unmet",
          msg: "依赖未满足：选择 " + refText(comp, c.a) + " 时必须同时选择 " + refText(comp, c.b) });
      }
    }
  }
  // 组合含闭环节点取值（即使对应约束被忽略）也标不可信
  for (const d of comp.dims) {
    if (integrity.cycleNodes.has(d.id + "\u0001" + combo[d.id])) {
      const already = verdicts.some((v) => v.kind === "cycle");
      if (!already) verdicts.push({ conId: null, kind: "cycle",
        msg: "取值 " + d.name + " = " + combo[d.id] + " 处于依赖闭环中，结论不可信" });
      break;
    }
  }
  let status = "valid";
  if (verdicts.some((v) => v.kind === "violation" || v.kind === "unmet")) status = "invalid";
  else if (verdicts.length > 0) status = "untrusted";
  return { status, verdicts };
}

// ---------- 增量重评 ----------
// 维度/取值变化：新组合键不在缓存中即重评，失效键清理 —— 天然只更新受影响组合。
// 新增约束：只重评触及该约束两端取值的组合（含闭环影响，闭环必经过新边端点）。
// 删除/裁决约束：影响面可能扩散（如拆环），做全量重评。
function recompute(comp, opts) {
  opts = opts || {};
  const integrity = analyzeIntegrity(comp);
  const combos = enumerateCombos(comp);
  let cache = comboCache.get(comp.id);
  if (!cache || opts.full) { cache = new Map(); comboCache.set(comp.id, cache); }
  let n = 0;
  const touchedKeys = new Set();
  if (opts.constraint) {
    for (const r of [opts.constraint.a, opts.constraint.b]) {
      if (r) touchedKeys.add(r.dimId + "\u0001" + r.value);
    }
  }
  for (const combo of combos) {
    const key = comboKeyOf(comp, combo);
    let need = opts.full || !cache.has(key);
    if (!need && opts.constraint) {
      need = [...touchedKeys].some((k) => {
        const idx = k.indexOf("\u0001");
        return combo[k.slice(0, idx)] === k.slice(idx + 1);
      });
    }
    if (need) { cache.set(key, evaluateCombo(comp, combo, integrity)); n++; }
  }
  // 清理已不存在的组合键（维度/取值删除后）
  const validKeys = new Set(combos.map((c) => comboKeyOf(comp, c)));
  for (const k of cache.keys()) if (!validKeys.has(k)) cache.delete(k);
  lastUpdateInfo = { reevaluated: n, total: combos.length, reason: opts.reason || "变更" };
  return { combos, integrity, cache, info: lastUpdateInfo };
}

// ---------- 渲染：组件切换 ----------
function renderCompSelect() {
  const sel = $("#compSelect");
  sel.innerHTML = state.components.map((c) =>
    `<option value="${c.id}" ${c.id === state.activeId ? "selected" : ""}>${esc(c.name)}</option>`).join("");
}

// ---------- 渲染：维度面板 ----------
function renderDims(comp) {
  const box = $("#dimList");
  if (!comp.dims.length) { box.innerHTML = `<div class="empty">还没有维度，先添加一个（如：尺寸）</div>`; return; }
  box.innerHTML = comp.dims.map((d) => `
    <div class="dim" data-dim="${d.id}">
      <div class="dim-head">
        <b>${esc(d.name)}</b>
        <button class="btn small danger" data-act="delDim" title="删除维度">删除</button>
      </div>
      <div class="chips">
        ${d.values.map((v) => `<span class="chip">${esc(v)}<button data-act="delVal" data-val="${esc(v)}" title="移除取值">×</button></span>`).join("")}
        ${d.values.length ? "" : `<span class="empty">暂无取值</span>`}
      </div>
      <form class="valadd" data-dim="${d.id}">
        <input placeholder="新取值" required>
        <button class="btn small" type="submit">＋</button>
      </form>
    </div>`).join("");
}

// ---------- 渲染：约束面板 ----------
function fillRefSelects(comp) {
  const dimOpts = comp.dims.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join("");
  $("#selDimA").innerHTML = dimOpts;
  $("#selDimB").innerHTML = dimOpts;
  if (comp.dims.length > 1) $("#selDimB").selectedIndex = 1; // B 默认选第二个维度，减少误配
  const fillVals = (dimSel, valSel) => {
    const d = dimOf(comp, $(dimSel).value);
    $(valSel).innerHTML = d ? d.values.map((v) => `<option>${esc(v)}</option>`).join("") : "";
  };
  fillVals("#selDimA", "#selValA");
  fillVals("#selDimB", "#selValB");
}

function renderConstraints(comp, integrity) {
  const box = $("#conList");
  if (!comp.constraints.length) { box.innerHTML = `<div class="empty">暂无约束。添加互斥或依赖规则后即时生效。</div>`; return; }
  box.innerHTML = comp.constraints.map((c) => {
    const cls = ["con"];
    const badges = [];
    if (integrity.broken.has(c.id)) { cls.push("broken"); badges.push(`<span class="badge warn">引用失效</span>`); }
    if (integrity.cycle.has(c.id)) { cls.push("cycle"); badges.push(`<span class="badge cyc">依赖闭环</span>`); }
    if (c.ignored) { cls.push("off"); badges.push(`<span class="badge ignored">已裁决忽略</span>`); }
    if (!badges.length) badges.push(`<span class="badge ok">正常</span>`);
    const txt = c.type === "mutex"
      ? `互斥：${esc(refText(comp, c.a))} ⚡ ${esc(refText(comp, c.b))}`
      : `依赖：${esc(refText(comp, c.a))} ⇒ 必须 ${esc(refText(comp, c.b))}`;
    return `<div class="${cls.join(" ")}" data-con="${c.id}">
      <div class="con-head"><span class="txt">${txt}</span>${badges.join("")}</div>
      <div class="con-actions">
        <button class="btn small" data-act="toggleCon">${c.ignored ? "恢复启用" : "裁决：忽略"}</button>
        <button class="btn small danger" data-act="delCon">删除</button>
      </div>
    </div>`;
  }).join("");
}

// ---------- 渲染：组合选择器 + 判定结果 ----------
function currentSelection(comp) {
  const sel = state.selection[comp.id] || {};
  for (const d of comp.dims) {
    if (!d.values.includes(sel[d.id])) sel[d.id] = d.values[0] ?? "";
  }
  state.selection[comp.id] = sel;
  return sel;
}

function renderPicker(comp) {
  const sel = currentSelection(comp);
  $("#picker").innerHTML = comp.dims.map((d) => `
    <div class="pick">
      <label>${esc(d.name)}</label>
      <select data-pickdim="${d.id}">
        ${d.values.map((v) => `<option ${sel[d.id] === v ? "selected" : ""}>${esc(v)}</option>`).join("")}
      </select>
    </div>`).join("");
}

const STATUS_TEXT = { valid: "✔ 有效变体", invalid: "✖ 被约束排除", untrusted: "⚠ 结论不可信" };
function verdictHtml(result) {
  const items = result.verdicts.map((v) => `<li>${esc(v.msg)}</li>`).join("");
  const extra = result.verdicts.length
    ? `<ul>${items}</ul><div class="reasons">共 ${result.verdicts.length} 条判定依据；可在左侧“裁决：忽略”某条约束后收敛结论。</div>`
    : `<div class="reasons">无任何约束命中，组合有效。</div>`;
  return `<div class="v-title">${STATUS_TEXT[result.status]}</div>${extra}`;
}

function renderVerdict(comp, cache) {
  const sel = currentSelection(comp);
  const result = cache.get(comboKeyOf(comp, sel)) || { status: "valid", verdicts: [] };
  $("#verdict").className = "verdict " + result.status;
  $("#verdict").innerHTML = verdictHtml(result);
}

// ---------- 渲染：统计 + 全量组合表 ----------
function renderStats(comp, cache) {
  let v = 0, inv = 0, unt = 0;
  for (const r of cache.values()) {
    if (r.status === "valid") v++;
    else if (r.status === "invalid") inv++;
    else unt++;
  }
  $("#statsBar").innerHTML =
    `<span>组合总数 <b>${lastUpdateInfo.total}</b></span>` +
    `<span>有效 <b style="color:#1a7f37">${v}</b></span>` +
    `<span>被排除 <b style="color:#d83931">${inv}</b></span>` +
    `<span>不可信 <b style="color:#ad6800">${unt}</b></span>` +
    `<span>上次更新（${esc(lastUpdateInfo.reason)}）：重评 <b>${lastUpdateInfo.reevaluated}</b> / ${lastUpdateInfo.total} 组合</span>`;
}

function renderTable(comp, cache) {
  const combos = enumerateCombos(comp);
  const filter = state.filter;
  const sel = currentSelection(comp);
  const selKey = comboKeyOf(comp, sel);
  const rows = [];
  const MAX_ROWS = 800;
  let shown = 0, skipped = 0;
  for (const combo of combos) {
    const key = comboKeyOf(comp, combo);
    const r = cache.get(key);
    if (!r) continue;
    if (filter !== "all" && r.status !== filter) continue;
    if (shown >= MAX_ROWS) { skipped++; continue; }
    shown++;
    const cells = comp.dims.map((d) => `<td>${esc(combo[d.id])}</td>`).join("");
    const reasons = r.verdicts.map((v) => `<div>· ${esc(v.msg)}</div>`).join("");
    rows.push(`<tr class="${r.status === "untrusted" ? "untrusted" : ""}${key === selKey ? " sel" : ""}" data-key="${esc(key)}">
      ${cells}<td><span class="pill ${r.status}">${STATUS_TEXT[r.status]}</span></td>
      <td class="reasons">${reasons || "—"}</td></tr>`);
  }
  const head = comp.dims.map((d) => `<th>${esc(d.name)}</th>`).join("") + "<th>结论</th><th>判定依据</th>";
  const note = skipped ? `<div class="empty">已省略 ${skipped} 行（超出 ${MAX_ROWS} 行显示上限，请用筛选缩小范围）</div>` : "";
  $("#comboTable").innerHTML = rows.length
    ? `<table><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table>${note}`
    : `<div class="empty">没有符合筛选条件的组合</div>`;
}

// ---------- 总渲染 ----------
function renderAll(recompOpts) {
  const comp = activeComp();
  renderCompSelect();
  if (!comp) {
    $("#dimList").innerHTML = ""; $("#conList").innerHTML = "";
    $("#picker").innerHTML = ""; $("#verdict").innerHTML = "";
    $("#statsBar").innerHTML = ""; $("#comboTable").innerHTML = `<div class="empty">请先新建组件</div>`;
    return;
  }
  const { integrity, cache } = recompute(comp, recompOpts);
  renderDims(comp);
  fillRefSelects(comp);
  renderConstraints(comp, integrity);
  renderPicker(comp);
  renderVerdict(comp, cache);
  renderStats(comp, cache);
  renderTable(comp, cache);
  save();
}

// ---------- 事件 ----------
function bindEvents() {
  $("#compSelect").addEventListener("change", (e) => {
    state.activeId = e.target.value;
    renderAll({ reason: "切换组件" });
  });
  $("#btnAddComp").addEventListener("click", () => {
    const name = prompt("新组件名称：", "新组件");
    if (!name) return;
    const c = { id: uid(), name: name.trim(), dims: [], constraints: [] };
    state.components.push(c);
    state.activeId = c.id;
    renderAll({ reason: "新建组件" });
  });
  $("#btnRenameComp").addEventListener("click", () => {
    const c = activeComp(); if (!c) return;
    const name = prompt("组件名称：", c.name);
    if (name && name.trim()) { c.name = name.trim(); renderAll({ reason: "重命名组件" }); }
  });
  $("#btnDelComp").addEventListener("click", () => {
    const c = activeComp(); if (!c) return;
    if (!confirm(`确定删除组件「${c.name}」及其全部维度与约束？`)) return;
    state.components = state.components.filter((x) => x.id !== c.id);
    comboCache.delete(c.id);
    state.activeId = state.components[0] ? state.components[0].id : null;
    renderAll({ reason: "删除组件" });
  });

  $("#formAddDim").addEventListener("submit", (e) => {
    e.preventDefault();
    const comp = activeComp(); if (!comp) return;
    const name = $("#inpDimName").value.trim();
    if (!name) return;
    if (comp.dims.some((d) => d.name === name)) { toast("维度名已存在", "err"); return; }
    comp.dims.push({ id: uid(), name, values: [] });
    $("#inpDimName").value = "";
    renderAll({ reason: `新增维度「${name}」` });
  });

  // 维度面板：删除维度 / 删除取值 / 添加取值（事件委托）
  $("#dimList").addEventListener("click", (e) => {
    const comp = activeComp(); if (!comp) return;
    const btn = e.target.closest("button"); if (!btn) return;
    const dimEl = e.target.closest(".dim"); if (!dimEl) return;
    const dim = dimOf(comp, dimEl.dataset.dim); if (!dim) return;
    if (btn.dataset.act === "delDim") {
      if (!confirm(`删除维度「${dim.name}」？引用它的约束会被标记为引用失效。`)) return;
      comp.dims = comp.dims.filter((d) => d.id !== dim.id);
      renderAll({ full: true, reason: `删除维度「${dim.name}」` });
    } else if (btn.dataset.act === "delVal") {
      const val = btn.dataset.val;
      dim.values = dim.values.filter((v) => v !== val);
      renderAll({ reason: `移除取值「${dim.name}=${val}」` });
      toast(`已移除取值，引用它的约束若失效会标记为不可信`, "warn");
    }
  });
  $("#dimList").addEventListener("submit", (e) => {
    e.preventDefault();
    const comp = activeComp(); if (!comp) return;
    const form = e.target.closest(".valadd"); if (!form) return;
    const dim = dimOf(comp, form.dataset.dim); if (!dim) return;
    const inp = form.querySelector("input");
    const val = inp.value.trim();
    if (!val) return;
    if (dim.values.includes(val)) { toast("取值已存在", "err"); return; }
    dim.values.push(val);
    renderAll({ reason: `新增取值「${dim.name}=${val}」` });
  });

  // 约束表单：维度联动取值
  $("#selDimA").addEventListener("change", () => fillRefSelects(activeComp()));
  $("#selDimB").addEventListener("change", () => fillRefSelects(activeComp()));
  $("#formAddCon").addEventListener("submit", (e) => {
    e.preventDefault();
    const comp = activeComp(); if (!comp) return;
    if (comp.dims.length < 1) { toast("请先添加属性维度与取值", "err"); return; }
    const mk = (dimSel, valSel) => ({ dimId: $(dimSel).value, value: $(valSel).value });
    const a = mk("#selDimA", "#selValA"), b = mk("#selDimB", "#selValB");
    if (!a.dimId || !a.value || !b.dimId || !b.value) { toast("约束两端都需要有效取值", "err"); return; }
    if (a.dimId === b.dimId && a.value === b.value) { toast("约束两端不能是同一取值", "err"); return; }
    const type = $("#selConType").value;
    const dup = comp.constraints.some((c) => c.type === type &&
      ((c.a.dimId === a.dimId && c.a.value === a.value && c.b.dimId === b.dimId && c.b.value === b.value) ||
       (type === "mutex" && c.a.dimId === b.dimId && c.a.value === b.value && c.b.dimId === a.dimId && c.b.value === a.value)));
    if (dup) { toast("相同约束已存在", "err"); return; }
    const con = { id: uid(), type, a, b, ignored: false };
    comp.constraints.push(con);
    renderAll({ constraint: con, reason: "新增约束（增量重评）" });
    const integ = analyzeIntegrity(comp);
    if (integ.broken.has(con.id)) toast("新约束引用了不存在的取值", "warn");
    else if (integ.cycle.has(con.id)) toast("检测到依赖闭环，相关组合已标为不可信", "warn");
  });

  // 约束列表：裁决忽略 / 恢复 / 删除
  $("#conList").addEventListener("click", (e) => {
    const comp = activeComp(); if (!comp) return;
    const btn = e.target.closest("button"); if (!btn) return;
    const el = e.target.closest(".con"); if (!el) return;
    const con = comp.constraints.find((c) => c.id === el.dataset.con); if (!con) return;
    if (btn.dataset.act === "toggleCon") {
      con.ignored = !con.ignored;
      renderAll({ full: true, reason: con.ignored ? "裁决忽略约束" : "恢复约束" });
      toast(con.ignored ? "已忽略该约束，相关组合结论已收敛" : "已恢复该约束");
    } else if (btn.dataset.act === "delCon") {
      comp.constraints = comp.constraints.filter((c) => c.id !== con.id);
      renderAll({ full: true, reason: "删除约束" });
    }
  });

  // 组合选择器
  $("#picker").addEventListener("change", (e) => {
    const comp = activeComp(); if (!comp) return;
    const selEl = e.target.closest("select[data-pickdim]"); if (!selEl) return;
    const sel = currentSelection(comp);
    sel[selEl.dataset.pickdim] = selEl.value;
    renderAll({ reason: "切换组合" });
  });

  // 组合表：点击行 = 选中该组合
  $("#comboTable").addEventListener("click", (e) => {
    const comp = activeComp(); if (!comp) return;
    const tr = e.target.closest("tr[data-key]"); if (!tr) return;
    const vals = tr.dataset.key.split("\u0001");
    const sel = currentSelection(comp);
    comp.dims.forEach((d, i) => { sel[d.id] = vals[i]; });
    renderAll({ reason: "从表格选中组合" });
  });

  $("#selFilter").addEventListener("change", (e) => {
    state.filter = e.target.value;
    renderAll({ reason: "切换筛选" });
  });

  // 导入 / 导出
  $("#btnExport").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const aEl = document.createElement("a");
    aEl.href = URL.createObjectURL(blob);
    aEl.download = "variant-constraints.json";
    aEl.click();
    URL.revokeObjectURL(aEl.href);
  });
  $("#btnImport").addEventListener("click", () => $("#fileImport").click());
  $("#fileImport").addEventListener("change", (e) => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.components)) throw new Error("bad");
        state = data;
        if (!state.selection) state.selection = {};
        if (!state.filter) state.filter = "all";
        state.activeId = state.components[0] ? state.components[0].id : null;
        comboCache.clear();
        renderAll({ full: true, reason: "导入数据" });
        toast("导入成功");
      } catch (err) { toast("导入失败：文件格式不正确", "err"); }
    };
    reader.readAsText(f);
    e.target.value = "";
  });
}

// ---------- 启动 ----------
load();
bindEvents();
renderAll({ full: true, reason: "初始化" });
