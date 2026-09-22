const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

const STATUS_LABEL = { pending: "待处理", adjudicated: "已裁定",
                       needs_reconfirm: "需重新确认" };
const DISPOSITIONS = ["立即修复", "排期优化", "暂不处理", "需要更多信息"];
const PRIORITIES = ["P0", "P1", "P2", "P3"];

async function api(path, body) {
  const opt = body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
  const res = await fetch(path, opt);
  const data = await res.json();
  if (!res.ok) { alert(data.error || "操作失败"); throw new Error(data.error); }
  return data;
}

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString("zh-CN", { hour12: false });
}

async function refresh() {
  const data = await (await fetch("/api/board")).json();
  renderSummary(data);
  renderBoard(data);
  renderAudit(data.audit_log);
}

function renderSummary(data) {
  const ds = data.demands;
  const stat = (label, n) =>
    `<div class="stat"><b>${n}</b>${label}</div>`;
  $("#summary").innerHTML =
    stat("诉求总数", ds.length) +
    stat("待处理", ds.filter(d => d.status === "pending").length) +
    stat("需重新确认", ds.filter(d => d.status === "needs_reconfirm").length) +
    stat("待裁定矛盾", ds.reduce((n, d) => n + d.pending_contradictions, 0)) +
    stat("待确认归并", ds.reduce((n, d) => n + d.pending_merges, 0));
}

function rationaleHtml(d, itemId) {
  const r = (d.merge_rationales || []).find(r => r.item_id === itemId);
  if (!r) return "";
  const terms = (r.shared_terms || []).join("、") || "（功能点一致）";
  const sim = r.similarity == null ? "手动合并" : `相似度 ${r.similarity}`;
  let head = `归并依据：${sim}；共同特征：${esc(terms)}；` +
             `匹配功能点「${esc(r.matched_feature)}」`;
  if (r.note) head += `；${esc(r.note)}`;
  if (r.confirmed === null) {
    return `<div class="rationale">${head}
      <button class="small primary" onclick="confirmMerge('${d.id}','${itemId}',true)">确认归并</button>
      <button class="small" onclick="confirmMerge('${d.id}','${itemId}',false)">拒绝（拆出）</button>
    </div>`;
  }
  return `<div class="rationale">${head}；${r.confirmed ? "已确认" : "已拒绝"}</div>`;
}

function itemsTable(d) {
  const rows = d.items.map(it => `
    <tr>
      <td>${esc(it.source)}</td>
      <td>${esc(it.feature)}</td>
      <td>${esc(it.text)}${rationaleHtml(d, it.id)}</td>
      <td>${fmtTime(it.reported_at)}</td>
    </tr>`).join("");
  return `<table class="items">
    <tr><th>来源</th><th>功能点</th><th>原始表述（保留各来源原文）</th><th>报告时间</th></tr>
    ${rows}</table>`;
}
function contradictionsHtml(d) {
  if (!d.contradictions.length) return "";
  return d.contradictions.map(c => {
    const sides = `<div class="vs">
      <div class="side"><b>说法 A（${esc(c.claim_a)}）</b><br>${esc(c.text_a)}</div>
      <div class="side"><b>说法 B（${esc(c.claim_b)}）</b><br>${esc(c.text_b)}</div>
    </div>`;
    if (c.status === "resolved") {
      return `<div class="contradiction resolved">
        <b>矛盾已裁定（双方表述均保留）</b>${sides}
        <div class="meta">裁定：${esc(c.resolution.note)} ——
          ${esc(c.resolution.operator)}，${fmtTime(c.resolution.time)}</div>
      </div>`;
    }
    return `<div class="contradiction">
      <b>⚠ 待裁定矛盾（双方均已保留，未选边）</b>${sides}
      <div style="margin-top:6px">
        <input id="ct-${c.id}" placeholder="裁定说明，如：按版本灰度验证后决定" size="40">
        <button class="small primary"
          onclick="resolveContradiction('${d.id}','${c.id}')">裁定</button>
      </div>
    </div>`;
  }).join("");
}

function adjudicationHtml(d) {
  let cur = "";
  if (d.adjudication) {
    const a = d.adjudication;
    cur = `<div>当前裁定：去向 <b>${esc(a.disposition)}</b>，优先级
      <b>${a.priority}</b>，说明：${esc(a.note || "—")}
      <span class="meta">（${esc(a.operator)}，${fmtTime(a.time)}，
      依据 ${a.basis_item_ids.length} 条反馈）</span></div>`;
  }
  const hist = (d.adjudication_history || []).map(a =>
    `<div class="history">历史裁定：${esc(a.disposition)}/${a.priority}
     （${esc(a.operator)}，${fmtTime(a.time)}）
     ${a.invalidated_at ? "——已因新反馈失效" : ""}</div>`).join("");
  const warn = d.status === "needs_reconfirm"
    ? `<div class="warn">判定依据已变化：该诉求在裁定后收到新反馈，旧结论已失效。
       请重新确认去向与优先级，确认前系统不会沿用旧结论。</div>` : "";
  const sug = d.computed.suggested;
  return `<div class="adjudication">
    ${warn}${cur}
    <form onsubmit="return adjudicate(event,'${d.id}')">
      <select id="disp-${d.id}">${DISPOSITIONS.map(x =>
        `<option>${x}</option>`).join("")}</select>
      <select id="prio-${d.id}">${PRIORITIES.map(x =>
        `<option ${x === sug ? "selected" : ""}>${x}</option>`).join("")}</select>
      <input id="note-${d.id}" placeholder="裁定说明" size="24">
      <input id="op-${d.id}" placeholder="裁定人" size="8">
      <button class="small primary" type="submit">
        ${d.status === "needs_reconfirm" ? "重新确认" : "提交裁定"}</button>
      <span class="meta">系统建议 ${sug}（影响面 ${d.computed.impact}，
        紧急度 ${d.computed.urgency}，来源 ${d.computed.source_count} 个）</span>
    </form>${hist}</div>`;
}

function mergeBarHtml(d, all) {
  const others = all.filter(o => o.id !== d.id);
  if (!others.length) return "";
  return `<div class="merge-bar">手动合并：
    <select id="merge-${d.id}">
      ${others.map(o => `<option value="${o.id}">${esc(o.title)}</option>`).join("")}
    </select>
    <button class="small" onclick="mergeInto('${d.id}')">将本诉求并入所选诉求</button>
  </div>`;
}

function renderBoard(data) {
  $("#board").innerHTML = data.demands.map(d => `
    <div class="demand">
      <div class="demand-head">
        <span class="badge prio ${d.final_priority}">${d.final_priority}</span>
        <h3>${esc(d.title)}</h3>
        <span class="badge feature">${esc(d.feature)}</span>
        <span class="badge status-${d.status}">${STATUS_LABEL[d.status]}</span>
      </div>
      <div class="meta">${d.items.length} 条反馈 · ${d.computed.source_count}
        个来源 · 综合得分 ${d.computed.score} · 诉求 ID ${d.id}</div>
      ${itemsTable(d)}
      ${contradictionsHtml(d)}
      ${adjudicationHtml(d)}
      ${mergeBarHtml(d, data.demands)}
    </div>`).join("") || "<p>暂无诉求，请导入反馈。</p>";
}

function renderAudit(log) {
  $("#audit").innerHTML = log.map(e =>
    `<li><span class="t">${fmtTime(e.time)}</span><br>
     <b>${esc(e.action)}</b> ${esc(e.detail)}
     <span class="t">（${esc(e.operator)}）</span></li>`).join("")
    || "<li>暂无记录</li>";
}
async function confirmMerge(demandId, itemId, accept) {
  await api(`/api/demands/${demandId}/merge-confirm`,
            { item_id: itemId, accept, operator: "运营" });
  refresh();
}

async function resolveContradiction(demandId, cid) {
  const note = $(`#ct-${cid}`).value.trim();
  if (!note) { alert("请填写裁定说明"); return; }
  await api(`/api/demands/${demandId}/contradictions/${cid}/resolve`,
            { note, operator: "运营" });
  refresh();
}

async function adjudicate(ev, demandId) {
  ev.preventDefault();
  await api(`/api/demands/${demandId}/adjudicate`, {
    disposition: $(`#disp-${demandId}`).value,
    priority: $(`#prio-${demandId}`).value,
    note: $(`#note-${demandId}`).value,
    operator: $(`#op-${demandId}`).value || "运营",
  });
  refresh();
  return false;
}

async function mergeInto(sourceId) {
  const target = $(`#merge-${sourceId}`).value;
  if (!confirm("确认将该诉求整体并入所选诉求？所有原始表述都会保留。")) return;
  await api("/api/demands/merge",
            { source_id: sourceId, target_id: target, operator: "运营" });
  refresh();
}

$("#btn-import").onclick = () => {
  $("#import-error").textContent = "";
  $("#import-dialog").showModal();
};
$("#import-cancel").onclick = () => $("#import-dialog").close();
$("#import-submit").onclick = async () => {
  const lines = $("#import-text").value.split("\n")
    .map(l => l.trim()).filter(Boolean);
  const entries = [];
  for (const [i, line] of lines.entries()) {
    try { entries.push(JSON.parse(line)); }
    catch { $("#import-error").textContent = `第 ${i + 1} 行不是合法 JSON`; return; }
  }
  if (!entries.length) { $("#import-error").textContent = "请输入至少一条"; return; }
  try {
    await api("/api/import", { entries });
    $("#import-dialog").close();
    $("#import-text").value = "";
    refresh();
  } catch (e) { $("#import-error").textContent = e.message; }
};
$("#btn-sample").onclick = async () => { await api("/api/sample", {}); refresh(); };
$("#btn-reset").onclick = async () => {
  if (confirm("确认清空全部数据？")) { await api("/api/reset", {}); refresh(); }
};

refresh();
