let state = null;
let lastAffected = new Set();
let lastReason = "";

const $ = (selector) => document.querySelector(selector);
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

async function callApi(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    const error = payload.error ?? { message: "请求失败" };
    showToast(formatError(error), "error");
    throw error;
  }
  state = payload.state;
  render();
  showToast(payload.result?.event?.type
    ? `${payload.result.event.type}：受影响 ${payload.result.affectedPageIds?.length ?? 0} 个页面`
    : "操作成功", "success");
  return payload;
}

function formatError(error) {
  const details = error.details ?? {};
  const lines = [`拒绝位置：${details.location ?? "请求"}`, `原因：${error.message}`];
  if (details.chains?.length) lines.push(`涉及链条：${details.chains.join(" / ")}`);
  if (details.allowedActions) lines.push(`允许操作：${details.allowedActions.join(", ")}`);
  return lines.join("\n");
}

function showToast(message, type) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast ${type}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.className = "toast"; }, 5200);
}

function sourceLabel(source) {
  return source ? `${source.label}（${source.type}:${source.id ?? ""}）` : "未知来源";
}

function memberRoleEntries(memberId) {
  return state.assignments.filter((item) => item.memberId === memberId);
}

function roleName(roleId) {
  return state.roles[roleId]?.name ?? roleId;
}

function scopeName(scopeId) {
  return state.scopes[scopeId]?.name ?? scopeId;
}

function scopeChip(scopeId, kind = "") {
  return `<span class="badge ${kind}" title="${escape(scopeName(scopeId))}">${escape(scopeId)}</span>`;
}

function renderMembers() {
  $("#members").innerHTML = state.members.map((member) => {
    const entries = memberRoleEntries(member.id);
    const roleIds = [...new Set(entries.map((item) => item.roleId))];
    const conflict = state.conflicts.some((item) => item.memberId === member.id);
    const status = conflict ? "冲突冻结" : roleIds.map(roleName).join(", ");
    return `<article class="member-card">
      <h3>${escape(member.name)} <span class="badge ${conflict ? "red" : "green"}">${escape(status)}</span></h3>
      <div class="meta">唯一标识：${escape(member.id)}</div>
      ${entries.map((entry) => `<div class="source-line">
        <strong>${escape(sourceLabel(entry.source))}</strong><br>
        ${escape(entry.content)}
      </div>`).join("")}
    </article>`;
  }).join("");
}

function renderConflicts() {
  if (!state.conflicts.length) {
    $("#conflicts").innerHTML = `<div class="banner muted">当前没有冲突；角色或范围来源矛盾时会在此保留双方。</div>`;
    return;
  }
  $("#conflicts").innerHTML = state.conflicts.map((conflict) => `<article class="conflict-card">
    <h3>${conflict.type === "role_conflict" ? "角色冲突" : "授权范围冲突"} · ${escape(conflict.id)}</h3>
    <p>${escape(conflict.message)}</p>
    <div class="meta">成员：<strong>${escape(conflict.memberId)}</strong>
    ${conflict.scopeId ? ` · 范围：<strong>${escape(scopeName(conflict.scopeId))}</strong>` : ""}
    </div>
    ${conflict.sources.map((item) => `<div class="source-line">
      <strong>来源：${escape(sourceLabel(item.source))}</strong><br>
      内容：${escape(item.content)}
      <br><button class="small success" data-conflict-id="${escape(conflict.id)}"
        data-source-type="${escape(item.source.type)}" data-source-id="${escape(item.source.id ?? "")}">
        人工保留此来源并解除冲突
      </button>
    </div>`).join("")}
  </article>`).join("");
  document.querySelectorAll("[data-conflict-id]").forEach((button) => {
    button.addEventListener("click", () => callApi("/api/conflicts/resolve", {
      conflictId: button.dataset.conflictId,
      source: { type: button.dataset.sourceType, id: button.dataset.sourceId }
    }));
  });
}

function snapshotHtml(page) {
  const snapshot = page.snapshot;
  const role = snapshot.role ? `${snapshot.role.name}（${snapshot.roleId}）` : "无唯一生效角色";
  return `<div class="snapshot-box">
    <div><strong>当前快照：</strong>${escape(snapshot.id)}</div>
    <div class="meta">生效时刻：${escape(snapshot.effectAt ?? snapshot.effectiveAt)} · 策略版本 v${snapshot.policyVersion} · 状态：${escape(snapshot.status)}</div>
    <div class="meta">当时角色：${escape(role)}</div>
    <div>页面：${snapshot.pages.map((pageId) => `<span class="badge blue">${escape(state.pages[pageId].name)}</span>`).join("") || `<span class="badge red">无页面</span>`}</div>
    <div>可访问：${snapshot.accessibleScopes.map((id) => scopeChip(id, "green")).join("") || "无"}</div>
    <div>拒绝：${snapshot.deniedScopes.map((id) => scopeChip(id, "red")).join("") || "无"}
      冻结：${snapshot.contestedScopes.map((id) => scopeChip(id, "amber")).join("") || "无"}</div>
    <details><summary class="meta">快照追溯链（${page.snapshotHistory.length}）</summary>
      ${page.snapshotHistory.map((entry) => `<div class="meta">
        ${escape(entry.replacedAt)}：${escape(entry.previousSnapshotId ?? "打开页面")}
        (${escape(entry.previousRoleId ?? "无")}) → ${escape(entry.nextSnapshotId)}
      </div>`).join("")}
    </details>
  </div>`;
}

function renderItems(page) {
  const invalidMap = new Map(page.invalidations.map((item) => [item.itemId, item]));
  const actions = state.pages[page.page].actions;
  return page.loadedItems.map((item) => {
    const invalid = invalidMap.get(item.id);
    const basis = page.snapshot.scopeBasis?.[item.scopeId] ?? [];
    return `<div class="item-row ${invalid ? "invalid" : ""}">
      <div>
        <div class="item-title"><strong>${escape(item.id)}</strong> · ${escape(item.title)}
          ${scopeChip(item.scopeId, invalid ? "red" : "green")}
        </div>
        ${invalid
          ? `<div class="meta">已失效：${escape(invalid.code)}<br>依据：${escape(invalid.basis)}<br>发现于：${escape(invalid.detectedAt)}，禁止继续提交；数据仍保留。</div>`
          : `<div class="meta">已加载于 ${escape(item.loadedAt)}，金额 ¥${item.amount}</div>`}
      </div>
      <div class="item-actions">
        ${invalid ? `<span class="badge red">不可提交</span>` : actions.map((action) => {
          const allowed = basis.some((entry) => entry.grant === `${page.page}.${action}`);
          return `<button class="small ${allowed ? "" : "secondary"}"
            data-op-page="${escape(page.id)}" data-item="${escape(item.id)}"
            data-action="${escape(action)}" ${allowed ? "" : "disabled"}>
            ${escape(action)}
          </button>`;
        }).join("")}
      </div>
    </div>`;
  }).join("") || `<div class="meta">尚未加载数据。</div>`;
}

const OPERATION_LABELS = {
  awaiting_confirmation: "待确认",
  pending_review: "收窄后待人工处理",
  confirmed: "已确认生效",
  retried_under_new_snapshot: "已按新快照重试",
  rejected: "已拒绝",
  discarded: "已丢弃"
};

function renderOperations(page) {
  return page.operations.map((op) => `<div class="operation ${escape(op.status)}">
    <strong>${escape(op.itemId)}</strong> · ${escape(op.action)}
    <span class="badge ${op.status === "pending_review" ? "amber" : op.status === "confirmed" ? "green" : "blue"}">
      ${escape(OPERATION_LABELS[op.status] ?? op.status)}
    </span>
    <div class="meta">${escape(op.itemTitle)} · 范围 ${escape(op.scopeId)} · 创建 ${escape(op.createdAt)}</div>
    ${op.blockReason ? `<div class="meta"><strong>阻断依据：</strong>${escape(op.blockReason)} · ${escape(op.blockedAt)}</div>` : ""}
    <details><summary class="meta">保留的原始操作证据</summary>
      <pre class="meta">${escape(JSON.stringify(op.evidence, null, 2))}</pre>
      ${op.reviewerNote ? `<div class="meta">人工说明：${escape(op.reviewerNote)}</div>` : ""}
    </details>
    ${op.status === "awaiting_confirmation" ? `<button class="small success" data-confirm-page="${escape(page.id)}" data-op="${escape(op.id)}">确认生效</button>` : ""}
    ${op.status === "pending_review" ? `
      <button class="small success" data-review-page="${escape(page.id)}" data-op="${escape(op.id)}" data-decision="retry">按新权限重试</button>
      <button class="small danger" data-review-page="${escape(page.id)}" data-op="${escape(op.id)}" data-decision="reject">拒绝</button>
      <button class="small secondary" data-review-page="${escape(page.id)}" data-op="${escape(op.id)}" data-decision="discard">丢弃证据</button>
    ` : ""}
  </div>`).join("") || `<div class="meta">暂无操作。</div>`;
}

function renderPages() {
  if (!state.pageSessions.length) {
    $("#pages").innerHTML = `<div class="banner muted">还没有打开的页面。</div>`;
    return;
  }
  $("#pages").innerHTML = state.pageSessions.map((page) => {
    const affected = lastAffected.has(page.id);
    const revoked = page.snapshot.status !== "active" || !page.snapshot.pages.includes(page.page);
    return `<article class="page-card ${affected ? "affected" : ""} ${revoked ? "revoked" : ""}">
      <h3>${escape(page.label)}
        ${affected ? `<span class="badge amber">本次受影响</span>` : `<span class="badge green">未受影响，快照未切换</span>`}
        ${revoked ? `<span class="badge red">页面入口失效</span>` : ""}
      </h3>
      <div class="meta">页面会话：${escape(page.id)} · 成员：${escape(page.memberId)} · 打开于：${escape(page.openedAt)}</div>
      ${snapshotHtml(page)}
      <h4>已加载数据（失效不清空）</h4>
      ${renderItems(page)}
      <button class="small secondary" data-load-page="${escape(page.id)}" ${revoked ? "disabled" : ""}>重新检查并加载新数据</button>
      <h4>操作队列与待处理证据</h4>
      ${renderOperations(page)}
    </article>`;
  }).join("");
  bindPageButtons();
}

function bindPageButtons() {
  document.querySelectorAll("[data-op-page]").forEach((button) => {
    button.addEventListener("click", () => callApi("/api/operations/start", {
      pageId: button.dataset.opPage,
      itemId: button.dataset.item,
      action: button.dataset.action,
      form: { note: `界面在 ${new Date().toISOString()} 发起` }
    }));
  });
  document.querySelectorAll("[data-confirm-page]").forEach((button) => {
    button.addEventListener("click", () => callApi("/api/operations/confirm", {
      pageId: button.dataset.confirmPage,
      operationId: button.dataset.op
    }));
  });
  document.querySelectorAll("[data-review-page]").forEach((button) => {
    button.addEventListener("click", () => callApi("/api/operations/resolve-pending", {
      pageId: button.dataset.reviewPage,
      operationId: button.dataset.op,
      decision: button.dataset.decision,
      note: `管理员在界面选择 ${button.dataset.decision}`
    }));
  });
  document.querySelectorAll("[data-load-page]").forEach((button) => {
    button.addEventListener("click", () => callApi("/api/pages/load", { pageId: button.dataset.loadPage }));
  });
}

function renderDefinitions() {
  $("#roleDefinitions").innerHTML = Object.values(state.roles).map((role) => `<article class="role-card">
    <h3>${escape(role.name)} <span class="badge">${escape(role.id)}</span></h3>
    ${role.grants.map((grant) => `<div class="meta">
      ${escape(state.pages[grant.page].name)} · <strong>${escape(grant.action)}</strong>
      @ ${scopeChip(grant.scopeId, "blue")}
    </div>`).join("")}
  </article>`).join("");
  $("#scopeGraph").innerHTML = state.edges.map((edge) =>
    `<div class="edge-line">${escape(scopeName(edge.parent))} (${escape(edge.parent)})
      → ${escape(scopeName(edge.child))} (${escape(edge.child)})</div>`).join("");
}

function fillSelects() {
  const members = state.members.map((member) =>
    `<option value="${escape(member.id)}">${escape(member.name)}（${escape(member.id)}）</option>`).join("");
  const roles = Object.values(state.roles).map((role) =>
    `<option value="${escape(role.id)}">${escape(role.name)}（${escape(role.id)}）</option>`).join("");
  const pages = Object.values(state.pages).map((page) =>
    `<option value="${escape(page.id)}">${escape(page.name)}（${escape(page.id)}）</option>`).join("");
  const scopes = Object.values(state.scopes).map((scope) =>
    `<option value="${escape(scope.id)}">${escape(scope.name)}（${escape(scope.id)}）</option>`).join("");
  for (const id of ["roleMember", "pageMember", "directiveMember"]) $(`#${id}`).innerHTML = members;
  $("#roleSelect").innerHTML = roles;
  $("#newMemberRole").innerHTML = roles;
  $("#pageSelect").innerHTML = pages;
  $("#directiveScope").innerHTML = scopes;
  $("#edgeParent").innerHTML = scopes;
  $("#edgeChild").innerHTML = scopes;
  $("#edgeParent").value = "eu";
  $("#edgeChild").value = "root";
}

function render() {
  fillSelects();
  $("#policyVersion").textContent = `策略版本 v${state.policyVersion}`;
  const latest = state.events[0];
  if (latest) {
    const banner = $("#eventBanner");
    banner.textContent = `${latest.at} · ${latest.type} · 受影响页面：${latest.affectedPageIds?.length ?? 0} 个`;
    banner.className = latest.type.includes("reconciled") ? "banner" : "banner muted";
  }
  renderMembers();
  renderConflicts();
  renderPages();
  renderDefinitions();
}

async function quickScenario(name) {
  try {
    if (name === "narrowAlice") {
      await callApi("/api/members/role", { memberId: "alice", roleId: "viewer" });
    } else if (name === "restoreAlice") {
      await callApi("/api/members/role", { memberId: "alice", roleId: "hr_operator" });
    } else if (name === "injectConflict") {
      await callApi("/api/roles/source", {
        memberId: "dave",
        roleId: "finance_auditor",
        source: { type: "hris", id: "hr-sync", label: "HR 同步系统" },
        content: "HR 同步系统：Dave=财务复核"
      });
      await callApi("/api/scopes/directive", {
        memberId: "dave",
        scopeId: "eu",
        effect: "allow",
        source: { type: "contract", id: "contract-7", label: "合同授权系统" },
        content: "合同授权系统：allow eu（合同 7）"
      });
      await callApi("/api/scopes/directive", {
        memberId: "dave",
        scopeId: "eu",
        effect: "deny",
        source: { type: "risk", id: "risk-9", label: "外部风控系统" },
        content: "外部风控系统：deny eu（风险策略 9）"
      });
    } else if (name === "duplicate") {
      await callApi("/api/members/add", { memberId: "alice", name: "重复 Alice", roleId: "viewer" });
    } else if (name === "unknownRole") {
      await callApi("/api/members/add", { memberId: "erin", name: "Erin", roleId: "not_registered" });
    } else if (name === "cycle") {
      await callApi("/api/scopes/edge", { parent: "eu", child: "root" });
    } else if (name === "missingScope") {
      await callApi("/api/roles/create", {
        roleId: "bad_role",
        name: "引用坏范围",
        grants: [{ page: "orders", action: "view", scopeId: "moon_base" }]
      });
    }
  } catch {
    // 拒绝原因已经由 callApi 展示
  }
}

function bindControls() {
  $("#changeRole").addEventListener("click", () => callApi("/api/members/role", {
    memberId: $("#roleMember").value,
    roleId: $("#roleSelect").value
  }));
  $("#openPage").addEventListener("click", () => callApi("/api/pages/open", {
    memberId: $("#pageMember").value,
    page: $("#pageSelect").value
  }));
  $("#addEdge").addEventListener("click", () => callApi("/api/scopes/edge", {
    parent: $("#edgeParent").value,
    child: $("#edgeChild").value
  }));
  $("#addDirective").addEventListener("click", () => callApi("/api/scopes/directive", {
    memberId: $("#directiveMember").value,
    scopeId: $("#directiveScope").value,
    effect: $("#directiveEffect").value,
    source: { type: "manual-directive", id: crypto.randomUUID(), label: $("#directiveSource").value || "范围来源" }
  }));
  $("#addMember").addEventListener("click", () => callApi("/api/members/add", {
    memberId: $("#newMemberId").value,
    name: $("#newMemberName").value,
    roleId: $("#newMemberRole").value
  }));
  $("#createRole").addEventListener("click", () => callApi("/api/roles/create", {
    roleId: $("#newRoleId").value,
    name: $("#newRoleName").value,
    grants: $("#newRoleGrants").value.split("\n").filter(Boolean).map((line) => {
      const [page, action, scopeId] = line.split(",").map((part) => part.trim());
      return { page, action, scopeId };
    })
  }));
  document.querySelectorAll("[data-quick]").forEach((button) =>
    button.addEventListener("click", () => quickScenario(button.dataset.quick)));
}

const source = new EventSource("/api/events");
source.addEventListener("snapshot", (event) => {
  state = JSON.parse(event.data);
  render();
});
source.addEventListener("policy", (event) => {
  const payload = JSON.parse(event.data);
  state = payload.state;
  lastAffected = new Set(payload.event.affectedPageIds ?? []);
  lastReason = payload.event.reason ?? payload.event.type;
  render();
  if (payload.event.affectedPageIds?.length) {
    showToast(`${lastReason}\n已收敛页面：${payload.event.affectedPageIds.join(", ")}`, "success");
  }
});
bindControls();
