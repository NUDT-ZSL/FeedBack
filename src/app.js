import { DEFAULT_PARAMS, applyParameters, readParameters } from "./defaults.js";
import { generateDungeon } from "./dungeon.js";
import { clearMap, renderDungeon } from "./render.js";

const form = document.querySelector("#controls-form");
const canvas = document.querySelector("#map-canvas");
const statusBox = document.querySelector("#status");
const summaryBox = document.querySelector("#summary");
const targetList = document.querySelector("#target-list");
const seedOutput = document.querySelector("#seed-output");

function showError(error) {
  const detail = error.errors?.length ? error.errors.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : "";
  statusBox.className = "status error";
  statusBox.innerHTML = `<strong>${escapeHtml(error.name === "ValidationError" ? "参数不合法，未生成新地图" : "生成约束失败")}</strong>${detail ? `<ul>${detail}</ul>` : `<p>${escapeHtml(error.message)}</p>`}`;
}

function showSuccess(dungeon) {
  if (dungeon.violations.length) {
    statusBox.className = "status warning";
    statusBox.innerHTML = `<strong>已生成，但有约束被破坏</strong><ul>${
      dungeon.violations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
    }</ul>`;
  } else {
    statusBox.className = "status ok";
    statusBox.innerHTML = "<strong>生成成功：</strong>所有目标均可从出生点经普通地面或草地到达。";
  }
}

function renderSummary(dungeon) {
  const s = dungeon.summary;
  summaryBox.innerHTML = [
    ["房间数", s.roomCount],
    ["走廊数", s.corridorCount],
    ["目标可达比例", s.reachableTargetRatio],
    ["不可达区域格数", dungeon.unreachableTiles.length],
    ["不可达目标数", s.targetCount - s.reachableTargetCount],
    ["实际地面/草地/水域", `${s.terrain.floorPercent}% / ${s.terrain.grassPercent}% / ${s.terrain.waterPercent}%`],
  ].map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`).join("");
  seedOutput.textContent = `${s.seed || "(空种子)"} → #${s.numericSeed.toString(16).padStart(8, "0")}`;

  targetList.innerHTML = dungeon.targets.map((target) => {
    const state = target.reachable ? "可达" : "不可达";
    return `<li class="${target.reachable ? "reachable" : "unreachable"}">
      <strong>${target.id}</strong>
      <span>${state}</span>
      <span>位置 X:${target.x + 1}, Y:${target.y + 1}</span>
    </li>`;
  }).join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]);
}

function regenerate() {
  summaryBox.innerHTML = "";
  targetList.innerHTML = "";
  seedOutput.textContent = "-";
  try {
    const dungeon = generateDungeon(readParameters(form));
    renderDungeon(canvas, dungeon);
    renderSummary(dungeon);
    showSuccess(dungeon);
  } catch (error) {
    clearMap(canvas);
    showError(error);
  }
}

document.querySelector("#random-seed").addEventListener("click", () => {
  form.elements.seed.value = `seed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  regenerate();
});

document.querySelector("#reset-params").addEventListener("click", () => {
  applyParameters(form, DEFAULT_PARAMS);
  regenerate();
});

form.addEventListener("input", regenerate);
form.addEventListener("submit", (event) => {
  event.preventDefault();
  regenerate();
});

applyParameters(form, DEFAULT_PARAMS);
regenerate();
