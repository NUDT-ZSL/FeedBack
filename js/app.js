(function () {
  "use strict";

  const STORAGE_KEY = "regional-relay-workbench-v1";

  const sampleData = {
    settings: { horizonDays: 7, distanceCostPerUnitKm: 0.6, timeCostPerUnitDay: 3 },
    locations: [
      { id: "A", name: "华东中心仓", stock: 180, inbound: 20, safety: 40, demand: 140 },
      { id: "B", name: "华南区域仓", stock: 45, inbound: 10, safety: 35, demand: 110 },
      { id: "C", name: "华北区域仓", stock: 92, inbound: 8, safety: 25, demand: 70 },
      { id: "D", name: "西南区域仓", stock: 36, inbound: 0, safety: 24, demand: 72 },
      { id: "E", name: "华中前置仓", stock: 70, inbound: 5, safety: 18, demand: 48 }
    ],
    lanes: [
      { from: "A", to: "B", distanceKm: 420, unitFreight: 3.2, leadTimeDays: 2 },
      { from: "C", to: "B", distanceKm: 820, unitFreight: 4.1, leadTimeDays: 4 },
      { from: "A", to: "D", distanceKm: 980, unitFreight: 5.4, leadTimeDays: 5 },
      { from: "E", to: "D", distanceKm: 560, unitFreight: 3.8, leadTimeDays: 3 },
      { from: "C", to: "D", distanceKm: 760, unitFreight: 4.6, leadTimeDays: 4 },
      { from: "E", to: "B", distanceKm: 640, unitFreight: 3.7, leadTimeDays: 3 }
    ]
  };

  let state = clone(sampleData);
  let plan = null;
  let previousSnapshot = null;
  let activeEdit = null;
  const rawInputs = new Map();

  const $ = (id) => document.getElementById(id);
  const money = (value) => `¥${Math.round(value).toLocaleString("zh-CN")}`;
  const number = (value) => Math.round(Number(value) || 0).toLocaleString("zh-CN");
  const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return clone(sampleData);
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.locations)) return clone(sampleData);
      return { ...clone(sampleData), ...parsed, settings: { ...sampleData.settings, ...(parsed.settings || {}) } };
    } catch (error) {
      return clone(sampleData);
    }
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (error) { /* 本地存储不可用时仍可使用 */ }
  }

  function uniqueId(prefix) {
    let id = "";
    do {
      id = `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
    } while (state.locations.some((location) => location.id === id));
    return id;
  }

  function statusLabel(item) {
    const status = item.status;
    return {
      stockout: { text: "缺货", className: "status-stockout" },
      safety: { text: item && item.actualShortage > 0 ? "实际缺货" : "低于安全", className: item && item.actualShortage > 0 ? "status-stockout" : "status-safety" },
      surplus: { text: "有余量", className: "status-surplus" },
      balanced: { text: "平衡", className: "status-balanced" }
    }[status];
  }

  function recalculate() {
    saveState();
    const nextPlan = AllocationEngine.createPlan(state);
    const baseline = plan ? makeSnapshot(plan) : previousSnapshot;
    queueMicrotask(() => {
      plan = nextPlan;
      const nextSnapshot = makeSnapshot(nextPlan);
      captureActiveEdit();
      render(baseline);
      restoreActiveEdit();
      previousSnapshot = nextSnapshot;
    });
  }

  function activeEditSelector(element) {
    if (element.id) return `#${element.id}`;
    if (element.dataset.id && element.dataset.field) {
      return `#locationsTable [data-id="${element.dataset.id}"][data-field="${element.dataset.field}"]`;
    }
    if (element.dataset.index !== undefined && element.dataset.laneField) {
      return `#lanesTable [data-index="${element.dataset.index}"][data-lane-field="${element.dataset.laneField}"]`;
    }
    return "";
  }

  function captureActiveEdit() {
    const element = document.activeElement;
    const selector = element ? activeEditSelector(element) : "";
    activeEdit = selector
      ? { selector, value: element.value, selectionStart: element.selectionStart, selectionEnd: element.selectionEnd }
      : null;
    if (activeEdit) rawInputs.set(selector, element.value);
  }

  function restoreActiveEdit() {
    if (!activeEdit) return;
    const element = document.querySelector(activeEdit.selector);
    const snapshot = activeEdit;
    activeEdit = null;
    if (!element) return;
    element.focus();
    element.value = rawInputs.get(snapshot.selector) ?? snapshot.value;
    if (typeof snapshot.selectionStart === "number") {
      element.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
    }
  }

  function inputValue(selector, fallback) {
    return rawInputs.has(selector) ? rawInputs.get(selector) : fallback;
  }

  function makeSnapshot(value) {
    return {
      settings: clone(value.settings),
      locations: Object.fromEntries(value.locationResults.map((location) => [
        location.id,
        {
          stock: location.stock,
          inbound: location.inbound,
          safety: location.safety,
          demand: location.demand,
          gap: location.gap,
          remainingGap: location.remainingGap,
          inboundQuantity: location.inboundQuantity,
          outboundQuantity: location.outboundQuantity,
          status: location.status
        }
      ])),
      lanes: Object.fromEntries(value.lanes.map((lane) => [
        `${lane.from}->${lane.to}`,
        {
          distanceKm: lane.distanceKm,
          unitFreight: lane.unitFreight,
          leadTimeDays: lane.leadTimeDays,
          total: lane.total
        }
      ])),
      shipments: value.shipments.map((shipment) => `${shipment.from}->${shipment.to}:${shipment.quantity}`),
      summary: clone(value.summary)
    };
  }

  function changed(type, id, field, baseline = previousSnapshot) {
    if (!baseline) return "";
    if (type === "summary") {
      return baseline.summary[field] !== plan.summary[field] ? "changed" : "";
    }
    if (type === "settings") {
      return baseline.settings[field] !== plan.settings[field] ? "changed" : "";
    }
    if (type === "location") {
      const before = baseline.locations[id];
      const after = plan.locationResults.find((item) => item.id === id);
      if (!before || !after) return "";
      return before[field] !== after[field] ? "changed" : "";
    }
    if (type === "lane") {
      const before = baseline.lanes[id];
      const after = plan.lanes.find((item) => `${item.from}->${item.to}` === id);
      if (!before || !after) return "";
      return before[field] !== after[field] ? "changed" : "";
    }
    return "";
  }

  function locationRowChanged(id, baseline = previousSnapshot) {
    if (!baseline) return "";
    const before = baseline.locations[id];
    const after = plan.locationResults.find((item) => item.id === id);
    if (!before || !after) return "";
    const fields = ["stock", "inbound", "safety", "demand", "gap", "remainingGap", "inboundQuantity", "outboundQuantity", "status"];
    return fields.some((field) => before[field] !== after[field]) ? "row-changed" : "";
  }

  function editableFieldChanged(id, field, baseline = previousSnapshot) {
    if (!baseline) return "";
    const before = baseline.locations[id];
    const current = state.locations.find((item) => item.id === id);
    if (!before || !current) return "";
    return before[field] !== current[field] ? "changed" : "";
  }

  function renderSettings() {
    $("horizonDays").value = state.settings.horizonDays;
    $("distanceRate").value = state.settings.distanceCostPerUnitKm;
    $("timeRate").value = state.settings.timeCostPerUnitDay;
  }

  function renderKpis(baseline) {
    const s = plan.summary;
    const set = (id, value, className) => {
      const element = $(id);
      element.textContent = value;
      element.className = className || "";
    };
    set("kpiGap", number(s.totalGap));
    set("kpiFulfilled", number(s.fulfilledGap), s.fulfilledGap > 0 ? "positive" : "");
    set("kpiUnresolved", number(s.unresolvedGap), s.unresolvedGap > 0 ? "negative" : "");
    set("kpiSurplus", number(s.totalSurplus));
    set("kpiCost", money(s.totalCost));
    set("kpiBalance", s.balanced ? "可平衡" : "无法平衡", s.balanced ? "positive" : "negative");
    $("kpiBalanceNote").textContent = s.balanced ? "所有缺口均有方案" : "需补货、扩容或新增线路";
    $("balanceCard").className = `kpi-card ${s.balanced ? "good" : "bad"}`;
    ["kpiGap", "kpiFulfilled", "kpiUnresolved", "kpiSurplus", "kpiCost"].forEach((id) => {
      const key = id.replace("kpi", "");
      const map = { Gap: "totalGap", Fulfilled: "fulfilledGap", Unresolved: "unresolvedGap", Surplus: "totalSurplus", Cost: "totalCost" };
      $(id).classList.remove("changed");
      if (baseline && baseline.summary[map[key]] !== s[map[key]]) $(id).classList.add("changed");
    });
  }

  function renderWarnings() {
    const banner = $("warningBanner");
    if (!plan.warnings.length) {
      banner.hidden = true;
      banner.innerHTML = "";
      return;
    }
    banner.hidden = false;
    banner.innerHTML = `<strong>无法完全平衡</strong><ul>${plan.warnings.map((item) => `<li>${item}</li>`).join("")}</ul>`;
  }

  function renderLocations(baseline) {
    const body = $("locationsTable").querySelector("tbody");
    body.innerHTML = plan.locationResults.map((item) => {
      const badge = item.priorityRank
        ? `<span class="priority-badge priority-${item.priorityTier}">#${item.priorityRank}</span>`
        : '<span class="status-pill status-balanced">—</span>';
      const status = statusLabel(item);
      return `
        <tr class="${locationRowChanged(item.id, baseline)}" data-location-row="${item.id}">
          <td>${badge}</td>
          <td><input class="name-input" value="${esc(item.name)}" data-field="name" data-id="${item.id}"></td>
          <td class="${editableFieldChanged(item.id, "stock", baseline)}"><input type="number" min="0" step="1" value="${inputValue(`#locationsTable [data-id="${item.id}"][data-field="stock"]`, item.stock)}" data-field="stock" data-id="${item.id}"></td>
          <td class="${editableFieldChanged(item.id, "inbound", baseline)}"><input type="number" min="0" step="1" value="${inputValue(`#locationsTable [data-id="${item.id}"][data-field="inbound"]`, item.inbound)}" data-field="inbound" data-id="${item.id}"></td>
          <td class="${editableFieldChanged(item.id, "safety", baseline)}"><input type="number" min="0" step="1" value="${inputValue(`#locationsTable [data-id="${item.id}"][data-field="safety"]`, item.safety)}" data-field="safety" data-id="${item.id}"></td>
          <td class="${editableFieldChanged(item.id, "demand", baseline)}"><input type="number" min="0" step="1" value="${inputValue(`#locationsTable [data-id="${item.id}"][data-field="demand"]`, item.demand)}" data-field="demand" data-id="${item.id}"></td>
          <td><span class="metric ${item.gap ? "negative" : "positive"} ${changed("location", item.id, "gap", baseline)}">${number(item.gap)}</span><br><span class="status-pill ${status.className}">${status.text}</span></td>
          <td class="recommendation">${esc(item.recommendation)}</td>
          <td><button class="btn small danger" type="button" data-delete-location="${item.id}">删除</button></td>
        </tr>`;
    }).join("");
  }

  function renderShipments() {
    const list = $("shipmentsList");
    if (!plan.shipments.length) {
      list.innerHTML = '<div class="empty-state">当前没有需要执行的调拨路径。调整需求或存量后将立即生成建议。</div>';
      return;
    }
    list.innerHTML = plan.shipments.map((shipment) => `
      <article class="shipment-card">
        <div class="shipment-route">
          <div class="route-node"><span>调出</span><strong>${esc(shipment.fromName)}</strong></div>
          <div class="route-arrow"></div>
          <div class="route-node" style="text-align:right"><span>调入</span><strong>${esc(shipment.toName)}</strong></div>
          <div class="shipment-qty">${number(shipment.quantity)}<small>建议调拨件数</small></div>
        </div>
        <div class="shipment-meta">
          <div>距离：<b>${number(shipment.distanceKm)} km</b></div>
          <div>时效：<b class="${shipment.overHorizon ? "late" : ""}">${shipment.leadTimeDays} 天${shipment.overHorizon ? "（超窗口）" : ""}</b></div>
          <div>运输费用：<b>${money(shipment.transportCost)}</b></div>
          <div>时效成本：<b>${money(shipment.timeCost)}</b></div>
          <div style="grid-column:1/-1">路径总代价：<b>${money(shipment.totalCost)}</b></div>
        </div>
      </article>
    `).join("");
  }

  function renderLanes(baseline) {
    const body = $("lanesTable").querySelector("tbody");
    body.innerHTML = state.lanes.map((lane, index) => {
      const view = plan.lanes.find((item) => item.from === lane.from && item.to === lane.to);
      const key = `${lane.from}->${lane.to}`;
      const unitCost = view ? view.total : 0;
      const invalid = lane.from === lane.to;
      return `
        <tr data-lane-index="${index}">
          <td><select data-lane-field="from" data-index="${index}">${state.locations.map((location) => `<option value="${location.id}" ${location.id === lane.from ? "selected" : ""}>${esc(location.name)}</option>`).join("")}</select></td>
          <td><select data-lane-field="to" data-index="${index}">${state.locations.map((location) => `<option value="${location.id}" ${location.id === lane.to ? "selected" : ""}>${esc(location.name)}</option>`).join("")}</select></td>
          <td><input type="number" min="0" step="1" value="${lane.distanceKm}" data-lane-field="distanceKm" data-index="${index}"></td>
          <td><input type="number" min="0" step="0.01" value="${lane.unitFreight}" data-lane-field="unitFreight" data-index="${index}"></td>
          <td><input type="number" min="0" step="0.1" value="${lane.leadTimeDays}" data-lane-field="leadTimeDays" data-index="${index}"></td>
          <td>${invalid ? '<span class="late">调出与调入不能相同</span>' : `<span class="unit-cost ${changed("lane", key, "total", baseline)}">${money(unitCost)} / 件</span>${view?.overHorizon ? '<div class="late">超过计划窗口</div>' : ""}`}</td>
          <td><button class="btn small danger" type="button" data-delete-lane="${index}">删除</button></td>
        </tr>`;
    }).join("");
  }

  function renderPriorities() {
    const list = $("priorityList");
    if (!plan.priorityExplanations.length) {
      list.innerHTML = '<div class="empty-state">所有地点均满足未来需求与安全库存。</div>';
      return;
    }
    list.innerHTML = plan.priorityExplanations.map((item) => `
      <article class="priority-card">
        <header>
          <h3>#${item.priorityRank} ${esc(item.name)}</h3>
          <span class="tag tier-${item.tier}">${item.tier === 1 ? "P1 实际缺货" : "P2 安全库存"}</span>
        </header>
        <p>${esc(item.basis)}</p>
        <p>${esc(item.reason)}</p>
        <div class="priority-stats">
          <div><span>缺口</span><strong>${number(item.gap)}</strong></div>
          <div><span>已分配</span><strong>${number(item.allocated)}</strong></div>
          <div><span>剩余</span><strong class="${item.remainingGap ? "negative" : "positive"}">${number(item.remainingGap)}</strong></div>
        </div>
      </article>
    `).join("");
  }

  function render(baseline = previousSnapshot) {
    renderSettings();
    renderKpis(baseline);
    renderWarnings();
    renderLocations(baseline);
    renderShipments();
    renderLanes(baseline);
    renderPriorities();
  }

  function bindEvents() {
    document.addEventListener("change", (event) => {
      const selector = activeEditSelector(event.target);
      if (!selector) return;
      rawInputs.delete(selector);
      recalculate();
    });

    $("horizonDays").addEventListener("input", (event) => {
      state.settings.horizonDays = Math.max(1, Math.round(Number(event.target.value) || 1));
      recalculate();
    });
    $("distanceRate").addEventListener("input", (event) => {
      state.settings.distanceCostPerUnitKm = Math.max(0, Number(event.target.value) || 0);
      recalculate();
    });
    $("timeRate").addEventListener("input", (event) => {
      state.settings.timeCostPerUnitDay = Math.max(0, Number(event.target.value) || 0);
      recalculate();
    });

    $("locationsTable").addEventListener("input", (event) => {
      const target = event.target;
      const id = target.dataset.id;
      const field = target.dataset.field;
      if (!id || !field) return;
      const location = state.locations.find((item) => item.id === id);
      if (!location) return;
      location[field] = field === "name" ? target.value : Math.max(0, Math.round(Number(target.value) || 0));
      recalculate();
    });

    $("locationsTable").addEventListener("click", (event) => {
      const id = event.target.dataset.deleteLocation;
      if (!id) return;
      state.locations = state.locations.filter((item) => item.id !== id);
      state.lanes = state.lanes.filter((lane) => lane.from !== id && lane.to !== id);
      recalculate();
    });

    $("lanesTable").addEventListener("input", (event) => {
      const target = event.target;
      const index = Number(target.dataset.index);
      const field = target.dataset.laneField;
      if (!Number.isInteger(index) || !field) return;
      const lane = state.lanes[index];
      if (!lane) return;
      if (field === "distanceKm" || field === "leadTimeDays") {
        lane[field] = Math.max(0, Number(target.value) || 0);
      } else if (field === "unitFreight") {
        lane[field] = Math.max(0, Number(target.value) || 0);
      }
      recalculate();
    });

    $("lanesTable").addEventListener("change", (event) => {
      const target = event.target;
      const index = Number(target.dataset.index);
      const field = target.dataset.laneField;
      if (!Number.isInteger(index) || (field !== "from" && field !== "to")) return;
      state.lanes[index][field] = target.value;
      recalculate();
    });

    $("lanesTable").addEventListener("click", (event) => {
      const indexRaw = event.target.dataset.deleteLane;
      if (indexRaw === undefined) return;
      state.lanes.splice(Number(indexRaw), 1);
      recalculate();
    });

    $("addLocationBtn").addEventListener("click", () => {
      const id = uniqueId("L");
      state.locations.push({ id, name: `新地点 ${state.locations.length + 1}`, stock: 0, inbound: 0, safety: 0, demand: 0 });
      recalculate();
    });

    $("addLaneBtn").addEventListener("click", () => {
      const first = state.locations[0]?.id;
      const second = state.locations.find((location) => location.id !== first)?.id;
      if (!first) return;
      if (!second) {
        window.alert("请先至少维护两个地点，再新增调拨线路。");
        return;
      }
      state.lanes.push({ from: first, to: second, distanceKm: 100, unitFreight: 2, leadTimeDays: 1 });
      recalculate();
    });

    $("resetBtn").addEventListener("click", () => {
      if (!window.confirm("确定恢复内置示例数据？当前修改将被覆盖。")) return;
      state = clone(sampleData);
      previousSnapshot = null;
      recalculate();
    });

    $("printBtn").addEventListener("click", () => window.print());
    $("exportBtn").addEventListener("click", exportPlan);
  }

  function exportPlan() {
    const payload = { input: state, result: plan };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `调拨方案-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  document.addEventListener("DOMContentLoaded", () => {
    state = loadState();
    plan = AllocationEngine.createPlan(state);
    previousSnapshot = null;
    render();
    bindEvents();
  });
})();
