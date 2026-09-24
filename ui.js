"use strict";
/* 界面渲染与交互。启动时直接渲染素材列表、规格面板、分配矩阵与结论表。 */

function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function strategyList(spec) {
  const out = [];
  if (spec.allowScale) out.push("缩放");
  if (spec.allowCrop) out.push("裁切");
  if (spec.allowRecompose) out.push("重新构图");
  return out.length ? out.join(" / ") : "（无）";
}

function renderAssets() {
  const tb = $("asset-table").querySelector("tbody");
  tb.innerHTML = state.assets.map(a =>
    "<tr><td>" + esc(a.name) + "</td><td>" + a.width + "×" + a.height + "</td><td>" +
    esc(a.purpose) + "</td><td>" + a.minReadableW + "×" + a.minReadableH + "</td><td>" +
    '<button data-act="edit-asset" data-id="' + a.id + '">编辑</button> ' +
    '<button data-act="del-asset" data-id="' + a.id + '">删除</button></td></tr>'
  ).join("");
}

function renderSpecs() {
  const tb = $("spec-table").querySelector("tbody");
  tb.innerHTML = state.specs.map(s =>
    "<tr><td>" + esc(s.name) + "</td><td>" + s.targetW + "×" + s.targetH + "</td><td>" +
    Math.round(s.safeMarginPct * 100) + "%</td><td>" + esc(strategyList(s)) + "</td><td>" +
    '<button data-act="edit-spec" data-id="' + s.id + '">编辑</button> ' +
    '<button data-act="del-spec" data-id="' + s.id + '">删除</button></td></tr>'
  ).join("");
}

function renderMatrix() {
  const box = $("matrix");
  if (!state.assets.length || !state.specs.length) {
    box.innerHTML = '<p class="hint">请先添加素材与规格。</p>';
    return;
  }
  let html = "<table><thead><tr><th>素材 \\ 规格</th>" +
    state.specs.map(s => "<th>" + esc(s.name) + "<br><span class='geo'>" +
      s.targetW + "×" + s.targetH + "</span></th>").join("") + "</tr></thead><tbody>";
  state.assets.forEach(a => {
    html += "<tr><th>" + esc(a.name) + "</th>";
    state.specs.forEach(s => {
      const on = state.assignments.some(x => x.assetId === a.id && x.specId === s.id);
      html += '<td><input type="checkbox" data-act="assign" data-asset="' + a.id +
        '" data-spec="' + s.id + '"' + (on ? " checked" : "") + "></td>";
    });
    html += "</tr>";
  });
  box.innerHTML = html + "</tbody></table>";
}

function checksCell(r) {
  if (!r.checks) return '<span class="geo">需人工处理</span>';
  const item = (label, c) =>
    "<div>" + label + "：" + (c.ok ? '<span class="ok">满足</span>' : '<span class="fail">不满足</span>') +
    ' <span class="geo">' + esc(c.detail) + "</span></div>";
  return item("安全边距", r.checks.safeMargin) + item("最小可读区", r.checks.minReadable);
}

function geometryCell(r) {
  const g = r.geometry;
  if (!g) return '<span class="geo">—</span>';
  let t = "缩放比 " + g.scaleFactor.toFixed(3) + "，输出 " + Math.round(g.outW) + "×" + Math.round(g.outH);
  if (g.cropX || g.cropY) t += "，裁切 横" + Math.round(g.cropX) + " / 纵" + Math.round(g.cropY) + "px";
  return '<span class="geo">' + esc(t) + "</span>";
}

function renderResults() {
  const rows = computeResults();
  const tb = $("result-table").querySelector("tbody");
  if (!rows.length) {
    tb.innerHTML = '<tr><td colspan="8" class="geo">尚未分配任何素材到规格。</td></tr>';
    return;
  }
  tb.innerHTML = rows.map(row => {
    const r = row.result;
    const conflict = r.conflicts.length > 0;
    const status = r.overridden
      ? '<span class="badge badge-override">手动覆盖</span>'
      : '<span class="badge badge-auto">自动推导</span>';
    const plan = '<span class="badge ' + (conflict ? "badge-warn" : "badge-ok") + '">' +
      esc(r.label) + "</span>" + (r.note ? '<div class="geo">' + esc(r.note) + "</div>" : "");
    const conflictCell = conflict
      ? r.conflicts.map(c => "<div>⚠ " + esc(c) + "</div>").join("")
      : '<span class="ok">无</span>';
    const ov = row.override ? row.override.strategy : "";
    const overrideCell =
      '<select data-act="override" data-asset="' + row.asset.id + '" data-spec="' + row.spec.id + '">' +
      '<option value="">自动</option>' +
      ["scale", "crop", "recompose"].map(v =>
        '<option value="' + v + '"' + (ov === v ? " selected" : "") + ">" +
        STRATEGY_LABELS[v] + "</option>").join("") +
      "</select>" +
      (row.override ? ' <button data-act="revert" data-asset="' + row.asset.id +
        '" data-spec="' + row.spec.id + '">恢复自动</button>' : "");
    return '<tr class="' + (conflict ? "conflict-row" : "") + '"><td>' + esc(row.asset.name) +
      "</td><td>" + esc(row.spec.name) + "<br><span class='geo'>" + row.spec.targetW + "×" +
      row.spec.targetH + "</span></td><td>" + plan + "</td><td>" + geometryCell(r) +
      "</td><td>" + checksCell(r) + "</td><td>" + conflictCell + "</td><td>" + status +
      "</td><td>" + overrideCell + "</td></tr>";
  }).join("");
}

function renderAll() {
  renderAssets();
  renderSpecs();
  renderMatrix();
  renderResults();
}

/* ---- 素材 / 规格表单 ---- */

function clearAssetForm() {
  $("asset-id").value = ""; $("asset-name").value = "";
  $("asset-w").value = ""; $("asset-h").value = "";
  $("asset-rw").value = ""; $("asset-rh").value = "";
  $("asset-purpose").selectedIndex = 0;
}
function fillAssetForm(a) {
  $("asset-id").value = a.id; $("asset-name").value = a.name;
  $("asset-w").value = a.width; $("asset-h").value = a.height;
  $("asset-rw").value = a.minReadableW; $("asset-rh").value = a.minReadableH;
  $("asset-purpose").value = a.purpose;
}
function clearSpecForm() {
  $("spec-id").value = ""; $("spec-name").value = "";
  $("spec-tw").value = ""; $("spec-th").value = ""; $("spec-margin").value = "";
  $("spec-allow-scale").checked = true;
  $("spec-allow-crop").checked = false;
  $("spec-allow-recompose").checked = false;
}
function fillSpecForm(s) {
  $("spec-id").value = s.id; $("spec-name").value = s.name;
  $("spec-tw").value = s.targetW; $("spec-th").value = s.targetH;
  $("spec-margin").value = Math.round(s.safeMarginPct * 1000) / 10;
  $("spec-allow-scale").checked = s.allowScale;
  $("spec-allow-crop").checked = s.allowCrop;
  $("spec-allow-recompose").checked = s.allowRecompose;
}

function wireEvents() {
  $("asset-form").addEventListener("submit", e => {
    e.preventDefault();
    upsertAsset({
      id: $("asset-id").value || null,
      name: $("asset-name").value.trim(),
      width: +$("asset-w").value, height: +$("asset-h").value,
      purpose: $("asset-purpose").value,
      minReadableW: +$("asset-rw").value, minReadableH: +$("asset-rh").value
    });
    clearAssetForm(); renderAll();
  });
  $("asset-cancel").addEventListener("click", clearAssetForm);

  $("spec-form").addEventListener("submit", e => {
    e.preventDefault();
    upsertSpec({
      id: $("spec-id").value || null,
      name: $("spec-name").value.trim(),
      targetW: +$("spec-tw").value, targetH: +$("spec-th").value,
      safeMarginPct: (+$("spec-margin").value) / 100,
      allowScale: $("spec-allow-scale").checked,
      allowCrop: $("spec-allow-crop").checked,
      allowRecompose: $("spec-allow-recompose").checked
    });
    clearSpecForm(); renderAll();
  });
  $("spec-cancel").addEventListener("click", clearSpecForm);

  $("btn-reset").addEventListener("click", () => {
    if (confirm("确定放弃当前全部修改并恢复示例数据？")) { resetState(); renderAll(); }
  });

  document.addEventListener("click", e => {
    const t = e.target;
    const act = t.dataset && t.dataset.act;
    if (act === "edit-asset") fillAssetForm(getAsset(t.dataset.id));
    else if (act === "del-asset") { deleteAsset(t.dataset.id); renderAll(); }
    else if (act === "edit-spec") fillSpecForm(getSpec(t.dataset.id));
    else if (act === "del-spec") { deleteSpec(t.dataset.id); renderAll(); }
    else if (act === "revert") { setOverride(t.dataset.asset, t.dataset.spec, null); renderAll(); }
  });
  document.addEventListener("change", e => {
    const t = e.target;
    const act = t.dataset && t.dataset.act;
    if (act === "assign") setAssignment(t.dataset.asset, t.dataset.spec, t.checked);
    else if (act === "override") setOverride(t.dataset.asset, t.dataset.spec, t.value || null);
    else return;
    renderAll();
  });
}

wireEvents();
renderAll();
