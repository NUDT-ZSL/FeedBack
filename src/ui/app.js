import { sampleData } from "../data/sampleData.js";
import { commitReplayCache, createSimulationCache, replayIncrementally } from "../engine/incremental.js";
import { stableHash } from "../engine/utils.js";

const editor = document.querySelector("#editor");
const parseState = document.querySelector("#parseState");
const startIndexEl = document.querySelector("#startIndex");
const reuseInfoEl = document.querySelector("#reuseInfo");
const finalHashEl = document.querySelector("#finalHash");
const consistencyEl = document.querySelector("#consistency");
const issuesEl = document.querySelector("#issues");
const unitsEl = document.querySelector("#units");
const timelineEl = document.querySelector("#timeline");

let baselineInput = structuredClone(sampleData);
let cache = createSimulationCache(baselineInput);
let lastInput = baselineInput;
let lastResult = cache.full;

editor.value = JSON.stringify(sampleData, null, 2);

document.querySelector("#runButton").addEventListener("click", () => run(false));
document.querySelector("#verifyButton").addEventListener("click", () => run(true));
document.querySelector("#baselineButton").addEventListener("click", () => {
  cache = createSimulationCache(lastInput);
  baselineInput = structuredClone(lastInput);
  lastResult = cache.full;
  render(lastResult, { baseline: true });
});
document.querySelector("#sampleButton").addEventListener("click", () => {
  const data = structuredClone(sampleData);
  editor.value = JSON.stringify(data, null, 2);
  baselineInput = data;
  cache = createSimulationCache(data);
  lastInput = data;
  lastResult = cache.full;
  render(lastResult, { baseline: true });
});
document.querySelector("#exportButton").addEventListener("click", exportData);
document.querySelector("#importButton").addEventListener("click", () => fileInput.click());
const fileInput = document.querySelector("#fileInput");
fileInput.addEventListener("change", importFile);
editor.addEventListener("input", () => {
  parseState.textContent = "已修改，尚未结算";
});

function run(verify) {
  try {
    const input = JSON.parse(editor.value);
    lastInput = input;
    parseState.textContent = `JSON 有效 · 输入哈希 ${stableHash(input)}`;
    const result = replayIncrementally(cache, input, { verify });
    lastResult = result;
    cache = commitReplayCache(input, result);
    render(result, { verify, baseline: false });
  } catch (error) {
    parseState.textContent = `JSON 无法解析：${error.message}`;
  }
}

function exportData() {
  const blob = new Blob([JSON.stringify(lastInput, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "battle-input.json";
  link.click();
  URL.revokeObjectURL(url);
}

function importFile() {
  const file = fileInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    editor.value = reader.result;
    run(false);
  };
  reader.readAsText(file, "utf-8");
}

function render(result, { verify, baseline }) {
  startIndexEl.textContent = baseline ? "全量基线" : `行动 #${result.start + 1}`;
  reuseInfoEl.textContent = baseline
    ? `${(lastInput.actions || []).length} / 0`
    : `${result.reusedActions} / ${result.recomputedActions}`;
  finalHashEl.textContent = result.finalHash || stableHash(result.finalState);

  if (baseline) {
    consistencyEl.textContent = "已建立基线";
    consistencyEl.className = "muted";
  } else if (verify) {
    consistencyEl.textContent = result.verification?.equal ? "一致" : "不一致";
    consistencyEl.className = result.verification?.equal ? "ok" : "bad";
  } else {
    consistencyEl.textContent = "未全量验证";
    consistencyEl.className = "muted";
  }

  renderIssues(result.validation?.issues || result.validation?.issues || []);
  renderUnits(result.finalState.units);
  renderTimeline(result.events);
}

function renderIssues(issues) {
  issuesEl.innerHTML = "";
  for (const issue of issues) {
    const row = document.createElement("div");
    row.className = `issue ${issue.level}`;
    row.textContent = `[${issue.code}] ${issue.message}（${issue.path}）`;
    issuesEl.appendChild(row);
  }
  if (!issues.length) {
    const row = document.createElement("div");
    row.className = "issue";
    row.style.borderColor = "#2b5a3b";
    row.style.background = "#14251a";
    row.style.color = "#9ad69a";
    row.textContent = "未发现规则引用或循环依赖问题。";
    issuesEl.appendChild(row);
  }
}

function renderUnits(units) {
  unitsEl.innerHTML = "";
  for (const unit of units) {
    const card = document.createElement("article");
    card.className = "unit-card";
    const title = document.createElement("div");
    title.className = "unit-title";
    title.innerHTML = `<span>${escapeHtml(unit.name || unit.id)}</span><span class="muted">${unit.team || ""}</span>`;
    const hp = document.createElement("div");
    hp.className = "hp";
    hp.textContent = `HP ${Math.max(0, unit.hp)} / ${unit.maxHp}${unit.hp <= 0 ? "（已阵亡）" : ""}`;
    const statuses = document.createElement("div");
    statuses.className = "statuses";
    for (const status of unit.statuses || []) {
      const pill = document.createElement("span");
      pill.className = "pill";
      const remaining = status.kind === "shield" ? `，剩余 ${status.remaining}` : "";
      const durationText = status.duration === null || status.duration === undefined ? "永久" : `${status.duration} 回合`;
      pill.textContent = `${status.name} ×${status.stacks}，${durationText}${remaining}`;
      statuses.appendChild(pill);
    }
    if (!unit.statuses?.length) statuses.textContent = "无状态";
    card.append(title, hp, statuses);
    unitsEl.appendChild(card);
  }
}

function renderTimeline(events) {
  timelineEl.innerHTML = "";
  for (const event of events) {
    const card = document.createElement("article");
    card.className = "event-card";
    if (event.kind === "initial") {
      card.innerHTML = `<div class="event-head"><strong>初始状态</strong><span class="tag">检查点</span></div>`;
    } else if (event.kind === "action") {
      const actor = event.action.actorId || "未知";
      const target = event.action.targetId || "未知";
      const skill = lastInput.skills?.[event.action.skillId]?.name || event.action.skillId || "未知技能";
      const hit = event.steps.find((step) => step.type === "hit-check");
      const damage = event.steps.find((step) => step.type === "damage-resolved");
      const effects = event.steps.filter((step) => step.type === "effect-applied").length;
      card.innerHTML = `
        <div class="event-head">
          <strong>#${event.actionIndex + 1} 回合 ${event.turn}：${escapeHtml(actor)} → ${escapeHtml(target)} · ${escapeHtml(skill)}</strong>
          <span class="tag">${event.skipped ? "跳过" : hit?.hit ? "命中" : "未命中"} · 伤害 ${damage?.amount ?? 0} · 状态 ${effects}</span>
        </div>
        ${renderContributions(damage)}
      `;
    } else {
      card.innerHTML = `<div class="event-head"><strong>回合 ${event.turn} 结束</strong><span class="tag">持续效果 / 衰减 / 移除</span></div>`;
    }
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "查看完整可追溯步骤";
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(sanitizeEvent(event), null, 2);
    details.append(summary, pre);
    card.appendChild(details);
    timelineEl.appendChild(card);
  }
}

function renderContributions(damage) {
  if (!damage) return "<p class='muted'>本行动没有伤害结算。</p>";
  return damage.stages.map((stage) => {
    const rows = stage.contributions.length
      ? stage.contributions.map((row) => {
        const unit = stage.stage === "shield" ? row.value : `${row.value}%`;
        const stacks = row.stacks > 1 ? ` ×${row.stacks}` : "";
        return `<li>P${row.priority ?? "-"} ${escapeHtml(row.source)}${stacks}：${unit}，变化 ${row.delta} → ${row.amountAfter ?? "-"}</li>`;
      }).join("")
      : "<li class='muted'>无来源</li>";
    return `<h3>${stage.label}：${stage.before} → ${stage.after}</h3><ul>${rows}</ul>`;
  }).join("");
}

function sanitizeEvent(event) {
  const copy = { ...event };
  delete copy.stateBefore;
  return copy;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch]));
}

render(cache.full, { baseline: true });
