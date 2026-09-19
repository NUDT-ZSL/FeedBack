/* Feedback clustering UI - talks to the local offline API. */
let STATE = null;
const selectedForMerge = new Set();
const expanded = new Set();

async function api(path, method, body) {
  const opts = { method: method || "GET" };
  if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const resp = await fetch(path, opts);
  return resp.json();
}

async function refresh() {
  STATE = await api("/api/state");
  render();
}

function fmtTime(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleString("zh-CN", { hour12: false });
}

function esc(s) {
  return String(s).replace(/[&<>"]/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function render() {
  document.getElementById("threshold").value = STATE.threshold;
  document.getElementById("band").value = STATE.band;
  document.getElementById("thVal").textContent = STATE.threshold.toFixed(2);
  document.getElementById("bandVal").textContent = STATE.band.toFixed(2);
  const cc = STATE.constraint_counts;
  document.getElementById("constraints").textContent =
    "人工约束: 合并 " + cc.must_link + " / 拆分 " + cc.cannot_link;
  renderClusters();
  renderEvidence();
}

function renderClusters() {
  const root = document.getElementById("clusters");
  root.innerHTML = "";
  const bar = document.createElement("div");
  bar.className = "toolbar";
  bar.innerHTML = "<span>共 " + STATE.feedback_count + " 条反馈 / " +
    STATE.clusters.length + " 个问题簇</span>";
  const mergeBtn = document.createElement("button");
  mergeBtn.textContent = "合并选中的两个簇";
  mergeBtn.onclick = doMerge;
  bar.appendChild(mergeBtn);
  root.appendChild(bar);

  if (!STATE.clusters.length) {
    const d = document.createElement("div");
    d.className = "empty";
    d.textContent = "还没有反馈，先在上方添加。";
    root.appendChild(d);
    return;
  }
  for (const cl of STATE.clusters) {
    root.appendChild(renderCluster(cl));
  }
}

function renderCluster(cl) {
  const div = document.createElement("div");
  div.className = "cluster" + (selectedForMerge.has(cl.id) ? " selected" : "");

  const head = document.createElement("div");
  head.className = "cluster-head";
  head.innerHTML =
    "<label><input type='checkbox' class='merge-check'> 选为合并</label>" +
    "<span class='label'>" + esc(cl.label) + "</span>" +
    "<span class='badge'>" + cl.member_ids.length + " 条</span>";
  const toggle = document.createElement("button");
  toggle.className = "small";
  toggle.textContent = expanded.has(cl.id) ? "收起" : "展开";
  toggle.onclick = () => {
    expanded.has(cl.id) ? expanded.delete(cl.id) : expanded.add(cl.id);
    render();
  };
  head.appendChild(toggle);
  head.querySelector(".merge-check").checked = selectedForMerge.has(cl.id);
  head.querySelector(".merge-check").onchange = (e) => {
    e.target.checked ? selectedForMerge.add(cl.id) : selectedForMerge.delete(cl.id);
    render();
  };
  div.appendChild(head);

  const terms = document.createElement("div");
  terms.className = "terms";
  terms.textContent = "关键词: " + cl.top_terms.join("、");
  div.appendChild(terms);

  if (expanded.has(cl.id)) {
    div.appendChild(renderMembers(cl));
  }
  return div;
}

function renderMembers(cl) {
  const box = document.createElement("div");
  box.className = "members";
  const checked = new Set();

  const splitBtn = document.createElement("button");
  splitBtn.className = "small warn";
  splitBtn.textContent = "把勾选的反馈拆出此簇";
  splitBtn.onclick = async () => {
    if (!checked.size) return;
    await api("/api/op/split", "POST",
      { cluster_id: cl.id, feedback_ids: Array.from(checked) });
    await refresh();
  };
  box.appendChild(splitBtn);

  for (const m of cl.members) {
    const row = document.createElement("div");
    row.className = "member";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.onchange = () => cb.checked ? checked.add(m.id) : checked.delete(m.id);
    row.appendChild(cb);

    const text = document.createElement("span");
    text.className = "text";
    text.textContent = m.text;
    row.appendChild(text);

    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = m.source + " · " + fmtTime(m.timestamp) +
      (m.tags.length ? " · " + m.tags.join(",") : "");
    row.appendChild(meta);

    const sel = document.createElement("select");
    sel.innerHTML = "<option value=''>移到…</option>" +
      STATE.clusters.filter(c => c.id !== cl.id)
        .map(c => "<option value='" + c.id + "'>" +
             esc(c.label.slice(0, 18)) + "</option>").join("");
    sel.onchange = async () => {
      if (!sel.value) return;
      await api("/api/op/move", "POST",
        { feedback_id: m.id, target_cluster_id: sel.value });
      await refresh();
    };
    row.appendChild(sel);

    const editBtn = document.createElement("button");
    editBtn.className = "small";
    editBtn.textContent = "改";
    editBtn.onclick = async () => {
      const t = prompt("修改反馈原文：", m.text);
      if (t === null) return;
      await api("/api/feedback/" + m.id, "PUT", { text: t });
      await refresh();
    };
    row.appendChild(editBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "small warn";
    delBtn.textContent = "删";
    delBtn.onclick = async () => {
      if (!confirm("删除这条反馈？")) return;
      await api("/api/feedback/" + m.id, "DELETE");
      await refresh();
    };
    row.appendChild(delBtn);
    box.appendChild(row);
  }
  return box;
}

function renderEvidence() {
  const root = document.getElementById("evidence");
  root.innerHTML = "";
  const byId = {};
  for (const cl of STATE.clusters) {
    for (const m of cl.members) byId[m.id] = m.text;
  }
  if (!STATE.evidence.length) {
    root.innerHTML = "<div class='empty'>暂无边界相似对</div>";
    return;
  }
  for (const ev of STATE.evidence) {
    const d = document.createElement("div");
    d.className = "ev-item";
    const cls = ev.decision === "merged" ? "ev-merged" : "ev-separate";
    const label = ev.decision === "merged" ? "已归并" : "未归并";
    const reasonMap = {
      auto: "相似度达到阈值", below_threshold: "相似度略低于阈值",
      must_link: "人工指定合并", cannot_link: "人工指定拆分"
    };
    d.innerHTML =
      "<div class='pair'>「" + esc((byId[ev.a] || ev.a).slice(0, 24)) +
      "」 ↔ 「" + esc((byId[ev.b] || ev.b).slice(0, 24)) + "」</div>" +
      "<div class='why'>相似度 " + ev.similarity.toFixed(3) +
      " · <span class='" + cls + "'>" + label + "</span>" +
      " · " + (reasonMap[ev.reason] || ev.reason) +
      (ev.borderline ? " · <b>边界对</b>" : "") +
      (ev.shared_terms.length ?
        "<br>共同特征: " + esc(ev.shared_terms.join("、")) : "") +
      "</div>";
    root.appendChild(d);
  }
}

async function doMerge() {
  if (selectedForMerge.size !== 2) {
    alert("请勾选正好两个簇进行合并");
    return;
  }
  const [a, b] = Array.from(selectedForMerge);
  await api("/api/op/merge", "POST", { cluster_a: a, cluster_b: b });
  selectedForMerge.clear();
  await refresh();
}

document.getElementById("addBtn").onclick = async () => {
  const text = document.getElementById("textInput").value.trim();
  if (!text) return;
  const tags = document.getElementById("tagInput").value
    .split(/[,，]/).map(s => s.trim()).filter(Boolean);
  await api("/api/feedback", "POST", {
    source: document.getElementById("srcInput").value.trim() || "未标注",
    text: text, tags: tags
  });
  document.getElementById("textInput").value = "";
  await refresh();
};

let paramTimer = null;
function onParamChange() {
  document.getElementById("thVal").textContent =
    Number(document.getElementById("threshold").value).toFixed(2);
  document.getElementById("bandVal").textContent =
    Number(document.getElementById("band").value).toFixed(2);
  clearTimeout(paramTimer);
  paramTimer = setTimeout(async () => {
    await api("/api/settings", "POST", {
      threshold: Number(document.getElementById("threshold").value),
      band: Number(document.getElementById("band").value)
    });
    await refresh();
  }, 300);
}
document.getElementById("threshold").oninput = onParamChange;
document.getElementById("band").oninput = onParamChange;

document.getElementById("resetBtn").onclick = async () => {
  if (!confirm("清除全部人工调整并重新自动聚类？")) return;
  selectedForMerge.clear();
  await api("/api/op/reset", "POST", {});
  await refresh();
};

refresh();
