/* App wiring: state fetch, params, import, events, points table, detail. */
let STATE = null;

const PARAM_LABELS = {
  stay_radius_m: "停留聚集半径 (m)",
  stay_min_seconds: "停留最短时长 (s)",
  co_radius_m: "同行接近半径 (m)",
  co_min_seconds: "稳定同行最短时长 (s)",
  drift_speed_mps: "漂移速度阈值 (m/s)",
  sample_step_s: "同行采样步长 (s)",
  gap_tolerance_s: "同行间隔容忍 (s)",
};
const FLAG_LABELS = { out_of_order: "时间倒序", duplicate: "重复上报", drift: "明显漂移" };
const $ = id => document.getElementById(id);
const fmtT = t => new Date(t * 1000).toLocaleString("zh-CN", { hour12: false });

async function api(path, body) {
  const opt = body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
  const r = await fetch(path, opt);
  const d = await r.json();
  if (d.error) { alert("操作失败: " + d.error); throw new Error(d.error); }
  return d;
}

async function refresh(path, body) {
  STATE = await api(path || "/api/state", body);
  renderAll();
}

function renderAll() {
  renderParams(); renderVerify(); renderEvents(); renderPoints();
  window.drawTimeline($("timeline"), STATE, onSelect);
}

function renderParams() {
  const box = $("params");
  box.innerHTML = "";
  for (const k in PARAM_LABELS) {
    const lab = document.createElement("label");
    lab.innerHTML = "<span>" + PARAM_LABELS[k] + "</span>";
    const inp = document.createElement("input");
    inp.type = "number"; inp.step = "any"; inp.value = STATE.params[k];
    inp.dataset.param = k;
    lab.appendChild(inp);
    box.appendChild(lab);
  }
}

function renderVerify() {
  const b = $("verify-badge"), v = STATE.verify;
  b.className = v.ok ? "ok" : "bad";
  b.textContent = v.ok ? "增量结果与整体重推一致" : "不一致: " + v.problems.join(", ");
}

function renderEvents() {
  const box = $("events");
  const names = { added: "新增同行", removed: "同行消失", changed: "区间变化" };
  if (!STATE.events.length) { box.innerHTML = '<p class="muted">最近一次操作未引起同行关系变化</p>'; return; }
  box.innerHTML = STATE.events.map(e => {
    const tg = e.targets.join(" ↔ ");
    let txt = "";
    if (e.type === "added") txt = tg + " " + kindOf(e.new) + " " + span(e.new);
    else if (e.type === "removed") txt = tg + " 原" + kindOf(e.old) + " " + span(e.old);
    else txt = tg + " " + span(e.old) + " → " + span(e.new);
    return '<div class="evt ' + e.type + '"><b>' + names[e.type] + "</b> " + txt + "</div>";
  }).join("");
}
const kindOf = r => r.kind === "stable" ? "稳定同行" : "偶发接近";
const span = r => fmtT(r.start) + " ~ " + fmtT(r.end);

function renderPoints() {
  const rows = STATE.points.map(p => {
    const flags = p.flags.map(f =>
      '<span class="flag ' + f + '">' + FLAG_LABELS[f] + "</span>").join("");
    return "<tr><td>" + p.id + "</td><td>" + p.target + "</td>" +
      '<td><input data-f="t" value="' + p.t + '"></td>' +
      '<td><input data-f="lat" value="' + p.lat + '"></td>' +
      '<td><input data-f="lon" value="' + p.lon + '"></td>' +
      "<td>" + fmtT(p.t) + "</td><td>" + (flags || "-") + "</td>" +
      '<td><button data-act="save" data-id="' + p.id + '">保存</button>' +
      '<button data-act="del" data-id="' + p.id + '">删除</button></td></tr>';
  }).join("");
  $("points-table").innerHTML = "<table><thead><tr><th>ID</th><th>目标</th>" +
    "<th>时刻(epoch)</th><th>纬度</th><th>经度</th><th>时刻(可读)</th><th>异常</th><th>操作</th>" +
    "</tr></thead><tbody>" + rows + "</tbody></table>";
}

function onSelect(kind, target, id) {
  const box = $("detail");
  if (kind === "segment") {
    const s = STATE.segments[target].find(x => x.id === id);
    const pts = s.point_ids.map(pid => STATE.points.find(p => p.id === pid))
      .filter(Boolean);
    box.innerHTML = "<h2>" + target + " · " + (s.kind === "stay" ? "停留段" : "移动段") +
      "</h2><p>" + fmtT(s.start) + " ~ " + fmtT(s.end) +
      (s.center ? "　中心: " + s.center.lat.toFixed(5) + "," + s.center.lon.toFixed(5) : "") +
      (s.distance_m !== undefined ? "　里程: " + s.distance_m + " m" : "") + "</p>" +
      "<p>判定参数: 聚集半径 " + s.params_used.stay_radius_m + " m，最短时长 " +
      s.params_used.stay_min_seconds + " s</p>" +
      "<p>依据点 (" + pts.length + "):</p><ul>" + pts.map(p =>
        "<li>" + p.id + " " + fmtT(p.t) + " (" + p.lat.toFixed(5) + "," +
        p.lon.toFixed(5) + ") " + p.flags.map(f => FLAG_LABELS[f]).join("/") +
        "</li>").join("") + "</ul>";
  } else {
    const r = STATE.relations.find(x => x.id === id);
    box.innerHTML = "<h2>同行关系 " + r.targets.join(" ↔ ") + " · " + kindOf(r) +
      "</h2><p>" + fmtT(r.start) + " ~ " + fmtT(r.end) + "　置信度 " + r.confidence +
      "</p><p>判定参数: 接近半径 " + r.params_used.co_radius_m +
      " m，稳定阈值 " + r.params_used.co_min_seconds + " s，采样步长 " +
      r.params_used.sample_step_s + " s，间隔容忍 " + r.params_used.gap_tolerance_s +
      " s</p><p>置信依据: 持续 " + r.basis.duration_s + " s，有效采样 " +
      r.basis.samples + "，接近采样 " + r.basis.close_samples + "，覆盖率 " +
      r.basis.coverage + "，平均间距 " + r.basis.mean_distance_m + " m</p>";
  }
}

$("apply-params").onclick = () => {
  const body = {};
  document.querySelectorAll("[data-param]").forEach(i => body[i.dataset.param] = i.value);
  refresh("/api/params", body);
};
$("import-btn").onclick = () => refresh("/api/import", { text: $("import-text").value });
$("import-file").onchange = e => {
  const f = e.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => refresh("/api/import", { text: rd.result });
  rd.readAsText(f);
};
$("reset-btn").onclick = () => { if (confirm("确定清空全部数据?")) refresh("/api/reset", {}); };
$("points-table").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  const id = b.dataset.id;
  if (b.dataset.act === "del") return refresh("/api/point/delete", { id });
  const tr = b.closest("tr"), fields = {};
  tr.querySelectorAll("input").forEach(i => fields[i.dataset.f] = i.value);
  refresh("/api/point/update", { id, fields });
});

refresh();
