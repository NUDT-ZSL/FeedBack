/* 在途异常处置推演台前端 */
let STATE = null;
let selectedShipment = null;
const TYPE_LABELS = {congestion:"拥堵", breakdown:"故障", road_closure:"道路封闭",
                     weather:"天气", delay_update:"延误更新", recovery:"恢复"};
const STATUS_LABELS = {normal:"正常", delayed:"延误", conflict_pending:"冲突待裁决",
                       interrupted:"已中断"};
const NODE_STATUS = {actual:"实际到达", on_time:"预计准点", delayed:"预计延误",
                     unreachable:"不可达", planned:"计划", pending:"待推导"};
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g,
  c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt = t => t ? t.slice(5, 16).replace("T", " ") : "—";

async function api(path, body) {
  const opt = body === undefined ? {} :
    {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)};
  const r = await fetch(path, opt);
  const j = await r.json();
  if (j.state) { STATE = j.state; renderAll(); }
  if (j.ok === false) alert("操作失败: " + j.error);
  return j;
}

function shipOf(id) { return STATE.shipments.find(s => s.id === id); }

function renderAll() {
  if (!selectedShipment || !shipOf(selectedShipment))
    selectedShipment = STATE.shipments.length ? STATE.shipments[0].id : null;
  $("now-label").textContent = "当前推演时刻: " + fmt(STATE.now);
  $("clock-input").value = STATE.now;
  renderShipments(); renderTimeline(); renderSignals();
  renderConflicts(); renderActions(); renderInterruption(); renderSignalForm();
}

function renderShipments() {
  const f = $("status-filter").value;
  const list = STATE.shipments.filter(s => !f || s.status === f);
  $("shipment-list").innerHTML = list.map(s => `
    <div class="ship-card ${s.id === selectedShipment ? "selected" : ""}"
         onclick="selectShip('${s.id}')">
      <div class="name">${esc(s.name)}</div>
      <div class="meta">${s.id} · ${esc(s.carrier)}</div>
      <div class="meta">
        <span class="badge b-${s.status}">${STATUS_LABELS[s.status]}</span>
        ${s.max_delay > 0 ? `<span class="delay-pos">最大延误 ${s.max_delay} 分钟</span>` : ""}
      </div>
    </div>`).join("") || `<div class="empty">无匹配运输单</div>`;
}
function selectShip(id) { selectedShipment = id; renderAll(); }

function renderTimeline() {
  const sh = shipOf(selectedShipment);
  if (!sh) { $("timeline").innerHTML = ""; return; }
  $("timeline-sub").textContent = `${sh.name}（${sh.id}）`;
  const legsByIdx = {};
  sh.legs.forEach(l => { legsByIdx[l.index] = l; });
  let html = "";
  sh.nodes.forEach((nd, i) => {
    html += `<div class="node-row">
      <div class="node-dot st-${nd.status}"></div>
      <div class="node-info">
        <b>${esc(nd.name)}</b>
        <span class="badge b-${nd.status}">${NODE_STATUS[nd.status] || nd.status}</span>
        <div class="node-times">计划 ${fmt(nd.planned_arrival)} ｜ 预计 ${fmt(nd.eta)}
          ${nd.delay_min != null && nd.status !== "unreachable"
            ? `｜ <span class="${nd.delay_min > 0 ? "delay-pos" : "delay-zero"}">延误 ${nd.delay_min} 分钟</span>`
            : ""}
        </div>
      </div>
    </div>`;
    const leg = legsByIdx[i];
    if (i < sh.nodes.length - 1) {
      if (leg) {
        const chips = leg.signals.map(s =>
          `<span class="chip sev${s.severity}">${TYPE_LABELS[s.type] || s.type}·S${s.severity}·${esc(s.source)}</span>`).join("");
        const acts = leg.actions.map(a =>
          `<span class="chip action">${esc(STATE.action_presets[a.kind])}·${esc(a.owner || "")}</span>`).join("");
        const cf = leg.conflict
          ? `<span class="chip conflict" onclick="scrollConflicts()">⚠ 冲突${leg.conflict.adjudicated ? "·已裁决" : "·待裁决"}</span>` : "";
        html += `<div class="leg-block ${leg.signals.length ? "has-signal" : ""} ${leg.conflict ? "has-conflict" : ""}">
          <div class="node-times">${esc(leg.from_name)} → ${esc(leg.to_name)} ｜ 计划 ${leg.planned_minutes} 分钟
            ｜ 信号附加 ${leg.signal_delay} 分钟 ｜ 动作附加 ${leg.action_delay} 分钟</div>
          <div>${chips}${acts}${cf}</div>
        </div>`;
      } else {
        html += `<div class="leg-block"><div class="node-times">— 下游区间未推导（上游中断）—</div></div>`;
      }
    }
  });
  $("timeline").innerHTML = html;
}
function scrollConflicts() {
  document.querySelector("#conflict-list").scrollIntoView({behavior: "smooth"});
}

function renderSignals() {
  const tf = $("sig-type-filter").value, sf = $("sig-source-filter").value,
        vf = $("sig-sev-filter").value;
  const list = STATE.signals.filter(s =>
    (!tf || s.type === tf) && (!sf || s.source === sf) &&
    (!vf || Number(s.severity) >= Number(vf)));
  $("signal-list").innerHTML = list.map(s => `
    <div class="sig-item">
      <span class="chip sev${s.severity} ${s.status !== "active" ? s.status : ""}">
        ${TYPE_LABELS[s.type] || s.type}·S${s.severity}</span>
      <b>${s.id}</b> · ${esc(s.shipment_id)} · ${esc(s.source)} · ${fmt(s.occurred_at)}
      ${s.unreachable ? `<span class="chip conflict">不可达</span>` : ""}
      ${s.delay_minutes != null ? `<span class="chip">延误估计 ${s.delay_minutes}′</span>` : ""}
      ${s.status !== "active" ? `<span class="chip">${s.status === "superseded" ? "已被修正" : "已撤回"}</span>` : ""}
      ${s.revises ? `<span class="chip">修正 ${esc(s.revises)}</span>` : ""}
      <div class="note">${esc(s.note || "")}</div>
      ${s.status === "active" ? `<button class="ghost" onclick="retractSignal('${s.id}')">撤回</button>` : ""}
    </div>`).join("") || `<div class="empty">无匹配信号</div>`;
}
function retractSignal(id) { api("/api/signal/retract", {id}); }

function renderConflicts() {
  const list = STATE.conflicts;
  $("conflict-list").innerHTML = list.map(c => `
    <div class="conflict-card ${c.adjudicated ? "done" : ""}">
      <div><b>${esc(c.shipment_id)}</b> 区间 ${c.leg_index}
        <span class="badge ${c.adjudicated ? "b-normal" : "b-conflict_pending"}">
          ${c.adjudicated ? "已裁决" : "待裁决"}</span></div>
      <div class="reasons">${c.reasons.map(esc).join("；")}</div>
      ${c.signals.map(s => `
        <label class="sig-item" style="display:block">
          <input type="checkbox" class="adj-keep" data-cid="${esc(c.id)}"
                 data-ship="${esc(c.shipment_id)}" data-leg="${c.leg_index}"
                 value="${s.id}" ${c.kept_signal_ids.includes(s.id) ? "checked" : ""}>
          <span class="chip sev${s.severity}">${TYPE_LABELS[s.type] || s.type}·S${s.severity}</span>
          ${s.id} · ${esc(s.source)} · ${fmt(s.occurred_at)}
          <div class="note">${esc(s.note || "")}</div>
        </label>`).join("")}
      <div class="row">
        <button onclick="adjudicate('${esc(c.id)}','${esc(c.shipment_id)}',${c.leg_index})">提交裁决</button>
        <span class="node-times">勾选予以采信的来源，未勾选的不参与推导</span>
      </div>
    </div>`).join("") || `<div class="empty">当前无冲突</div>`;
}
function adjudicate(cid, ship, leg) {
  const kept = [...document.querySelectorAll(`.adj-keep[data-cid="${CSS.escape(cid)}"]:checked`)]
    .map(el => el.value);
  if (!kept.length) { alert("至少保留一个信号来源"); return; }
  api("/api/adjudicate", {conflict_id: cid, shipment_id: ship, leg_index: leg,
                          kept_signal_ids: kept, by: "dispatch"});
}

function renderActions() {
  const sh = shipOf(selectedShipment);
  if (!sh) { $("action-panel").innerHTML = ""; $("action-list").innerHTML = ""; return; }
  const legOpts = sh.nodes.slice(0, -1).map((nd, i) =>
    `<option value="${i}">${esc(nd.name)} → ${esc(sh.nodes[i + 1].name)}</option>`).join("");
  const kindOpts = Object.entries(STATE.action_presets)
    .map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
  const sigOpts = STATE.signals
    .filter(s => s.shipment_id === sh.id && s.status === "active")
    .map(s => `<option value="${s.id}">${s.id} ${TYPE_LABELS[s.type] || s.type}</option>`).join("");
  $("action-panel").innerHTML = `
    <div class="form-grid">
      <label>区间 <select id="act-leg">${legOpts}</select></label>
      <label>动作 <select id="act-kind">${kindOpts}</select></label>
      <label>责任方 <select id="act-owner">
        <option value="dispatch">调度</option><option value="carrier">承运方</option>
      </select></label>
      <label>关联信号(响应时限用) <select id="act-signal">
        <option value="">—</option>${sigOpts}</select></label>
    </div>
    <div class="row"><button onclick="addAction()">添加响应动作</button></div>`;
  $("action-list").innerHTML = STATE.actions
    .filter(a => a.shipment_id === sh.id).map(a => `
      <div class="sig-item">
        <span class="chip action">${esc(STATE.action_presets[a.kind])}</span>
        ${a.id} · 区间 ${a.leg_index} · ${esc(a.owner || "")} · ${fmt(a.decided_at)}
        ${a.signal_id ? `· 关联 ${esc(a.signal_id)}` : ""}
        <button class="ghost" onclick="removeAction('${a.id}')">撤销</button>
      </div>`).join("") || `<div class="empty">暂无动作</div>`;
}
function addAction() {
  const sh = shipOf(selectedShipment);
  api("/api/action", {shipment_id: sh.id, leg_index: Number($("act-leg").value),
                      kind: $("act-kind").value, owner: $("act-owner").value,
                      signal_id: $("act-signal").value || null});
}
function removeAction(id) { api("/api/action/remove", {id}); }

function renderInterruption() {
  const sh = shipOf(selectedShipment);
  const it = sh && sh.interruption;
  const REASONS = {unreachable: "节点不可达", timeout: "响应超时", manual_cancel: "手动中止"};
  $("interruption-panel").innerHTML = it ? `
    <div><span class="badge b-interrupted">已中断</span>
      <b>${esc(it.node_name)}</b> ｜ 原因: ${REASONS[it.reason] || it.reason}</div>
    <div style="margin-top:6px">
      ${it.chain.map(c => `
        <div class="chain-step">
          <span class="step-tag">${esc(c.step)}</span>${esc(c.detail)}
          <span class="at">${fmt(c.at)}</span>
        </div>`).join("")}
    </div>` : `<div class="empty">该运输单未中断</div>`;
}

function renderSignalForm() {
  const shipOpts = STATE.shipments.map(s =>
    `<option value="${s.id}" ${s.id === selectedShipment ? "selected" : ""}>${s.id} ${esc(s.name)}</option>`).join("");
  const typeOpts = Object.entries(TYPE_LABELS)
    .map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  const revOpts = STATE.signals.filter(s => s.status === "active")
    .map(s => `<option value="${s.id}">${s.id}</option>`).join("");
  $("signal-form").innerHTML = `
    <div class="form-grid">
      <label>运输单 <select id="sf-ship">${shipOpts}</select></label>
      <label>发生时刻 <input type="datetime-local" id="sf-time" value="${STATE.now}"></label>
      <label>类型 <select id="sf-type">${typeOpts}</select></label>
      <label>严重度 <select id="sf-sev">${[1,2,3,4,5].map(v => `<option>${v}</option>`).join("")}</select></label>
      <label>来源 <select id="sf-source">
        <option value="dispatch">调度</option><option value="carrier">承运方</option>
        <option value="iot">物联网</option><option value="manual">人工</option></select></label>
      <label>区间序号(留空自动定位) <input id="sf-leg" placeholder="如 2"></label>
      <label>延误估计(分钟,可空) <input id="sf-delay" placeholder="如 60"></label>
      <label>修正哪条信号(可空) <select id="sf-revises"><option value="">—</option>${revOpts}</select></label>
      <label class="full">备注 <input id="sf-note" style="width:100%"></label>
      <label class="full"><span><input type="checkbox" id="sf-unreach"> 标记节点不可达</span></label>
    </div>
    <div class="row"><button onclick="addSignal()">追加信号</button></div>`;
}
function addSignal() {
  const body = {shipment_id: $("sf-ship").value,
                occurred_at: $("sf-time").value || STATE.now,
                type: $("sf-type").value, severity: Number($("sf-sev").value),
                source: $("sf-source").value, note: $("sf-note").value,
                unreachable: $("sf-unreach").checked};
  if ($("sf-leg").value !== "") body.leg_index = Number($("sf-leg").value);
  if ($("sf-delay").value !== "") body.delay_minutes = Number($("sf-delay").value);
  if ($("sf-revises").value) body.revises = $("sf-revises").value;
  api("/api/signal", body);
}

["status-filter", "sig-type-filter", "sig-source-filter", "sig-sev-filter"]
  .forEach(id => $(id).addEventListener("change", renderAll));
$("clock-apply").addEventListener("click", () => {
  if ($("clock-input").value) api("/api/clock", {now: $("clock-input").value});
});
$("reset-btn").addEventListener("click", () => api("/api/reset", {}));

(async function init() {
  const j = await api("/api/state");
  STATE = j;
  const types = [...new Set(STATE.signals.map(s => s.type))];
  const sources = [...new Set(STATE.signals.map(s => s.source))];
  $("sig-type-filter").innerHTML = `<option value="">全部类型</option>` +
    types.map(t => `<option value="${t}">${TYPE_LABELS[t] || t}</option>`).join("");
  $("sig-source-filter").innerHTML = `<option value="">全部来源</option>` +
    sources.map(s => `<option value="${s}">${s}</option>`).join("");
  renderAll();
})();
