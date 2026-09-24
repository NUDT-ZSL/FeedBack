/* 前端逻辑：状态加载、渲染、临时改写规则、增量重推结果展示 */
let STATE = null;
let SELECTED = null;

async function api(path, opts) {
  const r = await fetch(path, opts);
  return r.json();
}

async function loadState() {
  STATE = await api("/api/state");
  renderNodes();
  renderRequests({});
  renderRules();
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
}

function renderNodes() {
  const el = document.getElementById("nodes");
  el.innerHTML = STATE.nodes.map(n => {
    const tag = n.terminal ? '<span class="badge mut">终点</span>' : "";
    const chk = n.terminal ? "" :
      `<label><input type="checkbox" data-node="${esc(n.id)}" ${n.reachable ? "checked" : ""}> 可达</label>`;
    return `<div class="node-row">${chk}<b>${esc(n.id)}</b> ${tag}</div>`;
  }).join("");
  el.querySelectorAll("input[data-node]").forEach(cb => {
    cb.onchange = () => mutate({type: "node_reachable", node_id: cb.dataset.node, reachable: cb.checked});
  });
}

function renderRequests(changedMap) {
  const el = document.getElementById("requests");
  el.innerHTML = STATE.requests.map(q => {
    const r = STATE.results[q.id] || {};
    const badge = r.status === "delivered"
      ? `<span class="badge ok">落点 ${esc(r.landing)}</span>`
      : `<span class="badge err">无法确定</span>`;
    const path = (r.path || []).join(" → ");
    const changed = changedMap[q.id] ? " changed" : "";
    const sel = SELECTED === q.id ? " selected" : "";
    return `<div class="req-row${sel}${changed}" data-qid="${esc(q.id)}">
      <b>${esc(q.id)}</b> ${badge}<br><span class="req-path">${esc(path)}</span></div>`;
  }).join("");
  el.querySelectorAll(".req-row").forEach(row => {
    row.onclick = () => { SELECTED = row.dataset.qid; renderRequests({}); showTrace(SELECTED); };
  });
}

function renderRules() {
  const el = document.getElementById("rules");
  el.innerHTML = STATE.rules.map(r => `
    <div class="rule-card" data-rid="${esc(r.id)}">
      <div><b>${esc(r.id)}</b> @ ${esc(r.node)}
        <span class="badge ${r.status === "active" ? "ok" : "err"}">${r.status === "active" ? "生效" : "已撤回"}</span></div>
      <div class="row"><label>优先级</label><input class="f-priority" type="number" value="${r.priority ?? 100}"></div>
      <div class="row"><label>条件</label><input class="f-when" value='${esc(JSON.stringify(r.when || {}))}'></div>
      <div class="row"><label>目标</label><input class="f-target" value="${esc(r.target)}"></div>
      <div class="row"><label>备用</label><input class="f-backups" value="${esc((r.backups || []).join(","))}"></div>
      <div class="row"><label>状态</label>
        <select class="f-status">
          <option value="active" ${r.status === "active" ? "selected" : ""}>生效</option>
          <option value="withdrawn" ${r.status === "withdrawn" ? "selected" : ""}>撤回</option>
        </select></div>
      <div class="btns"><button class="b-save">应用改写</button><button class="b-del">删除</button></div>
    </div>`).join("");
  el.querySelectorAll(".rule-card").forEach(card => {
    const rid = card.dataset.rid;
    card.querySelector(".b-save").onclick = () => {
      let when;
      try { when = JSON.parse(card.querySelector(".f-when").value || "{}"); }
      catch (e) { alert("条件 JSON 无法解析"); return; }
      const backups = card.querySelector(".f-backups").value.split(",")
        .map(s => s.trim()).filter(Boolean);
      mutate({type: "rule_update", rule_id: rid, patch: {
        priority: Number(card.querySelector(".f-priority").value),
        when, target: card.querySelector(".f-target").value.trim(),
        backups, status: card.querySelector(".f-status").value,
      }});
    };
    card.querySelector(".b-del").onclick = () => {
      if (confirm("删除规则 " + rid + "？")) mutate({type: "rule_delete", rule_id: rid});
    };
  });
}
async function showTrace(qid) {
  const d = await api("/api/trace/" + encodeURIComponent(qid));
  const el = document.getElementById("trace");
  const o = d.outcome;
  let head;
  if (o.status === "delivered") {
    head = `<div class="outcome delivered">最终落点：<b>${esc(o.landing)}</b>（已送达）</div>`;
  } else {
    head = `<div class="outcome undetermined">无法确定：${esc(o.reason_text)}<br>
      中断跳：第 ${o.break_hop.depth} 跳，节点 <b>${esc(o.break_hop.node)}</b>（${esc(o.detail)}）</div>`;
  }
  const hops = d.trace.map(h => {
    const cls = h.chosen ? "done" : (h.candidates.length || h.events.length ? "" : "");
    const rows = h.candidates.map(c => {
      const basis = c.basis.map(b =>
        `<span class="${b.ok ? "cond-ok" : "cond-no"}">${b.ok ? "✓" : "✗"} ${esc(b.cond)}</span>`).join("<br>");
      const chosen = h.chosen && h.chosen.rule_id === c.rule_id;
      const w = c.status === "withdrawn";
      return `<tr class="${chosen ? "chosen" : ""} ${w ? "withdrawn" : ""}">
        <td>${esc(c.rule_id)}${chosen ? " ✅选用" : ""}${w ? "（已撤回）" : ""}</td>
        <td>${c.priority}</td>
        <td>${esc(c.target)}${c.backups.length ? "<br>备用: " + esc(c.backups.join(", ")) : ""}</td>
        <td>${basis}</td></tr>`;
    }).join("");
    const table = rows ? `<table><tr><th>候选规则</th><th>优先级</th><th>目标</th><th>命中依据</th></tr>${rows}</table>` : "";
    const events = h.events.length ? `<ul class="events">${h.events.map(e => `<li>${esc(e)}</li>`).join("")}</ul>` : "";
    return `<div class="hop ${h.chosen ? "done" : ""}">
      <h4>第 ${h.depth} 跳 · 节点 ${esc(h.node)}</h4>${table}${events}</div>`;
  }).join("");
  el.innerHTML = head + hops;
}

async function mutate(mut) {
  const rep = await api("/api/mutate", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(mut),
  });
  if (rep.error) { alert(rep.error); return; }
  STATE.results = rep.results;
  const bar = document.getElementById("report-bar");
  const cons = rep.consistent
    ? '<span class="ok">增量重推与整体重推一致 ✓</span>'
    : '<span class="bad">增量与全量不一致 ✗</span>';
  bar.innerHTML = `重推请求：${rep.rederived.join(", ") || "无"} ｜ 落点变化：${rep.changed.join(", ") || "无"} ｜ ${cons}`;
  const changedMap = {};
  rep.changed.forEach(q => { changedMap[q] = true; });
  renderRequests(changedMap);
  renderRules();
  if (SELECTED) showTrace(SELECTED);
}

document.getElementById("btn-reset").onclick = async () => {
  await api("/api/reset", {method: "POST"});
  SELECTED = null;
  document.getElementById("trace").innerHTML = '<p class="hint">点击左侧请求查看逐跳推导。</p>';
  document.getElementById("report-bar").textContent = "已重置为示例数据";
  await loadState();
};

document.getElementById("btn-add-rule").onclick = () => {
  let when;
  try { when = JSON.parse(document.getElementById("nr-when").value || "{}"); }
  catch (e) { alert("条件 JSON 无法解析"); return; }
  const rule = {
    id: document.getElementById("nr-id").value.trim(),
    node: document.getElementById("nr-node").value.trim(),
    priority: Number(document.getElementById("nr-priority").value),
    when,
    target: document.getElementById("nr-target").value.trim(),
    backups: document.getElementById("nr-backups").value.split(",").map(s => s.trim()).filter(Boolean),
  };
  if (!rule.id || !rule.node || !rule.target) { alert("id / 节点 / 目标 必填"); return; }
  mutate({type: "rule_add", rule});
};

loadState();
