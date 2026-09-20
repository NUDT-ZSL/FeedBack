"use strict";

const state = { data: null, selectedId: null };

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const STATUS_TEXT = {
  not_started: "未开始",
  in_progress: "进行中",
  digested: "已消化",
  conflict: "冲突待裁"
};

const KIND_TEXT = {
  read: "阅读推进",
  checkpoint: "位置核对",
  finish: "标记消化",
  note: "观点/备注"
};

const RELATION_TEXT = {
  citation: "引用",
  continuation: "续读",
  same_topic: "同主题"
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

function pct(material) {
  return Math.round((material.progress_ratio || 0) * 100);
}

function badge(status, text = STATUS_TEXT[status]) {
  return `<span class="badge ${escapeHtml(status)}">${escapeHtml(text)}</span>`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

function toast(message, isError = false) {
  const el = $("#toast");
  el.textContent = message;
  el.className = isError ? "toast error" : "toast";
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 3200);
}

async function loadState() {
  state.data = await api("/api/state");
  if (!state.selectedId || !state.data.materials.some(m => m.id === state.selectedId)) {
    state.selectedId = null;
  }
  render();
}

async function runAction(message, fn) {
  try {
    state.data = await fn();
    closeModal();
    render();
    toast(message);
  } catch (error) {
    toast(error.message, true);
  }
}

function render() {
  renderSummary();
  renderNext();
  renderMaterials();
  renderDetail();
  renderConflicts();
}

function renderSummary() {
  const materials = state.data.materials;
  const counts = materials.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  $("#stateSummary").textContent =
    `${materials.length} 份 · ${counts.conflict || 0} 待裁 · ` +
    `${counts.in_progress || 0} 进行中 · ${counts.digested || 0} 已消化`;
}

function renderNext() {
  const items = state.data.next_actions || [];
  if (!items.length) {
    $("#nextList").innerHTML = `<div class="muted">全部素材都已消化，或等待登记新素材。</div>`;
    return;
  }
  $("#nextList").innerHTML = items.slice(0, 5).map(item => `
    <div class="suggestion">
      ${badge(item.status)}
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <div class="muted">${escapeHtml(item.reason)}</div>
        ${item.digested_relations.length ?
          `<div class="muted">已有 ${item.digested_relations.length} 份关联素材完成，可先复用其结论</div>` : ""}
      </div>
      <button class="small" data-select="${escapeHtml(item.material_id)}">打开</button>
    </div>
  `).join("");
}

function renderMaterials() {
  const query = $("#searchInput").value.trim().toLowerCase();
  const filter = $("#statusFilter").value;
  const items = state.data.materials.filter(m => {
    const haystack = `${m.title} ${m.source} ${m.topic}`.toLowerCase();
    return (!query || haystack.includes(query)) && (!filter || m.status === filter);
  });
  $("#materialList").innerHTML = items.map(m => `
    <article class="material-card ${m.id === state.selectedId ? "active" : ""}"
      data-id="${escapeHtml(m.id)}">
      <div>
        <div class="material-title" data-select="${escapeHtml(m.id)}">
          ${escapeHtml(m.title)}
        </div>
        <div class="meta">
          <span>${escapeHtml(m.source || "无来源")}</span>
          <span>主题：${escapeHtml(m.topic || "未分类")}</span>
          <span>${m.progress_units}/${m.length_units}</span>
        </div>
      </div>
      <div>${badge(m.status)}</div>
      <div class="progress"><i style="width:${pct(m)}%"></i></div>
    </article>
  `).join("") || `<div class="muted">没有符合条件的素材。</div>`;
}

function renderConflicts() {
  const conflicts = state.data.conflicts || [];
  if (!conflicts.length) {
    $("#conflictList").innerHTML = `<div class="muted">当前没有进度冲突。</div>`;
    return;
  }
  $("#conflictList").innerHTML = conflicts.map(c => {
    const material = state.data.materials.find(m => m.id === c.material_id);
    const status = c.resolution ? `<span class="badge digested">已裁决</span>` : badge("conflict");
    return `
      <article class="conflict-card">
        <div>
          <strong>${escapeHtml(material?.title || c.material_id)}</strong>
          ${status}
          <p>${escapeHtml(c.description)}</p>
          <div class="muted">
            类型：${c.conflict_type === "position_regression" ? "进度回退" : "位置越界"}
            ${c.rationale ? ` · 裁决依据：${escapeHtml(c.rationale)}` : ""}
          </div>
        </div>
        <div class="conflict-actions">
          <button class="small" data-select="${escapeHtml(c.material_id)}">查看</button>
          ${c.resolution ?
            `<button class="small ghost" data-reopen-conflict="${escapeHtml(c.id)}">重新打开</button>`
            : renderConflictButtons(c)}
        </div>
      </article>`;
  }).join("");
}

function renderConflictButtons(conflict) {
  const id = escapeHtml(conflict.id);
  if (conflict.conflict_type === "position_regression") {
    return `
      <button class="small" data-resolve="${id}" data-resolution="reject_earlier">否定较早</button>
      <button class="small" data-resolve="${id}" data-resolution="reject_later">否定较晚</button>
      <button class="small ghost" data-resolve="${id}" data-resolution="accept_claims">采纳并存</button>`;
  }
  return `
    <button class="small" data-resolve="${id}" data-resolution="reject_event">排除误登记</button>
    <button class="small ghost" data-resolve="${id}" data-resolution="ignore">篇幅需修正</button>`;
}

function renderDetail() {
  const empty = $("#emptyDetail");
  const detail = $("#detail");
  const material = state.data.materials.find(m => m.id === state.selectedId);
  if (!material) {
    empty.hidden = false;
    detail.hidden = true;
    return;
  }
  empty.hidden = true;
  detail.hidden = false;
  const events = state.data.events
    .filter(e => e.material_id === material.id)
    .sort((a, b) => b.acted_at.localeCompare(a.acted_at) || b.id.localeCompare(a.id));
  const conflicts = state.data.conflicts.filter(c => c.material_id === material.id);
  detail.innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${escapeHtml(material.title)}</h2>
        <div class="meta">
          <span>${escapeHtml(material.source || "无来源")}</span>
          <span>主题：${escapeHtml(material.topic || "未分类")}</span>
        </div>
      </div>
      <div>
        ${badge(material.status)}
        <button class="small ghost" data-edit-material="${escapeHtml(material.id)}">编辑</button>
        <button class="small danger" data-delete-material="${escapeHtml(material.id)}">删除</button>
      </div>
    </div>
    <div class="stat-grid">
      <div class="stat"><span class="muted">篇幅</span><b>${material.length_units}</b></div>
      <div class="stat"><span class="muted">当前位置</span><b>${material.progress_units}</b></div>
      <div class="stat"><span class="muted">消化比例</span><b>${pct(material)}%</b></div>
    </div>
    ${renderBasis(material)}
    ${renderPropagation(material)}
    <section class="detail-section">
      <h3>阅读动作与观点
        <button class="small" data-new-event="${escapeHtml(material.id)}">登记动作</button>
      </h3>
      ${renderEvents(events, conflicts)}
    </section>
    <section class="detail-section">
      <h3>显式关联
        <button class="small" data-new-relation="${escapeHtml(material.id)}">新增关联</button>
      </h3>
      ${renderRelations(material)}
    </section>`;
}

function renderBasis(material) {
  const eventMap = new Map(state.data.events.map(e => [e.id, e]));
  const ids = material.basis_event_ids || [];
  if (!ids.length) {
    return `<section class="detail-section"><h3>结论依据</h3>
      <div class="muted">尚无有效推进动作。</div></section>`;
  }
  return `<section class="detail-section"><h3>结论依据（${ids.length} 条动作）</h3>
    <div class="basis-list">
      ${ids.map(id => {
        const event = eventMap.get(id);
        return `<span class="badge info">${escapeHtml(event ? KIND_TEXT[event.kind] : id)}
          · ${escapeHtml(event ? event.acted_at : id)}</span>`;
      }).join("")}
    </div></section>`;
}

function renderPropagation(material) {
  const related = material.propagated || [];
  const direct = related.filter(item => item.direct).slice(0, 8);
  return `<section class="detail-section">
    <h3>关联链可见推进
      <span class="muted">最高：${material.propagated_status ? STATUS_TEXT[material.propagated_status] : "无"}</span>
    </h3>
    ${direct.length ? direct.map(item => `
      <div class="chain">
        <button class="small ghost" data-select="${escapeHtml(item.material_id)}">
          ${escapeHtml(item.title)}
        </button>
        ${badge(item.status)} ${Math.round((item.progress_ratio || 0) * 100)}%
        <div>${item.path.map(edge =>
          edge.label ? `${RELATION_TEXT[edge.kind]}：${escapeHtml(edge.label)}`
                     : RELATION_TEXT[edge.kind]).join(" → ")}</div>
      </div>`).join("")
      : `<div class="muted">直接关联素材为空；新增引用、续读或相同主题后会自动连通。</div>`}
  </section>`;
}

function renderEvents(events, conflicts) {
  if (!events.length) return `<div class="muted">还没有动作记录。</div>`;
  const involved = new Set();
  conflicts.forEach(c => c.evidence.events?.forEach(id => involved.add(id)));
  return events.map(event => {
    const detail = event.kind === "read" ? `推进 ${event.delta_units}` :
      event.kind === "checkpoint" ? `位置 ${event.position}` :
      event.kind === "finish" ? "达到完整篇幅" : "仅记录观点，不推进位置";
    const excluded = !event.active || Boolean(event.rejected_by_conflict_id);
    return `<article class="event-row ${excluded ? "excluded" : ""}">
      <div class="event-head">
        <strong>${KIND_TEXT[event.kind]} · ${escapeHtml(event.acted_at)}</strong>
        ${involved.has(event.id) ? badge("conflict", "冲突证据") : ""}
      </div>
      <div>${escapeHtml(detail)}</div>
      ${event.note ? `<div>${escapeHtml(event.note)}</div>` : ""}
      ${!event.active ? `<div class="muted">已排除：${escapeHtml(event.excluded_reason)}</div>` : ""}
      ${event.rejected_by_conflict_id
        ? `<div class="muted">已由冲突裁决排除；重新打开冲突后才能恢复参与推演。</div>` : ""}
      <div class="event-actions">
        <button class="small ghost" data-edit-event="${escapeHtml(event.id)}">修正</button>
        ${event.active && !event.rejected_by_conflict_id
          ? `<button class="small ghost" data-exclude-event="${escapeHtml(event.id)}">排除</button>`
          : ""}
        ${!event.active
          ? `<button class="small ghost" data-restore-event="${escapeHtml(event.id)}">启用</button>`
          : ""}
      </div>
    </article>`;
  }).join("");
}

function renderRelations(material) {
  const relations = state.data.relations.filter(
    r => r.from_material_id === material.id || r.to_material_id === material.id
  );
  if (!relations.length) return `<div class="muted">暂无显式关系。</div>`;
  return relations.map(r => {
    const otherId = r.from_material_id === material.id ? r.to_material_id : r.from_material_id;
    const other = state.data.materials.find(m => m.id === otherId);
    const arrow = r.from_material_id === material.id ? "→" : "←";
    return `<div class="relation-row">
      <strong>${RELATION_TEXT[r.kind]}</strong> ${arrow}
      <button class="small ghost" data-select="${escapeHtml(otherId)}">
        ${escapeHtml(other?.title || otherId)}
      </button>
      ${r.label ? `<span class="muted">${escapeHtml(r.label)}</span>` : ""}
      <button class="small danger" data-delete-relation="${escapeHtml(r.id)}">删除</button>
    </div>`;
  }).join("");
}

function currentTimestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function openModal(title, fields, submitLabel, onSubmit) {
  $("#modalTitle").textContent = title;
  $("#modalSubmit").textContent = submitLabel;
  $("#modalBody").innerHTML = fields.map(field => {
    if (field.type === "select") {
      const options = field.options.map(([value, label]) =>
        `<option value="${escapeHtml(value)}" ${value === field.value ? "selected" : ""}>
          ${escapeHtml(label)}</option>`).join("");
      return `<label>${escapeHtml(field.label)}
        <select name="${escapeHtml(field.name)}" required="${field.required ? "true" : "false"}">
          ${options}</select></label>`;
    }
    return `<label class="${field.wide ? "wide" : ""}">${escapeHtml(field.label)}
      <${field.type === "textarea" ? "textarea" : "input"}
        name="${escapeHtml(field.name)}"
        type="${field.type === "textarea" ? "" : escapeHtml(field.type || "text")}"
        value="${field.type === "textarea" ? "" : escapeHtml(field.value || "")}"
        ${field.required ? "required" : ""}
        ${field.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : ""}
      >${field.type === "textarea" ? escapeHtml(field.value || "") : ""}
      </${field.type === "textarea" ? "textarea" : "input"}></label>`;
  }).join("");
  const form = $("#modalForm");
  form.className = fields.some(f => f.wide) ? "has-wide" : "";
  form.onclose = null;
  form.onsubmit = event => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const values = {};
    new FormData(form).forEach((value, key) => { values[key] = value; });
    onSubmit(values);
  };
  $("#modal").showModal();
}

function closeModal() { $("#modal").close(); }

function materialFields(material = {}) {
  return [
    { name: "title", label: "标题", value: material.title, required: true, wide: true },
    { name: "source", label: "来源", value: material.source, wide: true },
    { name: "length_units", label: "篇幅单位数", type: "number",
      value: material.length_units || 100, required: true },
    { name: "topic", label: "所属主题", value: material.topic }
  ];
}

function eventFields(event = {}) {
  return [
    { name: "kind", label: "动作类型", type: "select", value: event.kind || "read",
      options: [["read", "阅读推进（新增推进量）"], ["checkpoint", "位置核对（直接填当前位置）"],
                ["finish", "标记已消化"], ["note", "观点/备注（不改变位置）"]] },
    { name: "acted_at", label: "发生时间", type: "datetime-local",
      value: (event.acted_at || currentTimestamp()).slice(0, 19) },
    { name: "delta_units", label: "本次推进量（read 用）", type: "number",
      value: event.delta_units ?? 0 },
    { name: "position", label: "当前位置（checkpoint 用）", type: "number",
      value: event.position ?? "" },
    { name: "note", label: "观点 / 备注 / 修正原因", type: "textarea",
      value: event.note, wide: true }
  ];
}

document.addEventListener("click", async event => {
  const target = event.target.closest("button");
  if (!target) return;
  const data = target.dataset;

  if (data.select) {
    state.selectedId = data.select;
    renderDetail();
    renderMaterials();
  }
  if (target.id === "newMaterialBtn") {
    openModal("新增素材", materialFields(), "创建", values => runAction("素材已创建",
      () => api("/api/materials", { method: "POST", body: values })));
  }
  if (data.editMaterial) {
    const material = state.data.materials.find(m => m.id === data.editMaterial);
    openModal("编辑素材", materialFields(material), "保存", values => runAction("素材已更新",
      () => api(`/api/materials/${material.id}`, { method: "PATCH", body: values })));
  }
  if (data.deleteMaterial && confirm("删除素材会同时移除其本地关系和状态。确定继续？")) {
    await runAction("素材已删除",
      () => api(`/api/materials/${data.deleteMaterial}`, { method: "DELETE" }));
    state.selectedId = null;
  }
  if (data.newEvent) {
    openModal("登记阅读动作或观点", eventFields(), "登记", values => runAction("动作已登记",
      () => api(`/api/materials/${data.newEvent}/events`,
        { method: "POST", body: normalizeEvent(values) })));
  }
  if (data.editEvent) {
    const row = state.data.events.find(e => e.id === data.editEvent);
    openModal("修正阅读动作（原记录保留时间和裁决轨迹）", eventFields(row), "保存",
      values => runAction("动作已修正",
        () => api(`/api/events/${row.id}`,
          { method: "PATCH", body: normalizeEvent(values) })));
  }
  if (data.excludeEvent) {
    const reason = prompt("请填写排除原因；记录会保留但不再参与推演。", "误登记");
    if (reason) await runAction("动作已排除",
      () => api(`/api/events/active/${data.excludeEvent}`,
        { method: "PATCH", body: { active: false, reason } }));
  }
  if (data.restoreEvent) {
    await runAction("动作已重新启用",
      () => api(`/api/events/active/${data.restoreEvent}`,
        { method: "PATCH", body: { active: true } }));
  }
  if (data.deleteRelation && confirm("删除该关联后，将只重推关联链上的素材。确定？")) {
    await runAction("关联已删除",
      () => api(`/api/relations/${data.deleteRelation}`, { method: "DELETE" }));
  }
  if (data.newRelation) {
    const options = state.data.materials
      .filter(m => m.id !== data.newRelation)
      .map(m => [m.id, `${m.title}（${m.topic || "未分类"}）`]);
    openModal("新增显式关联", [
      { name: "from_material_id", label: "起点", type: "select",
        value: data.newRelation, options: [[data.newRelation, "当前素材"]] },
      { name: "to_material_id", label: "终点素材", type: "select",
        value: options[0]?.[0] || "", options },
      { name: "kind", label: "关系类型", type: "select", value: "continuation",
        options: [["citation", "引用"], ["continuation", "续读"],
                  ["same_topic", "同主题显式关系"]] },
      { name: "label", label: "关系说明", placeholder: "例如：第三章引用此文" }
    ], "建立关联", values => runAction("关联已建立，传播链已更新",
      () => api("/api/relations", { method: "POST", body: values })));
  }
  if (data.resolve) {
    const conflict = state.data.conflicts.find(c => c.id === data.resolve);
    const requireReason = data.resolution.startsWith("reject_");
    const rationale = prompt(requireReason
      ? "请填写裁决依据："
      : "可填写补充说明（可选）。", requireReason ? "" : "人工确认并存");
    if (rationale === null) return;
    if (requireReason && !rationale.trim()) {
      toast("排除记录必须填写裁决依据", true);
      return;
    }
    await runAction("冲突已裁决，素材结论已重推",
      () => api(`/api/conflicts/resolve/${conflict.id}`,
        { method: "POST", body: { resolution: data.resolution, rationale } }));
  }
  if (data.reopenConflict) {
    await runAction("冲突已重新打开",
      () => api(`/api/conflicts/reopen/${data.reopenConflict}`, { method: "POST" }));
  }
});

function normalizeEvent(values) {
  return {
    ...values,
    delta_units: values.delta_units === "" ? 0 : Number(values.delta_units),
    position: values.position === "" ? null : Number(values.position)
  };
}

$("#refreshBtn").addEventListener("click",
  () => loadState().catch(error => toast(error.message, true)));
$("#searchInput").addEventListener("input", renderMaterials);
$("#statusFilter").addEventListener("change", renderMaterials);

loadState().catch(error => toast(error.message, true));
