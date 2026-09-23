let STATE = null;
let selectedPara = null;

const OP_LABEL = { replace: "替换", delete: "删除", insert_after: "插入" };
const STATUS_LABEL = {
  pending: "待定", accepted: "已接受", rejected: "已拒绝", invalid: "已失效",
};

async function api(path, body) {
  const opts = body === undefined
    ? {}
    : { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body) };
  const res = await fetch(path, opts);
  return res.json();
}

async function refresh() {
  STATE = await api("/api/state");
  render();
}

async function decide(editId, action) {
  STATE = await api("/api/decision", { edit_id: editId, action });
  render();
}

async function submitOverride(pid) {
  const ta = document.getElementById("override-" + pid);
  STATE = await api("/api/override", { paragraph_id: pid, text: ta.value });
  render();
}

async function clearOverride(pid) {
  STATE = await api("/api/override/clear", { paragraph_id: pid });
  render();
}

async function resetSession() {
  STATE = await api("/api/reset", {});
  selectedPara = null;
  render();
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : s;
  return d.innerHTML;
}

function paraBadges(pid) {
  const g = STATE.groups[pid];
  if (!g) return "";
  const pend = g.edits.filter(e => e.status === "pending").length;
  let html = "";
  if (g.conflicts.length) html += '<span class="badge conflict">冲突</span>';
  if (pend) html += `<span class="badge pending">${pend} 待定</span>`;
  if (!pend && !g.conflicts.length) html += '<span class="badge done">已处理</span>';
  return html;
}

function renderTree() {
  const counts = {};
  function secHtml(sec) {
    let rows = sec.paragraphs.map(p => {
      const cls = p.id === selectedPara ? "para-row active" : "para-row";
      return `<div class="${cls}" onclick="selectPara('${p.id}')">` +
        `<span class="para-text">${esc(p.text)}</span>` +
        `<span>${paraBadges(p.id)}</span></div>`;
    }).join("");
    const kids = sec.children.map(secHtml).join("");
    return `<div><div class="sec-title">${esc(sec.title)}</div>${rows}` +
      `<div class="sec-children">${kids}</div></div>`;
  }
  document.getElementById("tree").innerHTML =
    STATE.document.sections.map(secHtml).join("");
}

function selectPara(pid) {
  selectedPara = pid === selectedPara ? null : pid;
  render();
}

function editCardHtml(e) {
  const st = `<span class="status-tag ${e.status}">${STATUS_LABEL[e.status]}</span>`;
  const dep = e.depends_on.length ? ` · 依赖 ${e.depends_on.join(", ")}` : "";
  let body = "";
  if (e.op !== "delete") body = `<div class="edit-content">${esc(e.content)}</div>`;
  let reason = "";
  if (e.status === "invalid" && e.reason) {
    reason = `<div class="invalid-reason">失效原因: ${esc(e.reason)}</div>`;
  }
  let actions = "";
  if (e.status === "pending") {
    actions = `<div class="edit-actions">` +
      `<button class="btn-accept" onclick="decide('${e.id}','accepted')">接受</button>` +
      `<button class="btn-reject" onclick="decide('${e.id}','rejected')">拒绝</button>` +
      `</div>`;
  }
  return `<div class="edit-card">` +
    `<div class="edit-meta">${esc(e.author)} · ${OP_LABEL[e.op]}${dep} · ${st}</div>` +
    (e.note ? `<div class="edit-meta">备注: ${esc(e.note)}</div>` : "") +
    body + reason + actions + `</div>`;
}

function groupHtml(g) {
  const pid = g.paragraph_id;
  const conflicted = g.conflicts.length ? "group conflicted" : "group";
  const conflicts = g.conflicts
    .map(c => `<div class="conflict-line">⚠ ${esc(c)}</div>`).join("");
  let merged;
  if (g.override != null) {
    merged = `<div class="merged-text">手动调整结果: ${esc(g.override)}</div>`;
  } else if (g.deleted) {
    merged = `<div class="merged-text deleted">合并结果: 本段将被删除</div>`;
  } else if (g.mergeable) {
    merged = `<div class="merged-text">合并结果: ${esc(g.merged_text)}</div>`;
  } else {
    merged = `<div class="merged-text deleted">存在冲突, 请逐条接受/拒绝或手动调整</div>`;
  }
  const edits = g.edits.map(editCardHtml).join("");
  const ov = g.override != null ? g.override : (g.merged_text || g.base_text);
  return `<div class="${conflicted}">` +
    `<h3>段落 ${pid}</h3>` +
    `<div class="base-text">原文: ${esc(g.base_text)}</div>` +
    conflicts + merged + edits +
    `<details><summary>手动调整本段</summary>` +
    `<textarea id="override-${pid}" class="override-box">${esc(ov)}</textarea>` +
    `<div class="edit-actions">` +
    `<button class="btn-adjust" onclick="submitOverride('${pid}')">应用调整</button>` +
    `<button class="btn-reject" onclick="clearOverride('${pid}')">清除调整</button>` +
    `</div></details></div>`;
}

function renderGroups() {
  let groups = Object.values(STATE.groups);
  if (selectedPara) groups = groups.filter(g => g.paragraph_id === selectedPara);
  const el = document.getElementById("groups");
  el.innerHTML = groups.length
    ? groups.map(groupHtml).join("")
    : '<div class="ok-line">当前没有待确认的改动。</div>';
}

function renderFinal() {
  function secHtml(sec) {
    const paras = sec.paragraphs
      .map(p => `<div class="final-para">${esc(p.text)}</div>`).join("");
    const kids = sec.children.map(secHtml).join("");
    return `<div class="final-sec">${esc(sec.title)}</div>${paras}${kids}`;
  }
  document.getElementById("final-doc").innerHTML =
    STATE.final_document.sections.map(secHtml).join("");
}

function renderUnresolved() {
  const u = STATE.unresolved;
  let html = "";
  if (!u.pending_edits.length && !u.conflict_paragraphs.length) {
    html = '<div class="ok-line">✓ 所有改动均已确认, 无遗留冲突。</div>';
  }
  for (const c of u.conflict_paragraphs) {
    html += `<div class="unresolved-item">⚠ 段落 ${c.paragraph_id}: ` +
      c.conflicts.map(esc).join("; ") + `</div>`;
  }
  for (const p of u.pending_edits) {
    html += `<div class="unresolved-item">· ${esc(p.author)} 对 ${p.target} 的改动仍待定</div>`;
  }
  document.getElementById("unresolved").innerHTML = html;
}

function renderSummary() {
  const counts = { pending: 0, accepted: 0, rejected: 0, invalid: 0 };
  for (const e of STATE.edits) counts[e.status]++;
  document.getElementById("summary").textContent =
    `待定 ${counts.pending} · 已接受 ${counts.accepted} · ` +
    `已拒绝 ${counts.rejected} · 已失效 ${counts.invalid}`;
  document.getElementById("doc-title").textContent =
    STATE.document.title + " — 协作编辑协调";
}

function render() {
  renderSummary();
  renderTree();
  renderGroups();
  renderFinal();
  renderUnresolved();
}

document.getElementById("btn-reset").addEventListener("click", resetSession);
refresh();
