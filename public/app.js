let model = null;

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const fmt = value => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";

async function api(path, body) {
  const response = await fetch(path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) {
    const detail = payload.error?.details?.length
      ? "\n" + payload.error.details.map((item, index) => `${index + 1}. [${item.path}] ${item.message}${item.chain ? `；链条：${item.chain.join(" -> ")}` : ""}`).join("\n")
      : "";
    const error = new Error(`${payload.error?.message || "请求失败"}${detail}`);
    error.payload = payload;
    throw error;
  }
  if (payload.model) model = payload.model;
  render();
  return payload;
}

function toast(message, type = "success") {
  const node = $("#toast");
  node.textContent = message;
  node.className = `toast ${type}`;
  node.style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.style.display = "none"; }, type === "error" ? 7500 : 3200);
}

function options(items, valueKey, labelFn, selected = "") {
  return items.map(item => `<option value="${esc(item[valueKey])}" ${item[valueKey] === selected ? "selected" : ""}>${esc(labelFn(item))}</option>`).join("");
}

function setSelect(id, value) {
  const node = $(id);
  if (node) node.value = value;
}

function sourceId(name, fallback) {
  return name === "HR 主数据" ? "src-hr" : fallback;
}

function renderBase() {
  $("#version").textContent = model.version;
  $("#generatedAt").textContent = fmt(model.generatedAt);
  $("#roleMember").innerHTML = options(model.members, "id", m => `${m.name}（${m.id}）`, $("#roleMember").value);
  $("#scopeMember").innerHTML = options(model.members, "id", m => `${m.name}（${m.id}）`, $("#scopeMember").value);
  $("#openMember").innerHTML = options(model.members, "id", m => `${m.name}（${m.id}）`, $("#openMember").value);
  $("#roleValue").innerHTML = options(model.roles, "id", r => r.name, $("#roleValue").value);
  $("#scopeValue").innerHTML = options(model.scopes, "id", s => s.name, $("#scopeValue").value);
  $("#scopeDefId").innerHTML = options(model.scopes, "id", s => s.name, $("#scopeDefId").value);
  $("#openPage").innerHTML = options(model.pages, "id", p => p.name, $("#openPage").value);
  $("#newMemberRole").innerHTML = options(model.roles, "id", r => r.name, $("#newMemberRole").value);
  $("#newMemberScope").innerHTML = options(model.scopes, "id", s => s.name, $("#newMemberScope").value);
  $("#roleDefId").innerHTML = options(model.roles, "id", r => r.name, $("#roleDefId").value);
}

function renderMembers() {
  $("#members").innerHTML = model.members.map(member => {
    const access = member.access;
    const conflictClass = access.blockedByConflict ? "red" : "green";
    const label = access.blockedByConflict ? "授权冲突未决" : access.roleName;
    const scopeNames = access.scopeIds.map(id => model.scopes.find(s => s.id === id)?.name || id).join("、");
    return `<article class="member-card">
      <div class="member-head"><strong>${esc(member.name)}</strong><span class="pill ${conflictClass}">${esc(label)}</span></div>
      <p>唯一标识：${esc(member.id)} · 页面：${access.pages.map(id => esc(model.pages.find(p => p.id === id)?.name || id)).join("、") || "无"}</p>
      <p>有效范围闭包：${esc(scopeNames || "无")}</p>
      <ul class="claim-list">${member.claims.map(claim => `<li>${esc(claim.kind === "role" ? "角色" : "范围")}：${esc(claim.sourceName)} → ${esc(claim.valueId)}（${fmt(claim.updatedAt)}）</li>`).join("")}</ul>
    </article>`;
  }).join("");
}

function renderDefinitions() {
  $("#roles").innerHTML = model.roles.map(role => `<article class="definition"><dl>
    <dt>角色</dt><dd><strong>${esc(role.name)}</strong> <code>${esc(role.id)}</code></dd>
    <dt>页面</dt><dd>${role.pages.map(id => esc(model.pages.find(page => page.id === id)?.name || id)).join("、")}</dd>
    <dt>操作</dt><dd>${role.actions.map(id => esc(model.actions.find(action => action.id === id)?.name || id)).join("、")}</dd>
  </dl></article>`).join("");
  $("#scopes").innerHTML = model.scopes.map(scope => `<article class="definition"><dl>
    <dt>范围</dt><dd><strong>${esc(scope.name)}</strong> <code>${esc(scope.id)}</code></dd>
    <dt>直接包含</dt><dd>${scope.includes.map(id => `<code>${esc(id)}</code>`).join("、") || "无"}</dd>
    <dt>完整闭包</dt><dd>${scope.closure.map(id => esc(id)).join(" → ")}</dd>
  </dl></article>`).join("");
}

function renderSessions() {
  $("#sessions").innerHTML = model.sessions.map(session => {
    const snap = session.currentSnapshot;
    const pageName = model.pages.find(page => page.id === session.pageId)?.name || session.pageId;
    const invalidClass = session.invalidCount ? " invalid" : session.blockedOperationCount ? " affected" : "";
    const records = session.loadedRecords.map(item => `<div class="data-item ${item.status}">
      <strong>${esc(item.title)}</strong>
      <span class="pill ${item.status === "invalid" ? "red" : "green"}">${item.status === "invalid" ? "已失效" : "可访问"}</span>
      <p>范围：${esc(model.scopes.find(scope => scope.id === item.scopeId)?.name || item.scopeId)}</p>
      ${item.status === "invalid" ? `<div class="reason">拒绝依据：${esc(item.invalidReason)}</div><div class="basis">${esc(item.invalidBasis)}</div>` : ""}
      <div class="actions">
        ${model.actions.filter(action => action.pageId === session.pageId).map(action => `<button class="ghost" data-action="initiate" data-session="${esc(session.id)}" data-record="${esc(item.recordId)}" data-op="${esc(action.id)}" ${item.status === "invalid" || !snap.actions.includes(action.id) || snap.conflictIds?.length ? "disabled" : ""}>${esc(action.name)}</button>`).join("")}
      </div>
    </div>`).join("");
    const operations = session.operations.map(op => `<div class="operation ${op.status}">
      <strong>${esc(op.actionName)}</strong> · ${esc(op.recordTitle)}
      <p>证据：${esc(op.evidence)}</p><p>发起于版本 ${op.initiatedAtVersion} / 快照 ${op.initiatedSnapshotRevision}，当前：${esc(op.status)}</p>
      ${op.status === "blocked-pending" ? `<p class="reason">权限收窄后待处理：${esc(op.blockReason)}（版本 ${op.blockedAtVersion}）。证据未丢弃，也未当作生效。</p>` : ""}
      <div class="actions">
        <button data-action="confirm" data-opid="${esc(op.id)}" ${["blocked-pending", "confirmed", "canceled"].includes(op.status) ? "disabled" : ""}>确认提交</button>
        <button class="danger" data-action="cancel" data-opid="${esc(op.id)}">取消保留证据</button>
      </div>
    </div>`).join("");
    return `<article class="session-card${invalidClass}">
      <div class="session-top">
        <div><strong>${esc(session.title)}</strong><p>${esc(session.memberName)} · ${esc(pageName)} · 打开于 ${fmt(session.openedAt)}</p></div>
        <span class="pill ${session.invalidCount ? "red" : session.pendingOperationCount ? "amber" : "green"}">失效 ${session.invalidCount} · 待处理 ${session.pendingOperationCount}</span>
      </div>
      <div class="snapshot">
        <strong>当前快照修订 ${snap.revision}</strong><br>
        生效时刻：${fmt(snap.effectiveAt)}；当时/当前角色：${esc(snap.roleName)}；角色版本：${fmt(snap.roleVersion)}<br>
        页面：${snap.pages.map(id => esc(id)).join("、") || "无"}；范围闭包：${snap.scopeIds.map(id => esc(id)).join(" → ") || "无"}<br>
        收敛原因：${esc(snap.reason)}${snap.conflictIds?.length ? `；冲突：${snap.conflictIds.join(",")}` : ""}
      </div>
      <div class="record-grid">${records || "<p>此页面没有加载数据。</p>"}</div>
      ${operations}
      <details class="snapshot-history"><summary>查看全部快照历史（${session.snapshots.length}）</summary>${session.snapshots.map(s => `<p>R${s.revision} · ${fmt(s.effectiveAt)} · ${esc(s.roleName)} · ${esc(s.reason)}</p>`).join("")}</details>
    </article>`;
  }).join("") || "<p class='muted'>还没有打开页面。</p>";
}

function renderConflicts() {
  const conflicts = model.conflicts;
  $("#conflicts").innerHTML = conflicts.length ? conflicts.map(conflict => `<article class="conflict-card">
    <div class="member-head"><strong>${esc(conflict.summary)}</strong><span class="pill ${conflict.status === "open" ? "red" : "green"}">${conflict.status === "open" ? "未裁定" : conflict.status === "resolved" ? "已裁定" : "自动消解"}</span></div>
    <ul class="claim-list">${conflict.sources.map(source => `<li>成员 ${esc(conflict.memberName)}；来源 ${esc(source.sourceName)}；内容 ${esc(source.kindName || conflict.kindName)}=${esc(source.valueName)}（<code>${esc(source.valueId)}</code>）</li>`).join("")}</ul>
    ${conflict.status === "open" ? `<div class="actions">
      ${conflict.sources.map(source => `<button class="secondary" data-action="resolve" data-conflict="${esc(conflict.id)}" data-claim="${esc(source.claimId)}">裁定采用：${esc(source.sourceName)}</button>`).join("")}
    </div>` : ""}
  </article>`).join("") : "<p class='muted'>当前没有未解决冲突。所有来源仍在成员卡片中保留。</p>";
}

function renderEvents() {
  $("#events").innerHTML = model.events.map(event => `<article class="event-card">
    <strong>V${event.version} · ${esc(event.summary)}</strong> <span class="muted">${fmt(event.at)}</span>
    <ul>${event.affectedPages.length ? event.affectedPages.map(item => `<li>${esc(item.memberName)} 的「${esc(item.title)}」(${esc(item.pageId)}) 已生成新快照</li>`).join("") : "<li>没有页面的权限签名发生变化。</li>"}</ul>
  </article>`).join("");
}

function render() {
  if (!model) return;
  renderBase(); renderMembers(); renderSessions(); renderConflicts(); renderDefinitions(); renderEvents();
}

function selectedScopeDefinition() {
  const scope = model.scopes.find(item => item.id === $("#scopeDefId").value);
  return scope?.includes.join(",") ?? "";
}

function selectedRoleDefinition() {
  const role = model.roles.find(item => item.id === $("#roleDefId").value);
  return role ? { pages: role.pages.join(","), actions: role.actions.join(",") } : { pages: "", actions: "" };
}

$("#memberForm").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    await api("/api/members.add", {
      id: $("#newMemberId").value.trim(), name: $("#newMemberName").value.trim(),
      roleId: $("#newMemberRole").value, scopeId: $("#newMemberScope").value,
      sourceId: "admin-console", sourceName: "管理员登记"
    });
    toast("成员已登记；重复标识或非法角色会在此处被拒绝。");
  } catch (error) { toast(error.message, "error"); }
});

$("#roleForm").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    await api("/api/claims.add", {
      memberId: $("#roleMember").value, kind: "role", valueId: $("#roleValue").value,
      sourceId: sourceId($("#roleSource").value, "admin-console"), sourceName: $("#roleSource").value
    });
    toast("角色调整已生效；受影响页面已生成新快照。");
  } catch (error) { toast(error.message, "error"); }
});

$("#scopeForm").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    await api("/api/claims.add", {
      memberId: $("#scopeMember").value, kind: "scope", valueId: $("#scopeValue").value,
      sourceId: sourceId($("#scopeSource").value, "admin-console"), sourceName: $("#scopeSource").value
    });
    toast("授权范围已收敛；已加载数据的失效依据已显示。");
  } catch (error) { toast(error.message, "error"); }
});

$("#scopeDefId").addEventListener("change", () => { $("#scopeIncludes").value = selectedScopeDefinition(); });
$("#roleDefId").addEventListener("change", () => {
  const role = selectedRoleDefinition();
  $("#roleDefPages").value = role.pages;
  $("#roleDefActions").value = role.actions;
});
$("#scopeDefForm").addEventListener("submit", async event => {
  event.preventDefault();
  const scope = model.scopes.find(item => item.id === $("#scopeDefId").value);
  try {
    await api("/api/scopes.upsert", {
      id: scope.id, name: scope.name,
      includes: $("#scopeIncludes").value.split(",").map(item => item.trim()).filter(Boolean)
    });
    toast("范围继承关系已保存。");
  } catch (error) { toast(error.message, "error"); }
});

$("#roleDefForm").addEventListener("submit", async event => {
  event.preventDefault();
  const role = model.roles.find(item => item.id === $("#roleDefId").value);
  try {
    await api("/api/roles.upsert", {
      id: role.id, name: role.name,
      pages: $("#roleDefPages").value.split(",").map(item => item.trim()).filter(Boolean),
      actions: $("#roleDefActions").value.split(",").map(item => item.trim()).filter(Boolean)
    });
    toast("角色定义已保存，相关页面立即收敛。");
  } catch (error) { toast(error.message, "error"); }
});

$("#demoConflict").addEventListener("click", async () => {
  try {
    const member = model.members[0];
    const otherScope = model.scopes.find(scope => scope.id !== member.access.rootScopeId);
    await api("/api/claims.add", { memberId: member.id, kind: "scope", valueId: otherScope.id, sourceId: "src-audit", sourceName: "审计临时权限单" });
    toast("矛盾来源已保留，并生成冲突记录；未裁定前不会静默择一。");
  } catch (error) { toast(error.message, "error"); }
});

$("#openPageForm").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    await api("/api/sessions.open", { memberId: $("#openMember").value, pageId: $("#openPage").value, title: $("#pageTitle").value });
    $("#pageTitle").value = "";
    toast("页面已打开，并创建当前权限快照。");
  } catch (error) { toast(error.message, "error"); }
});

document.body.addEventListener("click", async event => {
  const trigger = event.target.closest("[data-action]");
  if (!trigger) return;
  try {
    const action = trigger.dataset.action;
    if (action === "initiate") await api("/api/operations.initiate", { sessionId: trigger.dataset.session, recordId: trigger.dataset.record, actionId: trigger.dataset.op });
    if (action === "confirm") await api("/api/operations.confirm", { operationId: trigger.dataset.opid });
    if (action === "cancel") await api("/api/operations.cancel", { operationId: trigger.dataset.opid });
    if (action === "resolve") await api("/api/conflicts.resolve", { conflictId: trigger.dataset.conflict, winningClaimId: trigger.dataset.claim, decidedBy: "管理员", note: "在工作台中人工裁定保留来源。" });
    toast(action === "confirm" ? "服务端按当前权限复核后，操作已生效。" : "操作已处理。");
  } catch (error) {
    if (error.payload?.error?.model) model = error.payload.error.model;
    render();
    toast(error.message, "error");
  }
});

function connect() {
  const events = new EventSource("/api/events");
  events.onmessage = event => {
    const payload = JSON.parse(event.data);
    if (payload.model) {
      model = payload.model;
      $("#connection").textContent = `实时连接正常 · 最近同步 ${fmt(model.generatedAt)}`;
      render();
      $("#scopeIncludes").value = selectedScopeDefinition();
    }
  };
  events.onerror = () => { $("#connection").textContent = "实时连接中断，正在重连…"; };
}

fetch("/api/state").then(response => response.json()).then(payload => {
  model = payload.model;
  render();
  $("#scopeIncludes").value = selectedScopeDefinition();
  const role = selectedRoleDefinition();
  $("#roleDefPages").value = role.pages;
  $("#roleDefActions").value = role.actions;
  connect();
}).catch(error => toast(`初始加载失败：${error.message}`, "error"));
