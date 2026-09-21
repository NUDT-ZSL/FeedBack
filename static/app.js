/* 多渠道反馈分流系统前端 */
const $ = (s) => document.querySelector(s);
let STATE = { items: [], demands: [], audit: [] };
let currentDetail = null;
const DISPOSITIONS = ["立即修复", "排期优化", "转需求评审", "暂不处理", "需要更多信息"];

async function api(path, body) {
  const opt = body === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
  const r = await fetch(path, opt);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "请求失败");
  return j;
}

async function refresh() {
  STATE = await api("/api/state");
  renderPending();
  renderBoard();
  renderAudit();
  if (currentDetail) renderDetail(currentDetail);
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function statusBadge(d) {
  const cls = d.status === "已裁定" ? "st-done" : d.status === "待重审" ? "st-stale" : "st-pending";
  return `<span class="badge ${cls}">${esc(d.status)}</span>`;
}
function prioBadge(d) {
  return `<span class="badge ${d.priority_level.toLowerCase()}">${d.priority_level}</span>`;
}
function contraBadge(d) {
  const open = (d.contradictions || []).filter((c) => c.status === "待裁定").length;
  return open ? `<span class="badge contra">矛盾待裁定×${open}</span>` : "";
}

function renderPending() {
  const list = STATE.demands.filter((d) => d.status !== "已裁定");
  $("#pending-count").textContent = `(${list.length})`;
  $("#pending-list").innerHTML = list.map((d) => `
    <div class="demand-card" data-id="${d.id}">
      <div class="title">${prioBadge(d)} ${esc(d.title)}</div>
      <div>${statusBadge(d)} ${contraBadge(d)}
        <span class="badge">功能点:${esc(d.feature)}</span>
        <span class="badge">${d.item_ids.length} 条来源反馈</span></div>
      <div class="meta">${esc(d.priority_expl)}</div>
    </div>`).join("") || "<p>暂无待处理诉求。</p>";
  document.querySelectorAll("#pending-list .demand-card").forEach((el) =>
    el.addEventListener("click", () => renderDetail(el.dataset.id)));
}

function renderBoard() {
  const sorted = [...STATE.demands].sort((a, b) => b.priority_score - a.priority_score);
  $("#board-body").innerHTML = sorted.map((d) => `
    <tr data-id="${d.id}" style="cursor:pointer">
      <td>${prioBadge(d)}<div class="expl">${esc(d.priority_expl)}</div></td>
      <td>${esc(d.title)}<div class="expl">功能点:${esc(d.feature)} · ${d.item_ids.length} 条反馈</div></td>
      <td>${statusBadge(d)} ${contraBadge(d)}</td>
      <td>${esc(d.disposition || (d.status === "待重审" ? "待重新确认(旧结论已冻结)" : "未裁定"))}</td>
      <td class="expl">影响面 ${d.impact}:${esc(d.impact_expl)}<br>紧急度 ${d.urgency}:${esc(d.urgency_expl)}</td>
    </tr>`).join("");
  document.querySelectorAll("#board-body tr").forEach((el) =>
    el.addEventListener("click", () => renderDetail(el.dataset.id)));
}

function renderAudit() {
  $("#audit-list").innerHTML = [...STATE.audit].reverse().slice(0, 60)
    .map((a) => `<li>[${esc(a.time)}] <b>${esc(a.action)}</b> ${esc(a.detail)}</li>`).join("");
}

function itemById(id) { return STATE.items.find((i) => i.id === id); }

function renderDetail(id) {
  const d = STATE.demands.find((x) => x.id === id);
  if (!d) { currentDetail = null; $("#detail").classList.add("hidden"); return; }
  currentDetail = id;
  const items = d.item_ids.map(itemById).filter(Boolean);
  let html = `<p>${prioBadge(d)} ${statusBadge(d)} ${contraBadge(d)}
    <b>${esc(d.title)}</b>(功能点:${esc(d.feature)})</p>
    <p class="expl">优先级依据:${esc(d.priority_expl)};影响面:${esc(d.impact_expl)};紧急度:${esc(d.urgency_expl)}</p>`;

  if (d.status === "待重审") {
    html += `<div class="stale-box"><b>判定依据已变化:</b>${esc(d.stale_reason || "")}<br>
      旧去向「${esc(d.disposition || "-")}」已冻结,请重新确认。
      <div>${DISPOSITIONS.map((x) =>
        `<label><input type="radio" name="re-disp" value="${x}" ${x === d.disposition ? "checked" : ""}>${x}</label>`).join("")}
      <button data-act="confirm">重新确认去向</button></div></div>`;
  }

  html += `<h3>各来源原始表述(共 ${items.length} 条)</h3>` + items.map((i) => `
    <div class="src-item"><span class="who">[${esc(i.source)}]</span>${esc(i.text)}
      <div class="meta">报告时间:${esc(i.time)} · 条目 ${i.id}</div></div>`).join("");

  html += `<h3>归并依据</h3><ul class="merge-log">` + (d.merge_log || []).map((m) =>
    `<li>[${esc(m.time)}] 条目 ${m.item_id}:${esc(m.reason)}</li>`).join("") + `</ul>`;

  if ((d.contradictions || []).length) {
    html += `<h3>矛盾说法(双方均保留)</h3>`;
    for (const c of d.contradictions) {
      const sideTxt = (s) => `${esc(s.label)}(${s.item_ids.length} 条:${s.item_ids.map((x) =>
        esc(itemById(x)?.source || x)).join("、")})`;
      html += `<div class="contra-box"><b>方面:${esc(c.aspect)} — ${esc(c.status)}</b>
        <div class="side">甲方:${sideTxt(c.side_a)}</div>
        <div class="side">乙方:${sideTxt(c.side_b)}</div>`;
      if (c.status === "待裁定") {
        html += `<div><input type="text" placeholder="裁定结论(不丢弃任一方,说明取舍理由)"
          style="width:60%" data-aspect="${esc(c.aspect)}">
          <button data-act="rule" data-aspect="${esc(c.aspect)}">提交矛盾裁定</button></div>`;
      } else {
        html += `<div class="expl">裁定:${esc(c.ruling.resolution)}(${esc(c.ruling.operator)} @ ${esc(c.ruling.time)})</div>`;
      }
      html += `</div>`;
    }
  }

  html += `<h3>去向裁定</h3><div>${DISPOSITIONS.map((x) =>
    `<label><input type="radio" name="disp" value="${x}" ${x === d.disposition ? "checked" : ""}>${x}</label>`).join("")}
    <input type="text" id="adj-note" placeholder="裁定备注(可选)">
    <button data-act="adjudicate">提交裁定并重算优先级</button></div>`;

  html += `<h3>裁定记录</h3><ul class="merge-log">` + (d.adjudications || []).map((r) =>
    `<li>[${esc(r.time)}] ${esc(r.operator)} 裁定为「${esc(r.disposition)}」(${esc(r.priority)})
     ${esc(r.note)}<br><span class="expl">依据:${esc(r.basis)}</span></li>`).join("") + `</ul>`;

  $("#detail-body").innerHTML = html;
  $("#detail").classList.remove("hidden");

  $("#detail-body").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => onDetailAction(d, b)));
}

async function onDetailAction(d, btn) {
  const act = btn.dataset.act;
  try {
    if (act === "adjudicate" || act === "confirm") {
      const name = act === "confirm" ? "re-disp" : "disp";
      const sel = document.querySelector(`input[name=${name}]:checked`);
      if (!sel) return alert("请先选择处理去向");
      await api(`/api/demand/${d.id}/${act}`,
        { disposition: sel.value, note: $("#adj-note")?.value || "" });
    } else if (act === "rule") {
      const input = btn.parentElement.querySelector("input[type=text]");
      await api(`/api/demand/${d.id}/contradiction`,
        { aspect: btn.dataset.aspect, resolution: input.value });
    }
    await refresh();
  } catch (e) { alert(e.message); }
}

$("#btn-sample").addEventListener("click", async () => {
  await api("/api/sample", {});
  await refresh();
});
$("#btn-reset").addEventListener("click", async () => {
  if (confirm("确定清空全部数据?")) { await api("/api/reset", {}); currentDetail = null;
    $("#detail").classList.add("hidden"); await refresh(); }
});
$("#btn-import").addEventListener("click", () =>
  $("#import-panel").classList.toggle("hidden"));
$("#btn-do-import").addEventListener("click", async () => {
  try {
    const r = await api("/api/import", { raw: $("#import-raw").value });
    $("#import-msg").textContent = `已导入 ${r.results.length} 条`;
    await refresh();
  } catch (e) { $("#import-msg").textContent = "导入失败:" + e.message; }
});
$("#btn-close-detail").addEventListener("click", () => {
  currentDetail = null; $("#detail").classList.add("hidden");
});

refresh();
