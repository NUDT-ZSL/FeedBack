/* 协作编辑协调工具前端 */
"use strict";

const TYPE_CN = {replace: "替换", delete: "删除", insert_after: "段后插入", append: "追加"};
const STATUS_CN = {pending: "待确认", accepted: "已接受", rejected: "已拒绝",
                   invalidated: "已失效", superseded: "已被取代", manual: "手动调整"};
let STATE = null, FINAL = null;

async function api(path, body) {
  const resp = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: {"Content-Type": "application/json"},
    body: body ? JSON.stringify(body) : undefined});
  const data = await resp.json();
  if (!resp.ok) { alert(data.error || "请求失败"); throw new Error(data.error); }
  return data;
}

async function refresh() {
  STATE = await api("/api/state");
  FINAL = await api("/api/final");
  render();
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g,
    c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
}

function groupMap() {
  const m = {};
  for (const g of STATE.groups) m[g.target] = g;
  return m;
}

function renderOutline() {
  const gm = groupMap();
  const walk = secs => secs.map(sec => {
    const paras = (sec.paragraphs || []).map(p => {
      const g = gm[p.id];
      let badge = "";
      if (g) {
        const inv = g.edits.every(e => ["invalidated", "superseded", "rejected"].includes(e.status));
        const cls = g.resolved || inv ? (inv ? "invalid" : "resolved")
                   : g.conflict ? "conflict" : "pending";
        const txt = inv ? "已处理" : g.resolved ? "已确认" : g.conflict ? "冲突" : "待确认";
        badge = `<span class="badge ${cls}">${txt}</span>`;
      }
      return `<div class="para-row" data-pid="${esc(p.id)}">
                <span>${esc(p.id)}</span>${badge}</div>`;
    }).join("");
    const children = sec.sections && sec.sections.length
      ? `<div class="sec-child">${walk(sec.sections)}</div>` : "";
    return `<div class="sec"><div class="sec-title">▸ ${esc(sec.title)}</div>
            ${paras}${children}</div>`;
  }).join("");
  document.getElementById("outline").innerHTML = walk(STATE.document.sections || []);
  document.querySelectorAll(".para-row").forEach(row =>
    row.onclick = () => {
      const el = document.getElementById("grp-" + row.dataset.pid);
      if (el) el.scrollIntoView({behavior: "smooth", block: "center"});
    });
}

function editCard(g, e) {
  const deps = e.depends_on && e.depends_on.length
    ? `<span>依赖: ${e.depends_on.map(esc).join(", ")}</span>` : "";
  const body = e.type === "delete" ? "" :
    `<div class="label">改动内容（${esc(TYPE_CN[e.type])}）</div>
     <div class="preview">${esc(e.content)}</div>`;
  const note = e.note ? `<span class="muted">备注: ${esc(e.note)}</span>` : "";
  let actions = "";
  if (e.status === "pending") {
    actions = `<div class="actions">
        <button data-act="accept" data-id="${e.id}">接受</button>
        <button class="secondary" data-act="reject" data-id="${e.id}">拒绝</button>
        <button class="secondary" data-act="adjust" data-id="${e.id}">手动调整</button>
      </div>
      <div class="adjust-box" hidden><textarea placeholder="输入该段落调整后的完整文本…"></textarea>
        <div class="actions">
          <button data-act="adjust-save" data-id="${e.id}">保存调整</button>
          <button class="secondary" data-act="adjust-cancel">取消</button>
        </div></div>`;
  } else if (["accepted", "rejected"].includes(e.status)) {
    actions = `<div class="actions">
        <button class="secondary" data-act="reset" data-id="${e.id}">撤销决定</button></div>`;
  }
  return `<div class="edit-card">
      <div class="edit-meta">
        <strong>${esc(e.id)}</strong><span>${esc(e.author)}</span>
        <span>${esc(TYPE_CN[e.type])}</span>
        <span class="st ${e.status}">${esc(STATUS_CN[e.status])}</span>${deps}${note}
      </div>${e.reason ? `<div class="reason">⚠ ${esc(e.reason)}</div>` : ""}
      ${body}${actions}</div>`;
}

function renderGroups() {
  document.getElementById("groups").innerHTML = STATE.groups.map(g => {
    const cls = g.conflict ? "conflict" : g.resolved ? "resolved" : "";
    const tag = g.conflict
      ? `<span class="tag conflict">冲突：${esc(g.conflict_desc)}</span>`
      : g.resolved ? `<span class="tag resolved">本组已处理</span>`
      : `<span class="tag" style="background:#eef4ff;color:#3370ff">可组合合并</span>`;
    const inv = g.edits.some(e => e.status === "invalidated");
    return `<div class="group ${cls}" id="grp-${esc(g.target)}">
      <div class="group-head">
        <span class="target">段落 ${esc(g.target)}</span>${tag}
      </div>
      <div class="label">原文</div><div class="orig">${esc(g.original) || "（原文档中不存在）"}</div>
      <div class="label">当前合并预览（含待确认项）</div>
      <div class="preview">${g.preview == null ? "（段落将被删除）" : esc(g.preview)}</div>
      ${inv ? `<div class="reason">本组存在失效编辑，见下</div>` : ""}
      ${g.manual ? `<div class="muted">该段落已通过手动调整确认</div>` : ""}
      ${g.edits.map(e => editCard(g, e)).join("")}
    </div>`;
  }).join("");
  bindActions();
}
  bindActions();
}

function bindActions() {
  document.querySelectorAll("#groups button[data-act]").forEach(btn => {
    btn.onclick = async () => {
      const act = btn.dataset.act, id = btn.dataset.id;
      if (act === "adjust") {
        btn.closest(".edit-card").querySelector(".adjust-box").hidden = false;
        btn.disabled = true;
        return;
      }
      if (act === "adjust-cancel") {
        const box = btn.closest(".adjust-box");
        box.hidden = true;
        box.parentElement.querySelector('[data-act="adjust"]').disabled = false;
        return;
      }
      if (act === "adjust-save") {
        const box = btn.closest(".adjust-box");
        const content = box.querySelector("textarea").value;
        if (!content.trim()) { alert("调整内容不能为空"); return; }
        await api("/api/decide", {edit_id: id, action: "adjust", content});
      } else {
        await api("/api/decide", {edit_id: id, action: act});
      }
      await refresh();
    };
  });
}

function renderFinal() {
  const walk = secs => secs.map(sec => {
    const paras = (sec.paragraphs || [])
      .map(p => `<div class="final-p">${esc(p.text)}</div>`).join("");
    return `<div class="final-sec"><h3>${esc(sec.title)}</h3>${paras}
            <div class="final-sec">${walk(sec.sections || [])}</div></div>`;
  }).join("");
  const u = FINAL.unresolved;
  document.getElementById("unresolved-box").innerHTML = u.length
    ? `<div class="unres"><h3>仍有 ${u.length} 处未解决</h3><ul>${
        u.map(x => `<li>段落 ${esc(x.target)}：${
          x.conflict ? esc(x.desc) : "待确认编辑 " + x.pending.map(esc).join(", ")}</li>`).join("")
      }</ul></div>`
    : `<div class="unres" style="border-color:#9ed4b5;background:#f6fbf8;color:#16703b">
       <h3 style="color:#16703b">所有冲突均已解决</h3></div>`;
  document.getElementById("final-doc").innerHTML =
    `<h3 style="font-size:14px">${esc(FINAL.document.title)}</h3>` +
    walk(FINAL.document.sections || []);

  const total = STATE.groups.reduce((n, g) => n + g.edits.length, 0);
  const done = STATE.groups.reduce((n, g) => n + g.edits.filter(
    e => e.status !== "pending").length, 0);
  const conflicts = STATE.groups.filter(g => g.conflict).length;
  document.getElementById("stats").textContent =
    `编辑 ${done}/${total} 已处理 · 冲突 ${conflicts} · 未解决 ${u.length}`;
}

function render() {
  renderOutline();
  renderGroups();
  renderFinal();
}

document.getElementById("btn-sample").onclick = async () => {
  await api("/api/load", {});
  await refresh();
};
document.getElementById("file-input").onchange = async ev => {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.document || !data.edits) {
      alert("JSON 需要包含 document 与 edits 两个字段"); return;
    }
    await api("/api/load", data);
    await refresh();
  } catch (e) { alert("文件解析失败: " + e.message); }
};

refresh();
