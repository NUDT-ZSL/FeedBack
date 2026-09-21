/* 经验条目关联管理前端 */
let STATE = null;
let selectedId = null;

const RELATION_NAMES = { related: "关联", depends_on: "依赖",
                         supersedes: "取代", contradicts: "矛盾" };
const STATE_NAMES = { active: "有效", needs_reconfirm: "待重新确认",
                      invalidated: "已失效", conflict: "冲突" };
const STATUS_NAMES = { active: "活跃", deprecated: "已废弃", merged: "已合并" };

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function api(path, payload) {
  const res = await fetch(path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });
  const data = await res.json();
  if (!data.ok) { alert("操作失败：" + (data.error || "未知错误")); return false; }
  STATE = data.state;
  render();
  return true;
}

async function load() {
  const res = await fetch("/api/state");
  STATE = await res.json();
  if (!selectedId && STATE.entries.length) selectedId = STATE.entries[0].id;
  render();
}

function entryById(id) { return STATE.entries.find(e => e.id === id); }

function inboundLinks(id) {
  const out = [];
  for (const e of STATE.entries)
    for (const lk of e.links)
      if (lk.target === id) out.push({ from: e, link: lk });
  return out;
}

function hasConflict(e) {
  return e.links.some(l => l.state === "conflict") ||
         inboundLinks(e.id).some(x => x.link.state === "conflict");
}

function render() {
  renderList();
  renderEvents();
  renderDetail();
}

function renderList() {
  const box = document.getElementById("entry-list");
  box.innerHTML = STATE.entries.map(e => {
    const flags = [];
    if (hasConflict(e)) flags.push('<span class="badge conflict">冲突</span>');
    const pend = e.links.filter(l => l.state === "needs_reconfirm").length +
                 inboundLinks(e.id).filter(x => x.link.state === "needs_reconfirm").length;
    if (pend) flags.push('<span class="badge needs_reconfirm">待确认 ' + pend + "</span>");
    return '<div class="entry-item' + (e.id === selectedId ? " selected" : "") +
      '" data-id="' + esc(e.id) + '">' +
      '<div class="title">' + esc(e.id) + " " + esc(e.title) + "</div>" +
      '<div class="meta"><span class="badge ' + esc(e.status) + '">' +
      STATUS_NAMES[e.status] + "</span>" + flags.join("") + "</div></div>";
  }).join("");
  box.querySelectorAll(".entry-item").forEach(el =>
    el.onclick = () => { selectedId = el.dataset.id; render(); });
}

function renderEvents() {
  const box = document.getElementById("event-feed");
  const evts = (STATE.events || []).slice(-40).reverse();
  box.innerHTML = evts.map(ev =>
    '<div class="evt"><span class="t">' + esc(ev.time.slice(5)) + "</span>" +
    esc(ev.text) + "</div>").join("") || '<div class="evt">暂无动态</div>';
}

function linkCard(e, lk, direction) {
  const otherId = direction === "out" ? lk.target : e.id;
  const other = entryById(otherId);
  const label = esc(e.id) + " —" + RELATION_NAMES[lk.relation] + "→ " + esc(lk.target);
  const badges = [];
  badges.push('<span class="badge ' + lk.state + '">' + STATE_NAMES[lk.state] + "</span>");
  if (lk.origin === "inferred") badges.push('<span class="badge inferred">系统推断</span>');
  if (lk.decision === "confirmed") badges.push('<span class="badge confirmed">已确认</span>');
  if (lk.decision === "rejected") badges.push('<span class="badge rejected">已否决</span>');
  const title = other ? esc(other.title) : "（目标不存在）";
  const actionable = lk.decision === "none" && lk.state !== "invalidated";
  const undoable = lk.decision !== "none";
  const attrs = ' data-src="' + esc(e.id) + '" data-tgt="' + esc(lk.target) + '"';
  return '<div class="link-card ' + esc(lk.state) + '">' +
    "<div><b>" + label + "</b> " + title + " " + badges.join("") + "</div>" +
    '<div class="reason">理由：' + esc(lk.reason) + "</div>" +
    (actionable || undoable ? '<div class="actions">' +
      (actionable
        ? '<button data-act="confirm"' + attrs + '>确认</button>' +
          '<button data-act="reject"' + attrs + '>否决</button>'
        : "") +
      (undoable ? '<button data-act="undo"' + attrs + '>撤销裁决</button>' : "") +
      "</div>" : "") +
    "</div>";
}

function renderDetail() {
  const main = document.getElementById("detail");
  const e = entryById(selectedId);
  if (!e) { main.innerHTML = '<p class="placeholder">请选择左侧条目查看详情</p>'; return; }
  const inbound = inboundLinks(e.id);
  const conflicts = e.links.filter(l => l.state === "conflict")
    .concat(inbound.filter(x => x.link.state === "conflict").map(x => x.link));
  let html = "";
  if (conflicts.length)
    html += '<div class="conflict-banner">⚠ 存在 ' + conflicts.length +
      " 条互相矛盾的关联，双方均已保留，请人工裁决。</div>";
  html += '<div class="section"><h3>' + esc(e.id) + " " + esc(e.title) + " " +
    '<span class="badge ' + esc(e.status) + '">' + STATUS_NAMES[e.status] + "</span>" +
    (e.merged_into ? '<span class="badge merged">合并至 ' + esc(e.merged_into) + "</span>" : "") +
    "</h3>" +
    "<div>" + e.tags.map(t => '<span class="tag">' + esc(t) + "</span>").join("") + "</div>" +
    "<p>" + esc(e.body) + "</p>" +
    '<div class="toolbar">' +
    '<button id="act-revise" class="primary">修订</button>' +
    '<button id="act-merge">合并到其他条目</button>' +
    '<button id="act-deprecate" class="danger">废弃</button>' +
    "</div></div>";
  html += '<div class="section"><h3>关联关系（' +
    (e.links.length + inbound.length) + "）</h3>";
  if (!e.links.length && !inbound.length) html += '<p class="placeholder">暂无关联</p>';
  for (const lk of e.links) html += linkCard(e, lk, "out");
  for (const x of inbound) html += linkCard(x.from, x.link, "in");
  html += "</div>";
  html += '<div class="section"><h3>修订记录（' + e.revisions.length + "）</h3>" +
    e.revisions.slice().reverse().map(r =>
      '<div class="rev"><div class="rev-head">rev' + r.rev + " · " + esc(r.time) +
      " · " + esc(r.note) + "</div><div>标签：" +
      r.tags.map(t => '<span class="tag">' + esc(t) + "</span>").join("") +
      "</div><div>" + esc(r.body) + "</div></div>").join("") + "</div>";
  main.innerHTML = html;
  bindDetailActions(e);
}

/* ---------------- 弹窗与操作 ---------------- */

function openModal(title, bodyHtml, onOk) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML = bodyHtml;
  document.getElementById("modal-mask").classList.remove("hidden");
  const okBtn = document.getElementById("modal-ok");
  const newOk = okBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(newOk, okBtn);
  newOk.onclick = async () => {
    if (await onOk()) document.getElementById("modal-mask").classList.add("hidden");
  };
}

document.getElementById("modal-cancel").onclick = () =>
  document.getElementById("modal-mask").classList.add("hidden");

function val(id) { return document.getElementById(id).value.trim(); }
function parseTags(s) { return s.split(/[,，、\s]+/).filter(Boolean); }

function bindDetailActions(e) {
  document.querySelectorAll(".link-card .actions button").forEach(btn =>
    btn.onclick = () => {
      const decision = { confirm: "confirmed", reject: "rejected", undo: "none" }[btn.dataset.act];
      api("/api/links/decision", { source: btn.dataset.src,
                                   target: btn.dataset.tgt, decision: decision });
    });
  document.getElementById("act-revise").onclick = () => openRevise(e);
  document.getElementById("act-merge").onclick = () => openMerge(e);
  document.getElementById("act-deprecate").onclick = () => {
    if (confirm("确定废弃条目 " + e.id + "？其全部关联将标记为待重新确认。"))
      api("/api/entries/" + e.id + "/deprecate", { note: "用户废弃" });
  };
}

function openRevise(e) {
  openModal("修订条目 " + e.id, `
    <label>正文</label><textarea id="f-body">${esc(e.body)}</textarea>
    <label>标签（逗号分隔）</label><input type="text" id="f-tags" value="${esc(e.tags.join(","))}">
    <label>修订说明</label><input type="text" id="f-note" placeholder="本次改了什么">`,
    () => api("/api/entries/" + e.id + "/revise",
              { body: val("f-body"), tags: parseTags(val("f-tags")), note: val("f-note") }));
}

function openMerge(e) {
  const options = STATE.entries.filter(x => x.id !== e.id && x.status === "active")
    .map(x => '<option value="' + esc(x.id) + '">' + esc(x.id) + " " +
              esc(x.title) + "</option>").join("");
  if (!options) { alert("没有可合并的目标条目"); return; }
  openModal("合并条目 " + e.id, `
    <label>合并目标（本条目将标记为已合并，相关关联需重新确认）</label>
    <select id="f-target">${options}</select>`,
    () => api("/api/entries/" + e.id + "/merge", { target: val("f-target") }));
}

document.getElementById("btn-new").onclick = () =>
  openModal("新建经验条目", `
    <label>标题</label><input type="text" id="f-title">
    <label>正文</label><textarea id="f-body"></textarea>
    <label>标签（逗号分隔）</label><input type="text" id="f-tags">`,
    async () => {
      if (!val("f-title") || !val("f-body")) { alert("标题和正文不能为空"); return false; }
      return api("/api/entries", { title: val("f-title"), body: val("f-body"),
                                   tags: parseTags(val("f-tags")) });
    });

document.getElementById("btn-reset").onclick = () => {
  if (confirm("确定重置？全部修改将被清空并恢复种子数据。"))
    api("/api/reset", {}).then(ok => { if (ok) { selectedId = null; load(); } });
};

load();
