/* 年度预算分配推演台 —— 纯前端离线实现
 * 分配是输入的纯函数：每次任何修改都整体重新推导，
 * 因此锁定/排除后的结果与从头完整推导必然一致。
 */

"use strict";

// ---------- 状态 ----------
let state = {
  budget: 1000,
  projects: [], // {id, name, request, priority, min, prereqs:[id], locked:null|number, excluded:bool}
  nextSeq: 1,
};
let prevAllocation = {}; // id -> amount，用于变化高亮

function makeId(seq) { return "P" + seq; }

function addProject(data) {
  const p = Object.assign({
    id: makeId(state.nextSeq++),
    name: "新项目",
    request: 100,
    priority: 1,
    min: 0,
    prereqs: [],
    locked: null,
    excluded: false,
  }, data || {});
  state.projects.push(p);
  return p;
}

// ---------- 冲突检测 ----------

// 依赖闭环检测（Kahn 拓扑：无法入拓扑序的节点即在环上或依赖环）
function detectCycleProjects(projects) {
  const ids = new Set(projects.map(p => p.id));
  const indeg = {};
  const dependents = {}; // prereq -> [project]
  projects.forEach(p => {
    indeg[p.id] = 0;
    dependents[p.id] = [];
  });
  projects.forEach(p => {
    p.prereqs.forEach(q => {
      if (ids.has(q)) {
        indeg[p.id]++;
        dependents[q].push(p.id);
      }
    });
  });
  const queue = Object.keys(indeg).filter(id => indeg[id] === 0);
  const done = new Set();
  while (queue.length) {
    const id = queue.shift();
    done.add(id);
    dependents[id].forEach(d => {
      indeg[d]--;
      if (indeg[d] === 0) queue.push(d);
    });
  }
  return projects.filter(p => !done.has(p.id)).map(p => p.id);
}

// ---------- 分配推导（第一部分：冲突检测与锁定扣除） ----------
function deriveAllocation(budget, projects) {
  const conflicts = [];
  const allocation = {};
  const constraints = {};
  const byId = {};
  projects.forEach(p => { byId[p.id] = p; allocation[p.id] = 0; });

  // 1. 依赖闭环
  const cycleIds = new Set(detectCycleProjects(projects));
  if (cycleIds.size > 0) {
    const names = [...cycleIds].map(id => byId[id].name + "(" + id + ")").join("、");
    conflicts.push({
      type: "cycle",
      message: "前置依赖形成闭环，以下项目无法进入可分配状态：" + names,
      projects: [...cycleIds],
    });
  }

  // 2. 排除与锁定
  let remaining = budget;
  projects.forEach(p => {
    if (p.excluded) {
      constraints[p.id] = { type: "excluded", detail: "已被手工排除" };
    } else if (cycleIds.has(p.id)) {
      constraints[p.id] = { type: "cycle", detail: "前置依赖闭环" };
    }
  });
  const lockedProjects = projects.filter(p => !p.excluded && !cycleIds.has(p.id) && p.locked !== null);
  lockedProjects.forEach(p => {
    allocation[p.id] = p.locked;
    remaining -= p.locked;
    constraints[p.id] = { type: "locked", detail: "手工锁定为 " + p.locked + " 万元" };
  });
  if (remaining < 0) {
    conflicts.push({
      type: "locked-over",
      message: "锁定金额合计已超出总资金上限 " + budget + " 万元（超出 " + (-remaining) + " 万元）："
        + lockedProjects.map(p => p.name + "(" + p.id + ")").join("、"),
      projects: lockedProjects.map(p => p.id),
    });
    remaining = 0;
  }

  // 3. 最低投入之和检查（针对可参与分配的项目）
  const participants = projects.filter(p => !p.excluded && !cycleIds.has(p.id));
  const minSum = participants.reduce((s, p) => s + (p.locked !== null ? p.locked : p.min), 0);
  if (minSum > budget) {
    conflicts.push({
      type: "min-over",
      message: "最低投入（含锁定金额）合计 " + minSum + " 万元，已超过可用资金 " + budget
        + " 万元，必有项目无法满足最低投入。",
      projects: participants.map(p => p.id),
    });
  }
  // 4. 贪心推导：前置足额才解锁，按优先级从高到低，资金须够最低投入
  const isFullyFunded = id => allocation[id] >= byId[id].request;
  const pending = participants.filter(p => p.locked === null);
  const allocatedSet = new Set(lockedProjects.map(p => p.id));

  let progress = true;
  while (progress) {
    progress = false;
    // 当前可分配：未处理、前置全部足额
    const eligible = pending.filter(p =>
      !allocatedSet.has(p.id) && p.prereqs.every(q => !byId[q] || isFullyFunded(q)));
    if (eligible.length === 0) break;
    // 优先级高者优先；并列时按编号稳定排序，保证确定性
    eligible.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    for (const p of eligible) {
      if (p.min > remaining) continue; // 剩余资金不够最低投入，跳过本轮
      const give = Math.min(p.request, remaining);
      allocation[p.id] = give;
      remaining -= give;
      allocatedSet.add(p.id);
      progress = true;
      break; // 重新评估解锁情况，保证依赖链按顺序展开
    }
  }

  // 5. 为未足额项目标注主要约束
  participants.forEach(p => {
    if (constraints[p.id] && constraints[p.id].type === "locked") return;
    const got = allocation[p.id];
    if (got >= p.request) {
      constraints[p.id] = { type: "none", detail: "已足额满足" };
    } else if (got > 0) {
      constraints[p.id] = { type: "budget", detail: "受总资金上限限制" };
    } else {
      const unmet = p.prereqs.filter(q => byId[q] && !isFullyFunded(q));
      if (unmet.length > 0) {
        constraints[p.id] = {
          type: "prereq",
          detail: "前置未足额：" + unmet.map(q => byId[q].name + "(" + q + ")").join("、"),
        };
      } else if (p.min > remaining && p.min > 0) {
        constraints[p.id] = { type: "min", detail: "剩余资金不足最低投入 " + p.min + " 万元" };
      } else {
        constraints[p.id] = { type: "budget", detail: "受总资金上限限制" };
      }
    }
  });
  projects.forEach(p => { if (!constraints[p.id]) constraints[p.id] = { type: "none", detail: "" }; });

  // 6. 汇总无法满足的项目（明确标出，不静默跳过）
  const unsatisfied = participants.filter(p => allocation[p.id] < p.min);
  if (unsatisfied.length > 0 && !conflicts.some(c => c.type === "min-over")) {
    conflicts.push({
      type: "unsatisfied",
      message: "以下项目未达到最低投入：" + unsatisfied.map(p =>
        p.name + "(" + p.id + "，需 " + p.min + "，得 " + allocation[p.id] + ")").join("、"),
      projects: unsatisfied.map(p => p.id),
    });
  }

  return { allocation, constraints, conflicts };
}
// ---------- 渲染 ----------
const tbody = document.getElementById("projectTbody");
const budgetInput = document.getElementById("budgetInput");

const CONSTRAINT_LABELS = {
  none: "constraint-none",
  budget: "constraint-budget",
  prereq: "constraint-prereq",
  locked: "constraint-locked",
  excluded: "constraint-excluded",
  cycle: "constraint-cycle",
  min: "constraint-min",
};

function render() {
  const result = deriveAllocation(state.budget, state.projects);

  // 顶部统计
  const totalAllocated = Object.values(result.allocation).reduce((a, b) => a + b, 0);
  document.getElementById("statAllocated").textContent = totalAllocated;
  document.getElementById("statRemaining").textContent = state.budget - totalAllocated;
  document.getElementById("statCount").textContent = state.projects.length;

  // 冲突面板
  const panel = document.getElementById("conflictPanel");
  const list = document.getElementById("conflictList");
  list.innerHTML = "";
  if (result.conflicts.length > 0) {
    panel.classList.remove("hidden");
    result.conflicts.forEach(c => {
      const li = document.createElement("li");
      li.textContent = c.message;
      list.appendChild(li);
    });
  } else {
    panel.classList.add("hidden");
  }

  // 项目表格
  tbody.innerHTML = "";
  const conflictIds = new Set();
  result.conflicts.forEach(c => c.projects.forEach(id => conflictIds.add(id)));

  state.projects.forEach(p => {
    const tr = document.createElement("tr");
    if (p.excluded) tr.classList.add("row-excluded");
    if (conflictIds.has(p.id)) tr.classList.add("row-conflict");

    const alloc = result.allocation[p.id];
    const sat = p.request > 0 ? Math.round(100 * alloc / p.request) : (alloc > 0 ? 100 : 0);
    const cons = result.constraints[p.id];

    const prev = prevAllocation[p.id];
    const changed = prev !== undefined && prev !== alloc;
    let deltaHtml = "";
    if (changed) {
      const d = alloc - prev;
      deltaHtml = d > 0
        ? '<span class="delta-up">▲+' + d + "</span>"
        : '<span class="delta-down">▼' + d + "</span>";
    }

    let barClass = "sat-bar";
    if (sat <= 0) barClass += " none";
    else if (sat < 100) barClass += " partial";

    tr.innerHTML =
      "<td>" + p.id + "</td>" +
      '<td><input class="name-input" data-field="name" data-id="' + p.id + '" value="' + escapeHtml(p.name) + '"></td>' +
      '<td><input type="number" min="0" data-field="request" data-id="' + p.id + '" value="' + p.request + '"></td>' +
      '<td><input type="number" data-field="priority" data-id="' + p.id + '" value="' + p.priority + '"></td>' +
      '<td><input type="number" min="0" data-field="min" data-id="' + p.id + '" value="' + p.min + '"></td>' +
      '<td><input class="prereq-input" data-field="prereqs" data-id="' + p.id + '" value="' + p.prereqs.join(",") + '" placeholder="如 P1,P2"></td>' +
      '<td><input type="number" min="0" class="locked-input" data-field="locked" data-id="' + p.id + '" value="' + (p.locked === null ? "" : p.locked) + '" placeholder="不锁定"></td>' +
      '<td><input type="checkbox" data-field="excluded" data-id="' + p.id + '"' + (p.excluded ? " checked" : "") + "></td>" +
      '<td class="alloc-cell' + (changed ? " alloc-changed" : "") + '">' + alloc + deltaHtml + "</td>" +
      '<td><div class="sat-bar-wrap"><div class="' + barClass + '" style="width:' + Math.min(100, sat) + '%"></div></div>' +
      '<div class="sat-label">' + sat + "%</div></td>" +
      '<td><span class="constraint-tag ' + CONSTRAINT_LABELS[cons.type] + '">' + escapeHtml(cons.detail) + "</span></td>" +
      '<td><button class="del-btn" data-del="' + p.id + '">删除</button></td>';
    tbody.appendChild(tr);
  });

  prevAllocation = Object.assign({}, result.allocation);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
// ---------- 交互 ----------
function findProject(id) { return state.projects.find(p => p.id === id); }

// 输入即时生效：change 事件在失焦/回车时触发，保证界面立刻反映新推导
tbody.addEventListener("change", e => {
  const field = e.target.dataset.field;
  const id = e.target.dataset.id;
  if (!field || !id) return;
  const p = findProject(id);
  if (!p) return;
  if (field === "name") {
    p.name = e.target.value.trim() || p.name;
  } else if (field === "request" || field === "priority" || field === "min") {
    const v = Number(e.target.value);
    if (isNaN(v) || v < 0) { e.target.classList.add("invalid"); return; }
    p[field] = v;
  } else if (field === "prereqs") {
    const ids = e.target.value.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
    const valid = ids.filter(q => state.projects.some(x => x.id === q) && q !== p.id);
    if (valid.length !== ids.length) e.target.classList.add("invalid");
    p.prereqs = valid;
  } else if (field === "locked") {
    const raw = e.target.value.trim();
    if (raw === "") {
      p.locked = null;
    } else {
      const v = Number(raw);
      if (isNaN(v) || v < 0) { e.target.classList.add("invalid"); return; }
      p.locked = v;
    }
  } else if (field === "excluded") {
    p.excluded = e.target.checked;
  }
  render();
});

tbody.addEventListener("click", e => {
  const id = e.target.dataset.del;
  if (!id) return;
  state.projects = state.projects.filter(p => p.id !== id);
  // 删除后清理其他项目对它的前置引用
  state.projects.forEach(p => { p.prereqs = p.prereqs.filter(q => q !== id); });
  render();
});

budgetInput.addEventListener("change", () => {
  const v = Number(budgetInput.value);
  if (isNaN(v) || v < 0) { budgetInput.classList.add("invalid"); return; }
  budgetInput.classList.remove("invalid");
  state.budget = v;
  render();
});

document.getElementById("addProjectBtn").addEventListener("click", () => {
  addProject();
  render();
});

document.getElementById("clearAllBtn").addEventListener("click", () => {
  if (!confirm("确定清空全部项目？")) return;
  state.projects = [];
  state.nextSeq = 1;
  prevAllocation = {};
  render();
});

document.getElementById("loadSampleBtn").addEventListener("click", () => {
  state.projects = [];
  state.nextSeq = 1;
  prevAllocation = {};
  state.budget = 1000;
  budgetInput.value = 1000;
  addProject({ name: "核心平台升级", request: 400, priority: 5, min: 200, prereqs: [] });
  addProject({ name: "数据中台一期", request: 300, priority: 4, min: 150, prereqs: ["P1"] });
  addProject({ name: "移动端改版", request: 250, priority: 3, min: 100, prereqs: [] });
  addProject({ name: "智能客服试点", request: 200, priority: 2, min: 80, prereqs: ["P2"] });
  addProject({ name: "办公自动化", request: 150, priority: 1, min: 50, prereqs: [] });
  render();
});

// ---------- 初始化 ----------
budgetInput.value = state.budget;
document.getElementById("loadSampleBtn").click();
