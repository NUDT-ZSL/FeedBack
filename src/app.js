import { seedState } from "./seed.js";
import { deriveGraph } from "./graph.js";
import { RELATIONS, STATUS_LABELS } from "./normalize.js";
import {
  addLink,
  createEntry,
  deprecateEntry,
  mergeEntry,
  reconfirmLink,
  rewriteEntry,
  setCandidateDecision
} from "./revisions.js";

const STORAGE_KEY = "experience-link-guardian:v1";
const $ = selector => document.querySelector(selector);

let state = loadState();
let graph = deriveGraph(state);
let selectedId = state.entries[0]?.id;
let searchTerm = "";

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.version === 1 && Array.isArray(parsed.entries)) return parsed;
    }
  } catch (error) {
    console.warn("无法读取本地数据，使用示例数据", error);
  }
  return seedState();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function commit(next, message) {
  state = next;
  graph = deriveGraph(state);
  if (!state.entries.some(entry => entry.id === selectedId)) {
    selectedId = state.entries[0]?.id;
  }
  saveState();
  render();
  if (message) toast(message);
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.add("hidden"), 2600);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function now() {
  return new Date().toISOString();
}

function entryById(id) {
  return state.entries.find(entry => entry.id === id);
}

function fillSelect(select, options, current) {
  select.innerHTML = options.map(option =>
    `<option value="${esc(option.value)}" ${option.value === current ? "selected" : ""}>${esc(option.label)}</option>`
  ).join("");
}

function openEntryDialog(mode) {
  const entry = entryById(selectedId);
  $("#entryMode").value = mode;
  $("#entryDialogTitle").textContent = {
    create: "新建经验条目",
    rewrite: `改写 ${entry.id}`,
    merge: `合并 ${entry.id}`,
    deprecate: `废弃 ${entry.id}`
  }[mode];
  $("#mergeFields").classList.toggle("hidden", mode !== "merge");
  $("#deprecateFields").classList.toggle("hidden", mode !== "deprecate");
  $("#changeNoteWrap").classList.toggle("hidden", mode === "create");

  const otherEntries = state.entries
    .filter(item => item.status === "active" && item.id !== selectedId)
    .map(item => ({ value: item.id, label: `${item.id} · ${item.title}` }));
  fillSelect($("#mergeTarget"), otherEntries, entry?.mergedInto || "");
  fillSelect($("#supersededBy"), [{ value: "", label: "无承接条目" }, ...otherEntries], entry?.supersededBy || "");

  $("#entryTitle").value = mode === "create" ? "" : entry?.title || "";
  $("#entryBody").value = mode === "create" ? "" : entry?.body || "";
  $("#entryTags").value = mode === "create" ? "" : (entry?.tags || []).join(", ");
  $("#entryNote").value = "";
  $("#deprecateReason").value = entry?.deprecatedReason || "";
  $("#entryDialog").showModal();
}

function openLinkDialog() {
  const options = state.entries
    .filter(entry => entry.id !== selectedId)
    .map(entry => ({ value: entry.id, label: `${entry.id} · ${entry.title}` }));
  fillSelect($("#linkTarget"), options, "");
  fillSelect($("#linkRelation"), Object.entries(RELATIONS).map(([value, meta]) => ({
    value,
    label: meta.label
  })), "related");
  $("#linkNote").value = "";
  $("#linkDialog").showModal();
}

function submitEntryForm(event) {
  event.preventDefault();
  const mode = $("#entryMode").value;
  const title = $("#entryTitle").value.trim();
  const body = $("#entryBody").value;
  const tags = $("#entryTags").value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean);
  const note = $("#entryNote").value.trim();

  try {
    if (mode === "create") {
      const result = createEntry(state, { title, body, tags, note }, now());
      selectedId = result.entry.id;
      commit(result.state, "条目已创建");
    } else if (mode === "rewrite") {
      const result = rewriteEntry(state, selectedId, { title, body, tags, note }, now());
      commit(result.state, "改写已完成，关联影响已重新计算");
    } else if (mode === "merge") {
      const target = $("#mergeTarget").value;
      const result = mergeEntry(state, selectedId, target, { note }, now());
      commit(result.state, `已合并到 ${target}，原关联已标记复核或保留历史关系`);
    } else if (mode === "deprecate") {
      const supersededBy = $("#supersededBy").value;
      const reason = $("#deprecateReason").value.trim() || note;
      const result = deprecateEntry(state, selectedId, { reason, supersededBy, note }, now());
      commit(result.state, "条目已废弃，受影响关系已同步标记");
    }
  } catch (error) {
    toast(error.message);
    return;
  }
  $("#entryDialog").close();
}

function submitLinkForm(event) {
  event.preventDefault();
  try {
    const result = addLink(state, {
      source: selectedId,
      target: $("#linkTarget").value,
      relation: $("#linkRelation").value,
      note: $("#linkNote").value.trim()
    }, now());
    if (result.duplicated) toast("相同关系已经存在");
    else commit(result.state, "显式关联已建立");
  } catch (error) {
    toast(error.message);
    return;
  }
  $("#linkDialog").close();
}

document.addEventListener("click", event => {
  const selectedNode = event.target.closest("[data-select]");
  if (selectedNode) {
    selectedId = selectedNode.dataset.select;
    render();
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    const action = actionButton.dataset.action;
    if (["rewrite", "merge", "deprecate"].includes(action)) openEntryDialog(action);
    if (action === "link") openLinkDialog();
    return;
  }

  const decideButton = event.target.closest("[data-decide]");
  if (decideButton) {
    const payload = decideButton.dataset.decide;
    const action = payload.endsWith(":confirmed") ? "confirmed" : "rejected";
    const [a, b] = payload.replace(/:(confirmed|rejected)$/, "").split(",");
    const result = setCandidateDecision(state, [a, b], action, now());
    commit(result.state, action === "confirmed" ? "关联已确认；后续轻微修订将保持稳定" : "关联已否决；证据未实质变化前不再提示");
    return;
  }

  const reconfirmButton = event.target.closest("[data-reconfirm]");
  if (reconfirmButton) {
    const result = reconfirmLink(state, reconfirmButton.dataset.reconfirm, now());
    commit(result.state, "关联已复核确认");
  }
});

$("#searchInput").addEventListener("input", event => {
  searchTerm = event.target.value;
  renderList();
});
$("#newEntryBtn").addEventListener("click", () => openEntryDialog("create"));
$("#resetBtn").addEventListener("click", () => {
  if (!confirm("恢复内置示例将清除当前浏览器中的本地数据，是否继续？")) return;
  state = seedState();
  selectedId = state.entries[0].id;
  graph = deriveGraph(state);
  localStorage.removeItem(STORAGE_KEY);
  render();
  toast("已恢复示例数据");
});
$("#entryForm").addEventListener("submit", submitEntryForm);
$("#linkForm").addEventListener("submit", submitLinkForm);

render();

function renderStats() {
  $("#statEntries").textContent = state.entries.length;
  $("#statReview").textContent = graph.edges.filter(edge => edge.status === "needs_review").length;
  $("#statConflict").textContent = graph.conflicts.length;
  $("#statCandidate").textContent = graph.candidates.length;
}

function renderList() {
  const term = searchTerm.trim().toLowerCase();
  const entries = state.entries.filter(entry => {
    if (!term) return true;
    return [entry.title, entry.body, entry.tags.join(" ")].some(value =>
      String(value).toLowerCase().includes(term)
    );
  });
  $("#entryList").innerHTML = entries.map(entry => `
    <button class="entry-item ${entry.id === selectedId ? "active" : ""}" data-select="${entry.id}">
      <h3>${esc(entry.id)} · ${esc(entry.title)}</h3>
      <p>${esc(entry.body)}</p>
      <div class="tag-row">
        <span class="badge ${entry.status}">${STATUS_LABELS[entry.status]}</span>
        ${entry.tags.slice(0, 3).map(tag => `<span class="tag">#${esc(tag)}</span>`).join("")}
      </div>
    </button>
  `).join("") || `<div class="empty">没有匹配条目</div>`;
}

function renderDetail() {
  const entry = entryById(selectedId);
  const panel = $("#detailPanel");
  if (!entry) {
    panel.innerHTML = `<div class="empty">请选择或新建一条经验</div>`;
    return;
  }

  const links = graph.edges.filter(edge => edge.source === entry.id || edge.target === entry.id);
  const related = links.sort((a, b) =>
    Number(b.status !== "active") - Number(a.status !== "active") || a.id.localeCompare(b.id)
  );

  panel.innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${esc(entry.id)} · ${esc(entry.title)}</h2>
        <div class="meta">创建：${esc(entry.createdAt)} · 最近更新：${esc(entry.updatedAt)} · 负责人：${esc(entry.createdBy)}</div>
        <span class="badge ${entry.status}">${STATUS_LABELS[entry.status]}</span>
        ${entry.mergedInto ? `<span class="badge merged">并入 ${esc(entry.mergedInto)}</span>` : ""}
        ${entry.supersededBy ? `<span class="badge deprecated">由 ${esc(entry.supersededBy)} 承接</span>` : ""}
      </div>
    </div>
    <div class="action-row">
      <button class="button small" data-action="rewrite">改写</button>
      <button class="button small" data-action="merge">合并</button>
      <button class="button small danger" data-action="deprecate">废弃</button>
      <button class="button small" data-action="link">建立关联</button>
    </div>
    <div class="tag-row">
      ${entry.tags.map(tag => `<span class="tag">#${esc(tag)}</span>`).join("")}
    </div>
    <div class="body-text">${esc(entry.body)}</div>
    ${entry.deprecatedReason ? `<p class="warning-list">废弃原因：${esc(entry.deprecatedReason)}</p>` : ""}
    <h3>关联与状态（${related.length}）</h3>
    <div class="relation-list">
      ${related.map(renderRelationCard).join("") || `<div class="empty">暂无显式或已确认关联</div>`}
    </div>
    ${renderTimeline(entry)}
  `;
}

function renderRelationCard(edge) {
  const otherId = edge.source === selectedId ? edge.target : edge.source;
  const other = entryById(otherId);
  const conflict = edge.conflictIds?.length ? "conflict" : "";
  const meta = RELATIONS[edge.relation] || RELATIONS.related;
  const direction = meta.directed
    ? `${edge.source} → ${meta.label} → ${edge.target}`
    : `${edge.source} ↔ ${meta.label} ↔ ${edge.target}`;
  const reasons = edge.reasons?.length
    ? edge.reasons
    : ["显式建立的关系"];
  return `
    <article class="relation-card ${edge.status} ${conflict}">
      <div class="relation-title">
        <button class="button small" data-select="${otherId}">${esc(otherId)} ${esc(other?.title || "已缺失条目")}</button>
        <span class="tag">${esc(direction)}</span>
        <span class="badge ${edge.status}">${edge.status === "active" ? "有效" : edge.status === "invalid" ? "已失效" : "待复核"}</span>
        ${edge.origin === "decision" ? `<span class="badge confirmed">人工确认</span>` : ""}
        ${conflict ? `<span class="badge conflict">参与冲突</span>` : ""}
      </div>
      <ul class="reason-list">${reasons.map(reason => `<li>${esc(reason)}</li>`).join("")}</ul>
      ${edge.warnings.length ? `<ul class="warning-list">${edge.warnings.map(warning => `<li>${esc(warning)}</li>`).join("")}</ul>` : ""}
      ${edge.status === "needs_review" && edge.origin === "explicit"
        ? `<div class="action-row"><button class="button small primary" data-reconfirm="${edge.id}">复核后确认仍成立</button></div>`
        : ""}
    </article>
  `;
}

function renderTimeline(entry) {
  const revisions = [...(entry.revisions || [])].reverse();
  return `
    <div class="timeline">
      <h3>修订记录（${revisions.length}）</h3>
      ${revisions.map(revision => `
        <div class="revision">
          <strong>${esc(actionLabel(revision.action))}</strong>
          <div class="meta">${esc(revision.at)} · ${esc(revision.by || "系统")} · ${esc(revision.id)}</div>
          <div>${esc(revision.note || "")}</div>
          ${revision.impact ? renderImpactSummary(revision.impact) : ""}
        </div>
      `).join("")}
    </div>
  `;
}

function actionLabel(action) {
  return {
    create: "创建",
    rewrite: "改写",
    merge: "合并",
    receive_merge: "接收合并",
    deprecate: "废弃",
    reconfirm_link: "复核关联"
  }[action] || action;
}

function renderCandidates() {
  $("#candidatePanel").innerHTML = graph.candidates.map(candidate => `
    <article class="candidate-card">
      <div class="relation-title">
        <button class="button small" data-select="${candidate.pair[0]}">${esc(candidate.pair[0])}</button>
        <span class="muted">⇄</span>
        <button class="button small" data-select="${candidate.pair[1]}">${esc(candidate.pair[1])}</button>
        <span class="tag">匹配 ${Math.round(candidate.score * 100)}%</span>
      </div>
      <ul class="reason-list">
        ${candidate.reasons.map(reason => `<li>${esc(reason)}</li>`).join("")}
      </ul>
      <div class="action-row">
        <button class="button small primary" data-decide="${candidate.pair.join(",")}:confirmed">确认关联</button>
        <button class="button small" data-decide="${candidate.pair.join(",")}:rejected">否决</button>
      </div>
    </article>
  `).join("") || `<div class="empty">暂无新的潜在关联；确认结果会在未实质变化时保持稳定。</div>`;
}

function renderConflicts() {
  $("#conflictPanel").innerHTML = graph.conflicts.map(conflict => {
    const edges = conflict.edgeIds
      .map(id => graph.edges.find(edge => edge.id === id))
      .filter(Boolean);
    return `
      <article class="conflict-card">
        <div class="relation-title">
          <button class="button small" data-select="${conflict.pair[0]}">${esc(conflict.pair[0])}</button>
          <span class="muted">⇄</span>
          <button class="button small" data-select="${conflict.pair[1]}">${esc(conflict.pair[1])}</button>
        </div>
        <p>${esc(conflict.reason)}</p>
        <ul class="reason-list">
          ${edges.map(edge => {
            const meta = RELATIONS[edge.relation] || RELATIONS.related;
            return `<li>${esc(edge.source)} → ${meta.label} → ${esc(edge.target)}：${esc(edge.note || edge.reasons[0] || "无说明")}</li>`;
          }).join("")}
        </ul>
        <p class="muted">系统保留双方关系，不会静默丢弃，需要团队裁决。</p>
      </article>
    `;
  }).join("") || `<div class="empty">当前没有冲突关系。</div>`;
}

function renderImpactSummary(impact) {
  const invalid = impact.edgeChanges.filter(change => change.after?.status === "invalid").length;
  const review = impact.edgeChanges.filter(change => change.after?.status === "needs_review").length;
  const items = [
    invalid && `${invalid} 条失效`,
    review && `${review} 条待复核`,
    impact.conflictsAdded.length && `新增 ${impact.conflictsAdded.length} 组冲突`,
    impact.conflictsResolved.length && `解除 ${impact.conflictsResolved.length} 组冲突`,
    impact.candidateChanges.length && `${impact.candidateChanges.length} 个潜在关联变化`
  ].filter(Boolean);
  return items.length ? `<div class="tag-row">${items.map(item => `<span class="tag">${esc(item)}</span>`).join("")}</div>` : "";
}

function renderImpactDetail(impact) {
  const lines = [];
  for (const change of impact.edgeChanges.slice(0, 5)) {
    const edge = change.after || change.before;
    const targetTitle = entryById(edge.target)?.title || edge.target;
    if (change.kind === "added") lines.push(`新增关联到 ${edge.target}（${targetTitle}）`);
    if (change.kind === "removed") lines.push(`移除与 ${edge.target} 的关联`);
    if (change.kind === "status") lines.push(`${edge.target} 关联状态变为${change.after.status === "invalid" ? "失效" : "待复核"}`);
  }
  impact.conflictsAdded.forEach(pair => lines.push(`新增冲突：${pair.join(" / ")}`));
  impact.conflictsResolved.forEach(pair => lines.push(`冲突解除：${pair.join(" / ")}`));
  impact.candidateChanges.forEach(change => {
    const label = change.pair.join(" / ");
    if (change.kind === "new") lines.push(`出现新潜在关联：${label}`);
    if (change.kind === "lost") lines.push(`潜在关联证据消失：${label}`);
    if (change.kind === "score") lines.push(`潜在关联强度由 ${Math.round(change.before * 100)}% 变为 ${Math.round(change.after * 100)}%：${label}`);
  });
  return `<ul>${lines.slice(0, 8).map(line => `<li>${esc(line)}</li>`).join("") || "<li>无关联状态变化</li>"}</ul>`;
}

function renderImpacts() {
  const revisionsWithImpact = state.entries
    .flatMap(entry => (entry.revisions || []).map(revision => ({ entry, revision })))
    .filter(item => item.revision.impact)
    .sort((a, b) => b.revision.at.localeCompare(a.revision.at))
    .slice(0, 8);

  $("#impactPanel").innerHTML = `<div class="impact-grid">
    ${revisionsWithImpact.map(({ entry, revision }) => `
      <article class="impact-card">
        <h4>${esc(entry.id)} · ${esc(actionLabel(revision.action))} · ${esc(revision.at.slice(0, 16).replace("T", " "))}</h4>
        ${renderImpactDetail(revision.impact)}
      </article>
    `).join("") || `<div class="empty">完成修订后，这里会显示受牵动的条目、关联和冲突。</div>`}
  </div>`;
}

function renderGraph() {
  $("#graphLegend").innerHTML = [
    ["有效", "active"], ["待复核", "needs_review"], ["失效", "invalid"], ["冲突", "conflict"]
  ].map(([label, cls]) => `<span class="badge ${cls}">${label}</span>`).join("");

  const width = 620, height = 390, centerX = width / 2, centerY = height / 2, radius = 145;
  const positions = new Map(state.entries.map((entry, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / Math.max(state.entries.length, 1);
    return [entry.id, {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle)
    }];
  }));

  const edgeMarkup = graph.edges.map(edge => {
    const a = positions.get(edge.source);
    const b = positions.get(edge.target);
    if (!a || !b) return "";
    const cls = edge.conflictIds?.length ? "conflict" : edge.status;
    const meta = RELATIONS[edge.relation] || RELATIONS.related;
    return `
      <g>
        <line class="svg-edge ${cls}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"
          marker-end="url(#arrow-${edge.relation})" data-select="${edge.source}"></line>
        <text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 4}" text-anchor="middle"
          class="svg-edge-label">${meta.label}</text>
      </g>`;
  }).join("");

  const nodeMarkup = state.entries.map(entry => {
    const point = positions.get(entry.id);
    return `
      <g class="svg-node ${entry.status} ${entry.id === selectedId ? "selected" : ""}" data-select="${entry.id}">
        <circle cx="${point.x}" cy="${point.y}" r="30"></circle>
        <text x="${point.x}" y="${point.y - 2}" text-anchor="middle">${esc(entry.id)}</text>
        <text x="${point.x}" y="${point.y + 12}" text-anchor="middle">${esc(entry.title.slice(0, 5))}</text>
      </g>`;
  }).join("");

  const arrows = Object.keys(RELATIONS).map(relation => `
    <marker id="arrow-${relation}" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#667085"></path>
    </marker>
  `).join("");

  $("#graphSvg").innerHTML = `<svg viewBox="0 0 ${width} ${height}">
    <defs>${arrows}</defs>${edgeMarkup}${nodeMarkup}
  </svg>`;
}

function render() {
  renderStats();
  renderList();
  renderDetail();
  renderCandidates();
  renderConflicts();
  renderImpacts();
  renderGraph();
}
