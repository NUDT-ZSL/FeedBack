let S = null; // 最新状态

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.style.display = "block";
  setTimeout(() => t.style.display = "none", 2500);
}

async function api(path, body) {
  const opt = body ? { method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body) } : {};
  const r = await fetch(path, opt);
  const j = await r.json();
  if (!r.ok) { toast(j.error || "请求失败"); throw new Error(j.error); }
  return j;
}

async function refresh() { S = await api("/api/state"); render(); }

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function fmt(n) { return (Math.round(n * 1000) / 1000).toString(); }
function batchName(id) {
  const b = (S.batches || []).find(x => x.id === id);
  return b ? b.name : (id || "-");
}

// ------------------------------------------------------------ 渲染

function render() {
  renderMeta(); renderClosure(); renderChain(); renderBatches();
  renderConflicts(); renderAnomalies(); renderRecords(); fillSelects();
}

function renderMeta() {
  const m = S.meta;
  document.getElementById("meta").textContent =
    "重推方式: " + (m.recompute_mode === "full" ? "全量" : "增量") +
    " | 受影响批次: " + (m.affected_batches.join(", ") || "-") +
    " | 增量与全量一致: " + (m.incremental_matches_full ? "是" : "否");
}

function renderClosure() {
  const c = S.closure;
  const rows = [
    ["投入总量", c["投入总量"]], ["回收", c["回收"]],
    ["转入总量（内部流转）", c["转入总量"]],
    ["再利用", c["再利用"]], ["损耗", c["损耗"]],
    ["转出到后续批次", c["转出到后续批次"]],
    ["未闭合差额", c["未闭合差额"]],
  ];
  document.getElementById("closure-table").innerHTML =
    "<tr><th>项目</th><th>数量</th><th>依据记录数</th></tr>" +
    rows.map(([k, v]) => {
      const basis = (c["去向依据记录"][k] || []).length;
      return "<tr><td>" + k + "</td><td>" + fmt(v) + "</td><td>" +
        (basis || "-") + "</td></tr>";
    }).join("");
  const gap = c["差额依据"].map(g =>
    esc(g.name) + "（" + g.batch_id + "）差额 " + fmt(g.unallocated) +
    "，依据：" + esc(g["依据"])).join("<br>");
  document.getElementById("closure-gap").innerHTML =
    esc(c["差额说明"]) + (gap ? "<br>" + gap : " 当前无差额。");
}

function renderChain() {
  const el = document.getElementById("chain");
  if (!S.edges.length) { el.textContent = "暂无批次间转出链路。"; return; }
  el.innerHTML = "链路：" + S.edges.map(([f, t, rid]) =>
    esc(batchName(f)) + " → " + esc(batchName(t)) +
    " <span class='tag info'>" + esc(rid) + "</span>").join("　");
  if (S.cycles.length) {
    el.innerHTML += "　<span class='tag bad'>循环引用: " +
      S.cycles.map(c => c.map(batchName).join("→")).join("；") + "</span>";
  }
}

function renderBatches() {
  const rows = Object.values(S.results).map(r => {
    const anom = r.anomalies.length ?
      " <span class='tag bad'>异常</span>" : "";
    return "<tr><td>" + esc(r.name) + anom + "<br><small>" + r.batch_id +
      " | 来源: " + esc(r.source) + "</small></td>" +
      "<td>" + fmt(r.input_qty) + "</td><td>" + fmt(r.incoming) + "</td>" +
      "<td>" + fmt(r.available) + "</td>" +
      "<td>" + fmt(r.out["回收"]) + "</td>" +
      "<td>" + fmt(r.out["再利用"]) + "</td>" +
      "<td>" + fmt(r.out["损耗"]) + "</td>" +
      "<td>" + fmt(r.out["转出"]) + "</td>" +
      "<td>" + fmt(r.unallocated) + "</td></tr>";
  }).join("");
  document.getElementById("batch-table").innerHTML =
    "<tr><th>批次</th><th>投入</th><th>转入</th><th>可用量</th>" +
    "<th>回收</th><th>再利用</th><th>损耗</th><th>转出</th>" +
    "<th>未分配差额</th></tr>" + rows;
}

function renderConflicts() {
  const box = document.getElementById("conflicts");
  document.getElementById("conflict-panel").style.display =
    S.conflicts.length ? "block" : "none";
  box.innerHTML = S.conflicts.map((c, i) => {
    const opts = c.record_ids.map(rid => {
      const r = S.records.find(x => x.id === rid);
      return "<label><input type='radio' name='cf" + i + "' value='" + rid +
        "'> " + esc(rid) + "：数量 " + fmt(r.qty) + "，去向 " +
        esc(r.dest_type) + (r.dest_batch ? "→" + esc(batchName(r.dest_batch)) : "") +
        "，备注「" + esc(r.note) + "」</label>";
    }).join("");
    return "<div class='conflict-box'><b>" + esc(batchName(c.batch_id)) +
      " @ " + esc(c.ts) + "</b> <span class='tag bad'>" + esc(c.kind) +
      "</span><br>全部来源已保留，请选择有效记录后裁决：" + opts +
      "<button class='small' onclick='resolveConflict(" + i + ")'>裁决</button></div>";
  }).join("");
}

async function resolveConflict(i) {
  const sel = document.querySelector("input[name='cf" + i + "']:checked");
  if (!sel) { toast("请先选择要保留的记录"); return; }
  const note = prompt("裁决说明（可选）", "") || "";
  S = await api("/api/resolve", { winner_id: sel.value, note: note });
  toast("裁决完成，已增量重推受影响链路"); render();
}

function renderAnomalies() {
  const list = document.getElementById("anomalies");
  document.getElementById("anomaly-panel").style.display =
    S.anomalies.length ? "block" : "none";
  list.innerHTML = S.anomalies.map(a =>
    "<li><span class='tag bad'>" + esc(a.type) + "</span>" +
    esc(a.detail) + "</li>").join("");
}

function renderRecords() {
  const rows = S.records.map(r => {
    let cls = "", status = "有效";
    if (r.status === "rejected") { cls = "rejected"; status = "裁决排除"; }
    if (r.status === "superseded") { cls = "superseded"; status = "已被修正"; }
    const dest = r.dest_type + (r.dest_batch ? "→" + esc(batchName(r.dest_batch)) : "");
    const hist = [];
    if (r.correction_of) hist.push("修正自 " + r.correction_of);
    if (r.superseded_by) hist.push("被 " + r.superseded_by + " 修正");
    if (r.ruling_note) hist.push(esc(r.ruling_note));
    const btn = r.status === "active" ?
      "<button class='small' onclick='correctRecord(\"" + r.id + "\")'>修正</button>" : "";
    return "<tr class='" + cls + "'><td>" + r.id + "</td><td>" +
      esc(batchName(r.batch_id)) + "</td><td>" + esc(r.ts) + "</td><td>" +
      fmt(r.qty) + "</td><td>" + dest + "</td><td>" + esc(r.note) +
      "</td><td>" + status + (hist.length ? "<br><small>" +
      hist.join("；") + "</small>" : "") + "</td><td>" + btn + "</td></tr>";
  }).join("");
  document.getElementById("record-table").innerHTML =
    "<tr><th>编号</th><th>批次</th><th>时刻</th><th>数量</th><th>去向</th>" +
    "<th>备注</th><th>状态/沿革</th><th>操作</th></tr>" + rows;
}

async function correctRecord(rid) {
  const r = S.records.find(x => x.id === rid);
  const qty = prompt("修正数量", r.qty);
  if (qty === null) return;
  const dest = prompt("修正去向类型（回收/再利用/损耗/转出）", r.dest_type);
  if (dest === null) return;
  let destBatch = r.dest_batch || "";
  if (dest === "转出") {
    destBatch = prompt("转出目标批次编号（如 B0002）", destBatch) || "";
  }
  const note = prompt("修正说明", r.note || "") || "";
  S = await api("/api/correct", { record_id: rid, qty: parseFloat(qty),
    dest_type: dest, dest_batch: destBatch, note: note });
  toast("修正完成，原记录已保留，已增量重推"); render();
}

function fillSelects() {
  const opts = S.batches.map(b =>
    "<option value='" + b.id + "'>" + esc(b.name) + "（" + b.id + "）</option>").join("");
  document.querySelector("#form-record select[name=batch_id]").innerHTML = opts;
  document.querySelector("#form-record select[name=dest_batch]").innerHTML =
    "<option value=''>（转出目标批次）</option>" + opts;
}

// ------------------------------------------------------------ 事件

document.getElementById("form-batch").onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  S = await api("/api/batch", { name: f.get("name"),
    input_qty: parseFloat(f.get("input_qty")), source: f.get("source"),
    initial_dest: f.get("initial_dest") });
  e.target.reset(); toast("批次已登记"); render();
};

document.getElementById("form-record").onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  S = await api("/api/record", { batch_id: f.get("batch_id"),
    ts: f.get("ts"), qty: parseFloat(f.get("qty")),
    dest_type: f.get("dest_type"), dest_batch: f.get("dest_batch"),
    note: f.get("note") });
  e.target.reset(); toast("记录已登记，已增量重推"); render();
};

document.getElementById("btn-full").onclick = async () => {
  S = await api("/api/recompute", {}); toast("已全量重推"); render();
};
document.getElementById("btn-verify").onclick = async () => {
  const j = await api("/api/verify");
  document.getElementById("verify-result").textContent = j.consistent ?
    "增量结果与全量重推一致" : "不一致批次: " + j.diff_batches.join(",");
};

refresh();
