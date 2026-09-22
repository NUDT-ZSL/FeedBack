/* 用户反馈聚类工作台前端逻辑 */
let S = { feedbacks: [], clusters: [], conflicts: [], leads: [], decisions: [] };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function api(path, body) {
  const opt = body === undefined ? {} :
    { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body) };
  const r = await fetch(path, opt);
  return await r.json();
}

async function refresh() {
  S = await api("/api/state");
  render();
}

function clusterOptions(selected) {
  let h = '<option value="">移动到…</option><option value="new">（新簇）</option>';
  for (const c of S.clusters)
    h += `<option value="${c.id}" ${c.id === selected ? "disabled" : ""}>${c.id}（${c.size}条）</option>`;
  return h;
}

function render() {
  $("statFb").textContent = S.feedbacks.length;
  $("statCl").textContent = S.clusters.length;
  $("statCf").textContent = S.conflicts.length;
  $("statLd").textContent = S.leads.length;
  if (S.meta && S.meta.backend)
    $("statMeta").textContent = "相似度引擎 " +
      (S.meta.backend === "embedding" ? "句向量" : S.meta.backend) +
      (S.meta.threshold != null ? " · 阈值 " + S.meta.threshold : "");
  renderClusters(); renderConflicts(); renderLeads(); renderDecisions();
}

function renderClusters() {
  const box = $("clusters");
  if (!S.clusters.length) { box.innerHTML = '<span class="muted">暂无数据，请先导入反馈。</span>'; return; }
  const textOf = {}; for (const f of S.feedbacks) textOf[f.id] = f.text;
  let h = "";
  for (const c of S.clusters) {
    h += `<div class="cluster"><div class="cluster-head">
      <span class="cid">${c.id}</span><span class="size-badge">${c.size} 条</span>
      <span class="label">${esc(c.label)}</span>
      <span class="kw">${c.keywords.map((k) => `<span>${esc(k)}</span>`).join("")}</span>
    </div>`;
    for (const m of c.member_ids) {
      h += `<div class="member">
        <input type="checkbox" class="pick" data-cid="${c.id}" value="${m}">
        <span class="fid">#${m}</span><span class="txt">${esc(textOf[m])}</span>
        <select onchange="doMove(${m}, this.value); this.selectedIndex=0;">
          ${clusterOptions(c.id)}</select>
      </div>`;
    }
    const others = S.clusters.filter((x) => x.id !== c.id)
      .map((x) => `<option value="${x.id}">${x.id}</option>`).join("");
    h += `<div class="cluster-actions">
      <button class="ghost" onclick="doSplit('${c.id}')">将勾选拆为新簇</button>
      <span class="muted">合并本簇到:</span>
      <select onchange="if(this.value) doMerge('${c.id}', this.value); this.selectedIndex=0;">
        <option value="">选择目标簇</option>${others}</select>
    </div></div>`;
  }
  box.innerHTML = h;
}

function renderConflicts() {
  const box = $("conflicts");
  if (!S.conflicts.length) { box.innerHTML = '<span class="muted">暂无冲突。</span>'; return; }
  box.innerHTML = S.conflicts.map((cf, i) => `
    <div class="conflict">
      <div>相似度 <span class="sim">${cf.similarity}</span>，但分属 ${cf.cluster_a} / ${cf.cluster_b}</div>
      <div class="pair">A (#${cf.a})：${esc(cf.text_a)}</div>
      <div class="pair">B (#${cf.b})：${esc(cf.text_b)}</div>
      <button onclick="doConflict(${cf.a}, ${cf.b}, 'merge')">归入同簇</button>
      <button class="warn" onclick="doConflict(${cf.a}, ${cf.b}, 'separate')">保持分开</button>
    </div>`).join("");
}

function renderLeads() {
  const box = $("leads");
  if (!S.leads.length) { box.innerHTML = '<span class="muted">暂无线索。</span>'; return; }
  const textOf = {}; for (const f of S.feedbacks) textOf[f.id] = f.text;
  let h = `<table><tr><th>线索</th><th>规模</th><th>代表性描述 / 来源反馈</th></tr>`;
  for (const l of S.leads) {
    const src = l.feedback_ids.map((id) => `#${id} ${esc(textOf[id])}`).join("<br>");
    h += `<tr><td>${l.lead_id}<br><span class="muted">${l.cluster_id}</span></td>
      <td><b>${l.size}</b></td>
      <td>${esc(l.title)}<br><span class="kw">${l.keywords.map((k) => `<span>${esc(k)}</span>`).join("")}</span>
      <div class="src-list">${src}</div></td></tr>`;
  }
  box.innerHTML = h + "</table>";
}

function renderDecisions() {
  const box = $("decisions");
  if (!S.decisions.length) { box.innerHTML = '<span class="muted">暂无人工决策。</span>'; return; }
  box.innerHTML = S.decisions.slice().reverse().map((d) => `
    <div class="log-item"><span class="tag ${d.type}">${d.type === "must_link" ? "同簇" : "分开"}</span>
      #${d.a} ↔ #${d.b} <span class="muted">${esc(d.source)} · ${esc(d.note)} · ${d.ts}</span>
    </div>`).join("");
}

/* ---------- 操作 ---------- */

async function doImport() {
  const text = $("pasteBox").value;
  if (!text.trim()) return;
  const r = await api("/api/import", { text });
  S = r; $("pasteBox").value = "";
  $("importReport").textContent =
    `导入 ${r.import_report.added} 条，跳过重复 ${r.import_report.skipped_duplicates} 条`;
  render();
}

async function doImportFile() {
  const f = $("fileInput").files[0];
  if (!f) return;
  const fd = new FormData(); fd.append("file", f);
  const r = await (await fetch("/api/import_file", { method: "POST", body: fd })).json();
  S = r; $("fileInput").value = "";
  $("importReport").textContent =
    `导入 ${r.import_report.added} 条，跳过重复 ${r.import_report.skipped_duplicates} 条`;
  render();
}

async function doMove(fid, target) {
  if (!target) return;
  S = await api("/api/move", { feedback_id: fid, target_cluster_id: target });
  render();
}

async function doMerge(a, b) {
  S = await api("/api/merge", { cluster_a: a, cluster_b: b });
  render();
}

async function doSplit(cid) {
  const ids = [...document.querySelectorAll(`.pick[data-cid="${cid}"]:checked`)]
    .map((x) => parseInt(x.value, 10));
  if (!ids.length) { alert("请先勾选要拆出的反馈"); return; }
  S = await api("/api/split", { cluster_id: cid, feedback_ids: ids });
  render();
}

async function doConflict(a, b, action) {
  S = await api("/api/conflict", { a, b, action });
  render();
}

async function doReset() {
  if (!confirm("确定清空全部反馈与决策记录？")) return;
  S = await api("/api/reset", {});
  render();
}

refresh();
