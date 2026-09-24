/* UI core: state, api, stats/drift panels, file loading. */
"use strict";

const TYPE_NAME = { stop: "停驻", move: "移动", uncertain: "待确认" };
let DATA = null, INITIAL_STATS = null, SELECTED = null;
const $ = id => document.getElementById(id);
const mapView = new MapView($("map"), id => selectSegment(id, true));

function fmtTime(t) {
  const d = new Date(t * 1000);
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtDur(s) {
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分` : `${m} 分钟`;
}
function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(2) + " km" : Math.round(m) + " m"; }

function toast(msg, warn) {
  const el = $("toast");
  el.textContent = msg;
  el.className = "toast" + (warn ? " warn" : "");
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.hidden = true, 5000);
}

async function api(path, body, raw) {
  const r = await fetch(path, { method: "POST",
    headers: raw ? { "Content-Type": "text/plain" } : { "Content-Type": "application/json" },
    body: raw ? body : JSON.stringify(body || {}) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || ("请求失败 " + r.status));
  return data;
}

function render(data, keepView) {
  DATA = data;
  if (!INITIAL_STATS) INITIAL_STATS = { ...data.stats };
  const n = $("notices");
  n.hidden = !data.notices.length;
  n.textContent = data.notices.join("；");
  renderStats(data.stats);
  renderDrift(data.drift);
  renderSegList(data.segments);
  mapView.setData(data);
  if (!keepView) mapView.fitAll();
}

function renderStats(s) {
  $("stats").innerHTML = [
    ["停驻段", s.stop_count + " 个"], ["移动段", s.move_count + " 个"],
    ["待确认", s.uncertain_count + " 个"], ["人工调整", s.overridden_count + " 次"],
    ["停驻总时长", fmtDur(s.total_stop_s)], ["移动总时长", fmtDur(s.total_move_s)],
    ["移动总里程", fmtDist(s.total_move_m)], ["待确认时长", fmtDur(s.uncertain_s)],
  ].map(([k, v]) => `<span class="k">${k}</span><span>${v}</span>`).join("");
  const d = [];
  const diff = (key, fmt, label) => {
    const v = s[key] - INITIAL_STATS[key];
    if (v) d.push(`${label} ${v > 0 ? "+" : ""}${fmt(v)}`);
  };
  diff("stop_count", v => v + " 个", "停驻段");
  diff("move_count", v => v + " 个", "移动段");
  diff("uncertain_count", v => v + " 个", "待确认");
  diff("total_stop_s", fmtDur, "停驻时长");
  diff("total_move_m", fmtDist, "移动里程");
  $("statsDelta").textContent = d.length ? "相对初始结果：" + d.join("；") : "";
}

function renderDrift(drift) {
  $("driftCard").hidden = !drift.length;
  $("driftList").innerHTML = "";
  drift.forEach(d => {
    const li = document.createElement("li");
    li.textContent = `${fmtTime(d.t)} · ${d.reason}`;
    li.onclick = () => mapView.fitTo([d]);
    $("driftList").appendChild(li);
  });
}

$("sampleBtn").onclick = async () => {
  try {
    INITIAL_STATS = null; SELECTED = null;
    render(await api("/api/sample"), false);
    toast("已恢复示例数据");
  } catch (e) { toast(e.message, true); }
};

$("fileInput").onchange = async ev => {
  const f = ev.target.files[0];
  if (!f) return;
  try {
    INITIAL_STATS = null; SELECTED = null;
    render(await api("/api/load", await f.text(), true), false);
    toast(`已载入 ${f.name}`);
  } catch (e) { toast("载入失败：" + e.message, true); }
  ev.target.value = "";
};

(async () => {
  try { render(await api("/api/analysis"), false); }
  catch (e) { toast("初始化失败：" + e.message, true); }
})();
