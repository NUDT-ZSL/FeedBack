let STATE = null;
let selectedSeq = null;
let suspCursor = -1;

const STATUS_TEXT = {
  ok: "通过", mismatch: "校验不一致", missing_checksum: "校验值缺失",
  bad_format: "格式异常", dangling_ref: "引用悬空", duplicate_seq: "顺序号重复"
};

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.style.display = "block";
  setTimeout(() => t.style.display = "none", 3000);
}

async function api(path, data) {
  const opt = data === undefined ? {} : {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify(data)
  };
  const r = await fetch(path, opt);
  const j = await r.json();
  if (j.error) { toast("错误: " + j.error); throw new Error(j.error); }
  return j;
}

async function refresh(path, data) {
  STATE = await api(path || "/api/state", data);
  render();
  if (STATE.adjudications_updated && STATE.adjudications_updated.length)
    toast("裁决结论已更新: seq " + STATE.adjudications_updated.join(", "));
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g,
    c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
}

function render() {
  const s = STATE;
  document.getElementById("recomputed").textContent =
    "上次重算记录数: " + s.last_recomputed.length + " / " + s.total;
  const algo = document.getElementById("algo");
  if (!algo.options.length) {
    s.algorithms.forEach(a => algo.add(new Option(a, a)));
  }
  algo.value = s.basis.algorithm;

  let sm = "";
  sm += card("记录总数", s.total);
  for (const k in s.counts)
    sm += card(STATUS_TEXT[k] || k, s.counts[k]);
  if (s.first_fault) {
    const f = s.first_fault;
    const seqs = s.impact_range.map(i => s.records[i].seq);
    sm += card("首个不一致", "位置 " + f.index + " (seq=" + f.seq + ")");
    sm += card("影响范围", seqs.length + " 条: seq " + seqs.join(", "));
  } else {
    sm += card("结论", "整条链校验通过");
  }
  document.getElementById("summary").innerHTML = sm;
  renderChain();
  renderDetail();
}

function card(k, v) {
  return '<div class="card"><div class="muted">' + esc(k) +
         '</div><div>' + esc(v) + "</div></div>";
}

function impactedSet() {
  const set = {};
  for (const k in STATE.impacted_by)
    STATE.impacted_by[k].forEach(i => set[i] = true);
  return set;
}

function renderChain() {
  const imp = impactedSet();
  let h = "<table><tr><th>#</th><th>seq</th><th>时间</th><th>来源</th>" +
          "<th>正文</th><th>校验值</th><th>状态</th></tr>";
  STATE.records.forEach((r, i) => {
    const st = r.result.status;
    const cls = ["rec"];
    if (r.seq === selectedSeq) cls.push("selected");
    else if (imp[i]) cls.push("impacted");
    h += '<tr class="' + cls.join(" ") + '" data-seq="' + r.seq + '">' +
      "<td>" + i + "</td><td>" + r.seq + "</td>" +
      "<td>" + esc(r.timestamp) + "</td><td>" + esc(r.source) + "</td>" +
      "<td>" + esc(r.body.slice(0, 30)) + (r.body.length > 30 ? "…" : "") + "</td>" +
      "<td><code>" + esc((r.checksum || "—").slice(0, 12)) + "</code></td>" +
      '<td><span class="badge ' + st + '">' + (STATUS_TEXT[st] || st) +
      "</span></td></tr>";
  });
  document.getElementById("chainTable").innerHTML = h + "</table>";
  document.querySelectorAll("tr.rec").forEach(tr =>
    tr.onclick = () => { selectedSeq = +tr.dataset.seq; render(); });
}

function renderDetail() {
  const el = document.getElementById("detailBody");
  const i = STATE.records.findIndex(r => r.seq === selectedSeq);
  if (i < 0) { el.innerHTML = "点击左侧记录查看详情。"; return; }
  const r = STATE.records[i], res = r.result;
  const adj = STATE.adjudications[String(r.seq)];
  const match = (res.actual_checksum || "").toLowerCase() ===
                (res.expected_checksum || "").toLowerCase();
  let h = "<h3>seq=" + r.seq + " <span class='badge " + res.status + "'>" +
          (STATUS_TEXT[res.status] || res.status) + "</span></h3>";
  h += "<p><b>时间:</b> " + esc(r.timestamp) + " <b>来源:</b> " + esc(r.source) +
       " <b>prev_seq:</b> " + esc(r.prev_seq) + "</p>";
  h += "<p><b>原始正文:</b></p><pre>" + esc(r.body) + "</pre>";
  h += "<p><b>期望校验值:</b><br><code>" + esc(res.expected_checksum) + "</code></p>";
  h += "<p><b>实际校验值:</b><br><code class='" +
       (match ? "diff-ok" : "diff-bad") + "'>" + esc(res.actual_checksum || "(缺失)") +
       "</code></p>";
  h += "<p><b>原因:</b> " + res.reasons.map(esc).join("; ") + "</p>";
  const impacted = STATE.impacted_by[String(i)];
  if (impacted && impacted.length > 1) {
    const seqs = impacted.map(j => STATE.records[j].seq);
    h += "<p><b>对后续链条的影响:</b> 该记录及其后 " + (impacted.length - 1) +
         " 条记录(seq " + seqs.join(", ") +
         ")的校验依据均建立在本记录之上,需一并复核。</p>";
  }
  if (adj) {
    h += "<div class='card'><b>已有裁决:</b> " + esc(adj.verdict) +
         " — " + esc(adj.note) + "<br><span class='muted'>结论: " +
         esc(adj.conclusion) + " | 裁决时状态: " + esc(adj.status_at_ruling) +
         " | 当前状态: " + esc(adj.current_status) + "</span></div>";
  }
  h += editForm(r) + adjudForm(r);
  el.innerHTML = h;
  bindDetail(r);
}

function editForm(r) {
  return "<h3>修改记录(仅重算受影响区间)</h3>" +
    "<label>正文</label><textarea id='edBody' rows='3'>" + esc(r.body) + "</textarea>" +
    "<label>顺序号</label><input type='text' id='edSeq' value='" + r.seq + "'>" +
    "<label>校验值(留空表示不修改)</label><input type='text' id='edSum' placeholder='" +
    esc(r.checksum || "") + "'>" +
    "<button id='btnEdit'>保存修改</button>";
}

function adjudForm(r) {
  return "<h3>裁决</h3>" +
    "<select id='adjVerdict'>" +
    "<option value='tampered'>确认被篡改</option>" +
    "<option value='false_positive'>误报(予以接受)</option>" +
    "<option value='fixed'>已修复</option>" +
    "<option value='pending'>待进一步调查</option></select>" +
    "<textarea id='adjNote' rows='2' placeholder='备注'></textarea>" +
    "<button id='btnAdj'>记录裁决</button>";
}

function bindDetail(r) {
  document.getElementById("btnEdit").onclick = async () => {
    const data = { seq: r.seq };
    const body = document.getElementById("edBody").value;
    const newSeq = document.getElementById("edSeq").value;
    const sum = document.getElementById("edSum").value.trim();
    if (body !== r.body) data.body = body;
    if (+newSeq !== r.seq) data.new_seq = +newSeq;
    if (sum) data.checksum = sum;
    await refresh("/api/edit", data);
    toast("已保存,仅重算受影响区间: " + STATE.last_recomputed.length + " 条");
  };
  document.getElementById("btnAdj").onclick = async () => {
    await refresh("/api/adjudicate", {
      seq: r.seq,
      verdict: document.getElementById("adjVerdict").value,
      note: document.getElementById("adjNote").value
    });
    toast("裁决已记录");
  };
}

document.getElementById("algo").onchange = e =>
  refresh("/api/basis", { algorithm: e.target.value });
document.getElementById("btnFullVerify").onclick = () =>
  refresh("/api/verify", {});
document.getElementById("btnNextSusp").onclick = () => {
  const susp = STATE.records.filter(r => r.result.status !== "ok");
  if (!susp.length) { toast("当前没有可疑记录"); return; }
  suspCursor = (suspCursor + 1) % susp.length;
  selectedSeq = susp[suspCursor].seq;
  render();
  const tr = document.querySelector("tr.rec[data-seq='" + selectedSeq + "']");
  if (tr) tr.scrollIntoView({ block: "center" });
};

refresh();
