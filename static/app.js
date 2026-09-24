// 素材适配工作台前端逻辑
let state = { assets: [], specs: [], assignments: [], results: [], strategyLabels: {} };

const $ = (id) => document.getElementById(id);

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error || "请求失败"); throw new Error(data.error); }
  state = data;
  render();
}

const esc = (s) => String(s).replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function renderAssets() {
  $("asset-rows").innerHTML = state.assets.map((a) => `
    <tr>
      <td>${esc(a.name)}</td>
      <td>${a.width} × ${a.height}</td>
      <td>${a.minReadable.width} × ${a.minReadable.height}</td>
      <td class="row-actions">
        <button onclick="editAsset('${a.id}')">编辑</button>
        <button onclick="delAsset('${a.id}')">删除</button>
      </td>
    </tr>`).join("");
}

function renderSpecs() {
  $("spec-rows").innerHTML = state.specs.map((s) => `
    <tr>
      <td>${esc(s.name)}</td>
      <td>${s.width} × ${s.height}</td>
      <td>${s.safeMargin}px</td>
      <td>${s.allowedStrategies.map((t) => state.strategyLabels[t] || t).join("/")}</td>
      <td class="row-actions">
        <button onclick="editSpec('${s.id}')">编辑</button>
        <button onclick="delSpec('${s.id}')">删除</button>
      </td>
    </tr>`).join("");
}

function renderAssignForm() {
  $("assign-asset").innerHTML = state.assets.map(
    (a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("");
  $("assign-spec").innerHTML = state.specs.map(
    (s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
}

function renderResults() {
  $("result-rows").innerHTML = state.results.map((r) => {
    const p = r.plan;
    const conflicts = p.conflicts.map(
      (c) => `<span class="badge conflict" title="${esc(c.message)}">${esc(c.message)}</span>`
    ).join("") || '<span class="badge ok">无冲突</span>';
    const notes = p.notes.map((n) => `<div class="notes">${esc(n)}</div>`).join("");
    const overrideBadge = p.isOverride
      ? '<span class="badge override">手动覆盖</span>'
      : '<span class="badge auto">自动</span>';
    const revertBtn = p.isOverride
      ? `<button onclick="setOverride('${r.assetId}','${r.specId}',null)">撤销覆盖</button>` : "";
    const options = ["scale", "crop", "recompose"].map((t) =>
      `<option value="${t}" ${r.override === t ? "selected" : ""}>${state.strategyLabels[t]}</option>`
    ).join("");
    return `
    <tr class="${p.conflicts.length ? "has-conflict" : ""}">
      <td>${esc(r.assetName)}</td>
      <td>${esc(r.specName)}</td>
      <td><span class="strategy-${p.strategy}">${state.strategyLabels[p.strategy]}</span>${notes}</td>
      <td>${p.scale}×</td>
      <td>${conflicts}</td>
      <td>${overrideBadge}
        <select onchange="setOverride('${r.assetId}','${r.specId}',this.value)">
          <option value="">覆盖为…</option>${options}
        </select> ${revertBtn}</td>
      <td class="row-actions">
        <button onclick="unassign('${r.assetId}','${r.specId}')">移除</button>
      </td>
    </tr>`;
  }).join("");
}

function render() {
  renderAssets();
  renderSpecs();
  renderAssignForm();
  renderResults();
}

// ---- 素材表单 ----
function editAsset(id) {
  const a = state.assets.find((x) => x.id === id);
  if (!a) return;
  $("asset-form-title").textContent = "编辑素材";
  $("asset-id").value = a.id;
  $("asset-name").value = a.name;
  $("asset-w").value = a.width;
  $("asset-h").value = a.height;
  $("asset-mrw").value = a.minReadable.width;
  $("asset-mrh").value = a.minReadable.height;
}
function resetAssetForm() {
  $("asset-form-title").textContent = "新增素材";
  $("asset-id").value = "";
  $("asset-form").reset();
}
function delAsset(id) {
  if (confirm("删除该素材及其全部分配?")) api("DELETE", "/api/assets/" + id);
}
$("asset-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("asset-id").value;
  const body = {
    name: $("asset-name").value, width: $("asset-w").value, height: $("asset-h").value,
    mrWidth: $("asset-mrw").value || 0, mrHeight: $("asset-mrh").value || 0,
  };
  api(id ? "PUT" : "POST", "/api/assets" + (id ? "/" + id : ""), body)
    .then(resetAssetForm);
});
$("asset-cancel").addEventListener("click", resetAssetForm);

// ---- 规格表单 ----
function editSpec(id) {
  const s = state.specs.find((x) => x.id === id);
  if (!s) return;
  $("spec-form-title").textContent = "编辑规格";
  $("spec-id").value = s.id;
  $("spec-name").value = s.name;
  $("spec-w").value = s.width;
  $("spec-h").value = s.height;
  $("spec-margin").value = s.safeMargin;
  document.querySelectorAll('input[name="spec-strategy"]').forEach((cb) => {
    cb.checked = s.allowedStrategies.includes(cb.value);
  });
}
function resetSpecForm() {
  $("spec-form-title").textContent = "新增规格";
  $("spec-id").value = "";
  $("spec-form").reset();
}
function delSpec(id) {
  if (confirm("删除该规格及其全部分配?")) api("DELETE", "/api/specs/" + id);
}
$("spec-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("spec-id").value;
  const allowed = [...document.querySelectorAll('input[name="spec-strategy"]:checked')]
    .map((cb) => cb.value);
  if (!allowed.length) { alert("至少保留一种允许策略"); return; }
  const body = {
    name: $("spec-name").value, width: $("spec-w").value, height: $("spec-h").value,
    safeMargin: $("spec-margin").value || 0, allowedStrategies: allowed,
  };
  api(id ? "PUT" : "POST", "/api/specs" + (id ? "/" + id : ""), body)
    .then(resetSpecForm);
});
$("spec-cancel").addEventListener("click", resetSpecForm);

// ---- 分配与覆盖 ----
$("assign-form").addEventListener("submit", (e) => {
  e.preventDefault();
  api("POST", "/api/assignments", {
    assetId: $("assign-asset").value, specId: $("assign-spec").value,
  });
});
function unassign(assetId, specId) {
  api("DELETE", `/api/assignments/${assetId}/${specId}`);
}
function setOverride(assetId, specId, strategy) {
  api("PUT", `/api/assignments/${assetId}/${specId}/override`, { strategy });
}

// ---- 启动: 直接拉取状态并渲染素材列表与规格面板 ----
api("GET", "/api/state");
