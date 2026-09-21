"use strict";

// ---------- 状态与示例数据 ----------
const state = {
  locations: [
    { id: 1, name: "华东仓", on_hand: 1200, in_transit: 300, safety_stock: 500, demand: 1400 },
    { id: 2, name: "华北仓", on_hand: 900,  in_transit: 100, safety_stock: 400, demand: 500 },
    { id: 3, name: "华南仓", on_hand: 600,  in_transit: 0,   safety_stock: 350, demand: 900 },
    { id: 4, name: "西南仓", on_hand: 1500, in_transit: 200, safety_stock: 400, demand: 600 },
    { id: 5, name: "东北仓", on_hand: 300,  in_transit: 50,  safety_stock: 200, demand: 450 },
    { id: 6, name: "西北仓", on_hand: 800,  in_transit: 0,   safety_stock: 250, demand: 300 },
  ],
  distances: [
    [0, 1100, 1200, 1700, 2100, 2400],
    [1100, 0, 1900, 1500, 900, 1600],
    [1200, 1900, 0, 1300, 2800, 2200],
    [1700, 1500, 1300, 0, 2600, 1200],
    [2100, 900, 2800, 2600, 0, 2000],
    [2400, 1600, 2200, 1200, 2000, 0],
  ],
  weights: { freight_per_km: 0.8, time_weight: 50, speed_km_per_day: 600 },
};

let nextId = 7;
let prevPlan = null;
let recalcTimer = null;
const rowRefs = {}; // locId -> {tr, cells...}

const STATUS_LABEL = {
  shortage: "缺货中",
  covered: "缺口已覆盖",
  supporting: "支援调出",
  surplus: "盈余",
  balanced: "平衡",
};

const $ = (sel) => document.querySelector(sel);

function num(v) {
  const x = parseFloat(v);
  return Number.isFinite(x) && x >= 0 ? x : 0;
}

// ---------- 地点表格 ----------
function buildLocTable() {
  const tbody = $("#loc-table tbody");
  tbody.innerHTML = "";
  for (const key of Object.keys(rowRefs)) delete rowRefs[key];
  for (const loc of state.locations) {
    const tr = document.createElement("tr");
    tr.dataset.locId = loc.id;
    const fields = [
      ["name", "text"], ["on_hand", "number"], ["in_transit", "number"],
      ["safety_stock", "number"], ["demand", "number"],
    ];
    let html = "";
    for (const [field, type] of fields) {
      html += `<td><input type="${type}" data-field="${field}" data-id="${loc.id}"`;
      if (type === "number") html += ' min="0" step="1"';
      html += ` value="${loc[field]}"></td>`;
    }
    html += `<td data-c="net"></td><td data-c="gap"></td><td data-c="supply"></td>
      <td data-c="sent"></td><td data-c="received"></td>
      <td data-c="status"></td>
      <td><button type="button" class="del" data-del="${loc.id}">删除</button></td>`;
    tr.innerHTML = html;
    tbody.appendChild(tr);
    rowRefs[loc.id] = {
      tr,
      net: tr.querySelector('[data-c="net"]'),
      gap: tr.querySelector('[data-c="gap"]'),
      supply: tr.querySelector('[data-c="supply"]'),
      sent: tr.querySelector('[data-c="sent"]'),
      received: tr.querySelector('[data-c="received"]'),
      status: tr.querySelector('[data-c="status"]'),
    };
  }
}

$("#loc-table").addEventListener("input", (e) => {
  const t = e.target;
  if (!t.dataset.field) return;
  const loc = state.locations.find((l) => l.id === Number(t.dataset.id));
  if (!loc) return;
  loc[t.dataset.field] = t.dataset.field === "name" ? t.value : num(t.value);
  scheduleRecalc();
});

$("#loc-table").addEventListener("click", (e) => {
  const id = e.target.dataset && e.target.dataset.del;
  if (!id) return;
  const idx = state.locations.findIndex((l) => l.id === Number(id));
  if (idx < 0) return;
  state.locations.splice(idx, 1);
  state.distances.splice(idx, 1);
  state.distances.forEach((row) => row.splice(idx, 1));
  buildLocTable();
  buildMatrix();
  scheduleRecalc();
});

// ---------- 距离矩阵与权重 ----------
function buildMatrix() {
  const box = $("#dist-matrix");
  const n = state.locations.length;
  let html = "<table><thead><tr><th>从 \\ 到</th>";
  for (const loc of state.locations) html += `<th>${loc.name}</th>`;
  html += "</tr></thead><tbody>";
  for (let i = 0; i < n; i++) {
    html += `<tr><th>${state.locations[i].name}</th>`;
    for (let j = 0; j < n; j++) {
      if (i === j) {
        html += '<td class="diag">—</td>';
      } else {
        html += `<td><input type="number" min="0" step="10" data-d="${i},${j}"
          value="${state.distances[i][j]}"></td>`;
      }
    }
    html += "</tr>";
  }
  box.innerHTML = html + "</tbody></table>";
}

$("#dist-matrix").addEventListener("input", (e) => {
  const d = e.target.dataset && e.target.dataset.d;
  if (!d) return;
  const [i, j] = d.split(",").map(Number);
  const v = num(e.target.value);
  state.distances[i][j] = v;
  state.distances[j][i] = v; // 对称联动
  const mirror = document.querySelector(`[data-d="${j},${i}"]`);
  if (mirror) mirror.value = v;
  scheduleRecalc();
});

function bindWeight(id, key) {
  const el = $(id);
  el.value = state.weights[key];
  el.addEventListener("input", () => {
    state.weights[key] = Math.max(num(el.value), key === "speed_km_per_day" ? 1 : 0);
    scheduleRecalc();
  });
}
bindWeight("#w-freight", "freight_per_km");
bindWeight("#w-time", "time_weight");
bindWeight("#w-speed", "speed_km_per_day");

// ---------- 重算与渲染 ----------
function scheduleRecalc() {
  clearTimeout(recalcTimer);
  recalcTimer = setTimeout(recalc, 250);
}

async function recalc() {
  let plan;
  try {
    const resp = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
    plan = await resp.json();
    if (plan.error) throw new Error(plan.error);
  } catch (err) {
    const banner = $("#banner");
    banner.className = "banner warn";
    banner.textContent = `计算失败：${err.message}`;
    return;
  }
  renderPlan(plan);
  prevPlan = plan;
}

function flash(el) {
  el.classList.remove("flash", "changed");
  void el.offsetWidth; // 重新触发动画
  el.classList.add(el.tagName === "TR" ? "flash" : "changed");
}

function renderPlan(plan) {
  const prevById = {};
  if (prevPlan) for (const l of prevPlan.locations) prevById[l.id] = l;

  for (const loc of plan.locations) {
    const ref = rowRefs[loc.id];
    if (!ref) continue;
    const prev = prevById[loc.id];
    const changed =
      !prev || ["gap", "supply", "sent", "received", "unmet", "status"]
        .some((k) => prev[k] !== loc[k]);

    ref.net.textContent = loc.net.toLocaleString();
    ref.net.className = loc.net < 0 ? "neg" : "pos";
    ref.gap.textContent = loc.gap.toLocaleString();
    ref.gap.className = loc.gap > 0 ? "neg" : "";
    ref.supply.textContent = loc.supply.toLocaleString();
    ref.sent.textContent = loc.sent > 0 ? loc.sent.toLocaleString() : "—";
    let recv = loc.received > 0 ? loc.received.toLocaleString() : "—";
    if (loc.unmet > 0) recv += ` (缺 ${loc.unmet.toLocaleString()})`;
    ref.received.textContent = recv;
    ref.received.className = loc.unmet > 0 ? "neg" : "";
    ref.status.innerHTML =
      `<span class="badge ${loc.status}">${STATUS_LABEL[loc.status]}</span>`;
    if (changed) flash(ref.tr);
  }

  renderSummary(plan);
  renderTransfers(plan);
  renderExplanations(plan);
}

function renderSummary(plan) {
  const t = plan.total;
  const banner = $("#banner");
  banner.classList.remove("hidden");
  if (t.balanced) {
    banner.className = "banner ok";
    banner.textContent = t.total_gap > 0
      ? `全部缺口已平衡：总缺口 ${t.total_gap.toLocaleString()} 件，调拨总代价 ${(t.transport_cost + t.time_cost).toLocaleString()} 元。`
      : "全网供需平衡，无需调拨。";
  } else {
    banner.className = "banner warn";
    banner.textContent =
      `无法完全平衡：总缺口 ${t.total_gap.toLocaleString()} 件，可支援仅 ` +
      `${t.total_supply.toLocaleString()} 件，仍有 ${t.total_unmet.toLocaleString()} 件缺货，请见下方取舍说明。`;
  }
  const cards = [
    ["总缺口", t.total_gap, "件", t.total_gap > 0],
    ["可支援总量", t.total_supply, "件", false],
    ["未满足缺口", t.total_unmet, "件", t.total_unmet > 0],
    ["运输成本", t.transport_cost, "元", false],
    ["时效成本", t.time_cost, "元", false],
    ["调拨总代价", t.transport_cost + t.time_cost, "元", false],
  ];
  $("#summary-cards").innerHTML = cards.map(([label, v, unit, danger]) =>
    `<div class="card${danger ? " danger" : ""}">
       <div class="label">${label}</div>
       <div class="value">${Number(v).toLocaleString()}<small> ${unit}</small></div>
     </div>`).join("");
}

function renderTransfers(plan) {
  const tbody = $("#transfer-table tbody");
  const prevKeys = new Set(
    prevPlan ? prevPlan.transfers.map((t) => `${t.from_id}->${t.to_id}:${t.qty}`) : []);
  tbody.innerHTML = "";
  $("#no-transfer").classList.toggle("hidden", plan.transfers.length > 0);
  for (const t of plan.transfers) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${t.from}</td><td>${t.to}</td>
      <td>${t.qty.toLocaleString()}</td><td>${t.distance.toLocaleString()}</td>
      <td>${t.lead_time}</td><td>${t.unit_cost.toLocaleString()}</td>
      <td>${t.cost.toLocaleString()}</td>`;
    if (!prevKeys.has(`${t.from_id}->${t.to_id}:${t.qty}`)) flash(tr);
    tbody.appendChild(tr);
  }
}

function renderExplanations(plan) {
  $("#explanations").innerHTML =
    plan.explanations.map((x) => `<li>${x}</li>`).join("");
}

// ---------- 启动 ----------
buildLocTable();
buildMatrix();
recalc();

$("#add-loc").addEventListener("click", () => {
  const id = nextId++;
  state.locations.push({
    id, name: `新地点${id}`, on_hand: 500, in_transit: 0,
    safety_stock: 200, demand: 300,
  });
  state.distances.forEach((row) => row.push(800));
  state.distances.push(new Array(state.locations.length).fill(800));
  const n = state.locations.length;
  state.distances[n - 1][n - 1] = 0;
  buildLocTable();
  buildMatrix();
  scheduleRecalc();
});
