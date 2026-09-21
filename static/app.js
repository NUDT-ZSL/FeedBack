/* Frontend logic: talks to the local JSON API, renders tree / reading
   order / history, and surfaces conflict details on rejected changes. */
"use strict";

let STATE = null;

const $ = (id) => document.getElementById(id);

async function api(action, payload) {
  const res = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({ action }, payload || {})),
  });
  const body = await res.json();
  if (!body.ok) {
    if (body.conflict) {
      showConflict(body.conflict);
    } else {
      showConflict({ element_id: "", relation: "", reason: body.error });
    }
    return false;
  }
  hideConflict();
  await refresh();
  return true;
}

async function refresh() {
  const res = await fetch("/api/state");
  STATE = await res.json();
  renderAll();
}

function showConflict(c) {
  const box = $("conflict");
  const relMap = { parent: "父子归属关系", name: "可读名称", id: "元素标识",
                   history: "历史方案" };
  const rel = relMap[c.relation] || c.relation;
  box.textContent = "调整已被阻止 —— 冲突元素：" +
    (c.element_id || "（无）") + "，冲突关系：" + rel +
    "\n原因：" + c.reason + "\n语义树保持调整前的状态。";
  box.style.display = "block";
}

function hideConflict() { $("conflict").style.display = "none"; }

const ROLE_LIST = [
  "generic", "group", "region", "banner", "navigation", "main",
  "contentinfo", "complementary", "search", "form", "heading", "list",
  "listitem", "table", "dialog", "alert", "status", "img", "button",
  "link", "checkbox", "radio", "textbox", "searchbox", "combobox", "tab",
  "menuitem", "switch", "slider", "spinbutton", "option", "treeitem",
  "presentation", "none",
];

function fillRoleSelect(sel, current) {
  sel.innerHTML = "";
  for (const r of ROLE_LIST) {
    const opt = document.createElement("option");
    opt.value = r; opt.textContent = r;
    if (r === current) opt.selected = true;
    sel.appendChild(opt);
  }
}

function renderAll() {
  renderTree();
  renderReading();
  renderHistory();
  renderParentOptions();
}

function renderTree() {
  const host = $("tree");
  host.innerHTML = "";
  if (!STATE.root_order.length) {
    host.textContent = "（空树，请先录入元素）";
    return;
  }
  for (const rid of STATE.root_order) host.appendChild(renderNode(rid));
}

function renderNode(eid) {
  const el = STATE.elements[eid];
  const wrap = document.createElement("div");
  wrap.className = "tree-node";

  const row = document.createElement("div");
  row.className = "tree-row";

  const idSpan = document.createElement("span");
  idSpan.className = "eid"; idSpan.textContent = el.id;
  row.appendChild(idSpan);

  const roleSel = document.createElement("select");
  roleSel.className = "role";
  fillRoleSelect(roleSel, el.role);
  roleSel.onchange = () => api("set_role",
    { element_id: el.id, role: roleSel.value });
  row.appendChild(roleSel);

  const nameInput = document.createElement("input");
  nameInput.className = "nm" + (el.name ? "" : " empty");
  nameInput.value = el.name;
  nameInput.placeholder = "（无可读名称）";
  nameInput.onchange = () => api("set_name",
    { element_id: el.id, name: nameInput.value });
  row.appendChild(nameInput);

  const parentSel = document.createElement("select");
  parentSel.title = "父元素";
  parentSel.appendChild(new Option("（顶层）", ""));
  for (const oid of Object.keys(STATE.elements)) {
    if (oid === el.id) continue;
    const opt = new Option(oid, oid);
    if (el.parent_id === oid) opt.selected = true;
    parentSel.appendChild(opt);
  }
  parentSel.onchange = () => api("reparent",
    { element_id: el.id, new_parent_id: parentSel.value || null });
  row.appendChild(parentSel);

  const up = document.createElement("button");
  up.className = "small"; up.textContent = "↑"; up.title = "上移";
  up.onclick = () => moveBy(el, -1);
  const down = document.createElement("button");
  down.className = "small"; down.textContent = "↓"; down.title = "下移";
  down.onclick = () => moveBy(el, 1);
  const del = document.createElement("button");
  del.className = "small"; del.textContent = "删"; del.title = "删除（子元素上移一层）";
  del.onclick = () => { if (confirm("删除元素 " + el.id + "？"))
    api("remove", { element_id: el.id, promote_children: true }); };
  row.appendChild(up); row.appendChild(down); row.appendChild(del);

  wrap.appendChild(row);
  for (const cid of el.children) wrap.appendChild(renderNode(cid));
  return wrap;
}

function moveBy(el, delta) {
  const sibs = el.parent_id ? STATE.elements[el.parent_id].children
                            : STATE.root_order;
  const idx = sibs.indexOf(el.id);
  const target = idx + delta;
  if (target < 0 || target >= sibs.length) return;
  api("reorder", { element_id: el.id, index: target });
}

function renderReading() {
  const ol = $("reading");
  ol.innerHTML = "";
  if (!STATE.reading_order.length) {
    const li = document.createElement("li");
    li.textContent = "（没有会被朗读的元素）";
    ol.appendChild(li);
  }
  for (const el of STATE.reading_order) {
    const li = document.createElement("li");
    li.textContent = (el.name ? el.name + "  " : "") +
      "[" + el.role + "]  (" + el.id + ")";
    ol.appendChild(li);
  }
  const ul = $("skipped");
  ul.innerHTML = "";
  if (!STATE.skipped.length) {
    const li = document.createElement("li");
    li.textContent = "无";
    ul.appendChild(li);
  }
  for (const el of STATE.skipped) {
    const li = document.createElement("li");
    li.textContent = el.id + " [" + el.role + "] — " + el.skip_reason;
    ul.appendChild(li);
  }
}

function renderHistory() {
  const ul = $("history-list");
  ul.innerHTML = "";
  for (const h of STATE.history) {
    const li = document.createElement("li");
    if (h.active) li.className = "active";
    const idx = document.createElement("span");
    idx.className = "idx"; idx.textContent = "#" + h.index;
    const label = document.createElement("span");
    label.textContent = h.label;
    li.appendChild(idx); li.appendChild(label);
    li.onclick = () => api("switch", { index: h.index });
    ul.appendChild(li);
  }
}

function renderParentOptions() {
  const sel = $("f-parent");
  const keep = sel.value;
  sel.innerHTML = "";
  sel.appendChild(new Option("（顶层）", ""));
  for (const eid of Object.keys(STATE.elements)) {
    sel.appendChild(new Option(eid, eid));
  }
  sel.value = keep;
}

async function loadDemo() {
  await api("reset");
  const steps = [
    ["add", { id: "app", role: "main", name: "示例应用" }],
    ["add", { id: "nav", role: "navigation", name: "主导航",
              parent_id: "app" }],
    ["add", { id: "lnk-home", role: "link", name: "首页",
              parent_id: "nav" }],
    ["add", { id: "lnk-doc", role: "link", name: "文档",
              parent_id: "nav" }],
    ["add", { id: "content", role: "region", name: "内容区",
              parent_id: "app" }],
    ["add", { id: "h1", role: "heading", name: "欢迎使用",
              parent_id: "content" }],
    ["add", { id: "deco", role: "presentation", name: "",
              parent_id: "content" }],
    ["add", { id: "btn-ok", role: "button", name: "确定",
              parent_id: "content" }],
    ["add", { id: "btn-cancel", role: "button", name: "取消",
              parent_id: "content" }],
  ];
  for (const [action, payload] of steps) await api(action, payload);
}

window.addEventListener("DOMContentLoaded", async () => {
  fillRoleSelect($("f-role"), "generic");
  $("btn-add").onclick = () => api("add", {
    id: $("f-id").value.trim(),
    role: $("f-role").value,
    name: $("f-name").value,
    parent_id: $("f-parent").value || null,
  });
  $("btn-demo").onclick = loadDemo;
  $("btn-reset").onclick = () => { if (confirm("清空整棵树？")) api("reset"); };
  await refresh();
});
