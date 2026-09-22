let S = null;

async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.ok) alert("操作失败：" + (j.error || "未知错误"));
  return j;
}

async function refresh() {
  S = await api("/api/state");
  render();
}

async function mutate(path, body) {
  const j = await api(path, body || {});
  if (j.ok) { S = j; render(); }
}

const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = x => x == null ? "—" : (x * 100).toFixed(2) + "%";
const gById = id => S.groups.find(g => g.id === id);
const vById = id => S.variants.find(v => v.id === id);

function render() {
  renderConsistency(); renderBaseline(); renderGroups(); renderVariants();
  renderConflicts(); renderConclusions();
}

function renderConsistency() {
  const el = document.getElementById("consistency");
  el.className = "badge " + (S.consistent ? "b-ok" : "b-bad");
  el.textContent = S.consistent ? "增量更新 ✓ 与全量重算一致" : "增量结果与全量重算不一致！";
}

function renderBaseline() {
  const bar = document.getElementById("baselineBar");
  const b = S.baseline;
  const bv = b.variant_id ? vById(b.variant_id) : null;
  let html = "<b>基准：</b>";
  html += bv ? `<span class="chip">${esc(bv.name)}</span>` : "<span class='muted'>（无变体）</span>";
  if (b.locked) {
    const g = gById(b.locked_group);
    html += `<span class="badge b-resolved">已锁定基准分组：${esc(g ? g.name : b.locked_group)}</span>`;
    if (!b.lock_effective) html += `<span class="badge b-bad">锁定分组未归属任何变体，回退为自动基准</span>`;
    html += `<button class="ghost" onclick="unlockBaseline()">解除锁定</button>`;
  } else {
    html += `<span class="muted">未锁定（自动取进入人数最多的变体）</span>`;
  }
  html += `<span class="muted">锁定分组：</span><select id="lockSel">` +
    S.groups.map(g => `<option value="${g.id}">${esc(g.name)}（${esc(g.audience_key)}）</option>`).join("") +
    `</select><button onclick="lockBaseline()">锁定为基准</button>`;
  bar.innerHTML = html;
}

function lockBaseline() {
  mutate("/api/baseline/set", { group_id: document.getElementById("lockSel").value });
}
function unlockBaseline() { mutate("/api/baseline/set", { group_id: null }); }

function renderGroups() {
  const el = document.getElementById("groupList");
  el.innerHTML = S.groups.map(g => {
    const owners = S.memberships.filter(m => m.group_id === g.id);
    const chips = owners.map(m => {
      const v = vById(m.variant_id);
      return `<span class="chip ${m.status === "excluded" ? "excluded" : ""}">${esc(v ? v.name : m.variant_id)}</span>`;
    }).join("");
    const locked = S.baseline.locked_group === g.id ? `<span class="badge b-resolved">基准</span>` : "";
    return `<div class="card">
      <h3>${esc(g.name)} ${locked}</h3>
      <div class="muted">口径：${esc(g.audience_key)} / ${esc(g.version)} ｜ ${esc(g.definition)}</div>
      <div class="kv"><span>进入 <b>${g.entrants}</b></span><span>转化 <b>${g.conversions}</b></span>
        <span>转化率 <b>${pct(g.entrants ? g.conversions / g.entrants : null)}</b></span>
        <span>时段 <b>${esc(g.period_start)} ~ ${esc(g.period_end)}</b></span></div>
      <div class="muted">来源：${esc(g.source)} ｜ 归属：${chips || "（未分配）"}</div>
      <div class="row" style="margin-top:6px">
        <button class="ghost" onclick='editGroup(${JSON.stringify(g.id)})'>编辑/修正观测</button>
        <button class="danger" onclick='delGroup(${JSON.stringify(g.id)})'>删除</button>
      </div>
    </div>`;
  }).join("") || `<div class="muted">暂无分组，请在上方录入。</div>`;
}

function editGroup(id) {
  const g = gById(id);
  document.getElementById("g_id").value = g.id;
  document.getElementById("g_name").value = g.name;
  document.getElementById("g_key").value = g.audience_key;
  document.getElementById("g_version").value = g.version;
  document.getElementById("g_def").value = g.definition;
  document.getElementById("g_entrants").value = g.entrants;
  document.getElementById("g_conv").value = g.conversions;
  document.getElementById("g_start").value = g.period_start;
  document.getElementById("g_end").value = g.period_end;
  document.getElementById("g_source").value = g.source;
}

function delGroup(id) {
  if (confirm("删除该分组及其归属关系？")) mutate("/api/group/delete", { id });
}
function renderVariants() {
  const el = document.getElementById("variantList");
  el.innerHTML = S.variants.map(v => {
    const ms = S.memberships.filter(m => m.variant_id === v.id);
    const chips = ms.map(m => {
      const g = gById(m.group_id);
      return `<span class="chip ${m.status === "excluded" ? "excluded" : ""}">${esc(g ? g.name : m.group_id)}
        <button title="移除归属" onclick='removeM(${JSON.stringify(v.id)},${JSON.stringify(m.group_id)})'>×</button></span>`;
    }).join("");
    const agg = S.aggregates[v.id] || {};
    const opts = S.groups.filter(g => !ms.some(m => m.group_id === g.id && m.status === "active"))
      .map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join("");
    return `<div class="card">
      <h3>${esc(v.name)} <span class="muted">${esc(v.description)}</span></h3>
      <div class="kv"><span>合计进入 <b>${agg.entrants || 0}</b></span>
        <span>合计转化 <b>${agg.conversions || 0}</b></span>
        <span>转化率 <b>${pct(agg.rate)}</b></span></div>
      <div>分组：${chips || "<span class='muted'>（无）</span>"}</div>
      <div class="row" style="margin-top:6px">
        <select id="add_${v.id}">${opts}</select>
        <button class="ghost" onclick='addM(${JSON.stringify(v.id)})'>加入分组</button>
        <button class="danger" onclick='delV(${JSON.stringify(v.id)})'>删除变体</button>
      </div>
    </div>`;
  }).join("") || `<div class="muted">暂无变体。</div>`;
}

function addM(vid) {
  const gid = document.getElementById("add_" + vid).value;
  if (gid) mutate("/api/membership/add", { variant_id: vid, group_id: gid });
}
function removeM(vid, gid) { mutate("/api/membership/remove", { variant_id: vid, group_id: gid }); }
function delV(vid) { if (confirm("删除该变体及其归属？")) mutate("/api/variant/delete", { id: vid }); }

function renderConflicts() {
  const el = document.getElementById("conflictList");
  if (!S.conflicts.length) {
    el.innerHTML = `<div class="muted">当前无冲突。</div>`;
    return;
  }
  el.innerHTML = S.conflicts.map(c => {
    let actions = "";
    if (c.type === "multi_variant") {
      const opts = c.variant_ids.map(vid => {
        const v = vById(vid);
        return `<option value="${vid}">${esc(v ? v.name : vid)}</option>`;
      }).join("");
      actions = `<div class="row"><select id="res_${c.key}">${opts}</select>
        <button onclick='resolveKeep(${JSON.stringify(c.key)})'>仅保留该变体</button>
        <button class="ghost" onclick='resolveAck(${JSON.stringify(c.key)})'>标记已知（保留全部）</button></div>`;
    } else {
      const btns = [];
      c.variant_ids.forEach(vid => c.group_ids.forEach(gid => {
        const v = vById(vid), g = gById(gid);
        btns.push(`<button class="ghost" onclick='resolveEx(${JSON.stringify(c.key)},${JSON.stringify(vid)},${JSON.stringify(gid)})'>排除 ${esc(v ? v.name : vid)}×${esc(g ? g.name : gid)}</button>`);
      }));
      actions = `<div class="row">${btns.join("")}
        <button class="ghost" onclick='resolveAck(${JSON.stringify(c.key)})'>标记已知（保留全部）</button></div>`;
    }
    const badge = c.resolved ? `<span class="badge b-resolved">已裁决</span>`
                             : `<span class="badge b-conflict">待裁决</span>`;
    const note = c.resolution ? `<div class="reason">${esc(c.resolution.note)}</div>` : "";
    return `<div class="card"><h3>${esc(c.title)} ${badge}</h3>
      <div class="warn">${esc(c.detail)}</div>${note}${actions}</div>`;
  }).join("");
}

function resolveKeep(key) {
  const vid = document.getElementById("res_" + key).value;
  mutate("/api/conflict/resolve", { key, action: "keep_variant", variant_id: vid });
}
function resolveAck(key) { mutate("/api/conflict/resolve", { key, action: "ack" }); }
function resolveEx(key, vid, gid) {
  mutate("/api/conflict/resolve", { key, action: "exclude_membership", variant_id: vid, group_id: gid });
}
function renderConclusions() {
  const el = document.getElementById("conclusionList");
  el.innerHTML = S.conclusions.map(c => {
    const v = vById(c.variant_id);
    const name = esc(v ? v.name : c.variant_id);
    if (c.role !== "treatment") {
      return `<div class="card"><h3>${name} <span class="badge b-resolved">${esc(c.verdict)}</span></h3>
        <div class="kv"><span>转化率 <b>${pct(c.rate)}</b></span>
        <span>样本 <b>${c.conversions}/${c.entrants}</b></span></div></div>`;
    }
    const confCls = c.confidence === "高" ? "b-high" : c.confidence === "中" ? "b-mid" : "b-low";
    const warns = (c.warnings || []).map(w => `<div class="warn">⚠ ${esc(w)}</div>`).join("");
    const reasons = (c.reasons || []).map(r => `<div class="reason">· ${esc(r)}</div>`).join("");
    const rel = c.rel_lift == null ? "—" : (c.rel_lift * 100).toFixed(1) + "%";
    return `<div class="card">
      <h3>${name} <span class="badge ${confCls}">可信度：${esc(c.confidence)}</span></h3>
      <div class="kv"><span>判定 <b>${esc(c.verdict)}</b></span>
        <span>转化率 <b>${pct(c.rate)}</b> vs 基准 <b>${pct(c.base_rate)}</b></span>
        <span>绝对差 <b>${c.lift == null ? "—" : (c.lift * 100).toFixed(2) + "pp"}</b></span>
        <span>相对提升 <b>${rel}</b></span>
        <span>p 值 <b>${c.p_value == null ? "—" : c.p_value.toFixed(4)}</b></span></div>
      ${warns}${reasons}
    </div>`;
  }).join("") || `<div class="muted">暂无可比较的变体。</div>`;
}

document.getElementById("groupForm").addEventListener("submit", e => {
  e.preventDefault();
  const body = {
    id: document.getElementById("g_id").value || undefined,
    name: document.getElementById("g_name").value,
    audience_key: document.getElementById("g_key").value,
    version: document.getElementById("g_version").value,
    definition: document.getElementById("g_def").value,
    entrants: +document.getElementById("g_entrants").value,
    conversions: +document.getElementById("g_conv").value,
    period_start: document.getElementById("g_start").value,
    period_end: document.getElementById("g_end").value,
    source: document.getElementById("g_source").value,
  };
  mutate(body.id ? "/api/group/update" : "/api/group/create", body);
  e.target.reset(); document.getElementById("g_id").value = "";
});
document.getElementById("g_reset").addEventListener("click", () => {
  document.getElementById("groupForm").reset();
  document.getElementById("g_id").value = "";
});
document.getElementById("variantForm").addEventListener("submit", e => {
  e.preventDefault();
  mutate("/api/variant/create", {
    name: document.getElementById("v_name").value,
    description: document.getElementById("v_desc").value,
  });
  e.target.reset();
});
document.getElementById("demoBtn").addEventListener("click", () => {
  if (confirm("载入演示数据将覆盖当前全部数据，继续？")) mutate("/api/demo/load");
});

refresh();
