"use strict";

const SLOTS = 288;
const SLOT_MINUTES = 5;
const state = {
  devices: [],
  tasks: [],
  transitions: [],
  tariff: 0.8,
  overrides: [],
  result: null,
  files: {},
  selectedSegmentKey: null,
  showingAlternative: false,
};

const $ = (id) => document.getElementById(id);

function slotToTime(slot) {
  const total = Math.round(slot * SLOT_MINUTES);
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function timeToSlot(value) {
  if (!value) return 0;
  const [hh, mm] = value.split(":").map(Number);
  return Math.min(SLOTS, Math.max(0, Math.round(((hh || 0) * 60 + (mm || 0)) / SLOT_MINUTES)));
}

function segmentKey(segment) {
  return `${segment.device_id}|${segment.task_id || ""}|${segment.start}|${segment.end}|${segment.mode}|${segment.locked ? "L" : "A"}`;
}

async function postSchedule(extra = {}) {
  const payload = {
    devices: state.devices,
    tasks: state.tasks,
    transitions: state.transitions,
    tariff: state.tariff,
    overrides: state.overrides,
    ...extra,
  };
  const response = await fetch("/api/schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!body.ok) throw new Error(body.error);
  return body.result;
}

async function refresh() {
  try {
    state.result = await postSchedule(Object.keys(state.files).length ? { files: state.files } : {});
    state.showingAlternative = false;
    renderAll();
  } catch (error) {
    alert(`无法生成调度：${error.message}`);
  }
}

function fileContent(inputId) {
  const file = $(inputId).files?.[0];
  return file ? file.text() : Promise.resolve("");
}

async function handleImports() {
  const [devices, tasks, transitions] = await Promise.all([
    fileContent("devicesFile"), fileContent("tasksFile"), fileContent("transitionsFile"),
  ]);
  const files = {};
  if (devices) files.devices = devices;
  if (tasks) files.tasks = tasks;
  if (transitions) files.transitions = transitions;
  if (!Object.keys(files).length) return;
  state.files = { ...state.files, ...files };
  state.overrides = [];
  await refresh();
}

function displayedResult() {
  return state.showingAlternative && state.result?.alternative ? state.result.alternative : state.result;
}

function renderCards(result) {
  const m = result.metrics;
  const status = result.feasible;
  const cards = [
    ["交付状态", status ? "可全部交付" : "存在冲突", status ? "good" : "danger", status ? "所有任务均按时完成" : "查看红色提示与替代方案"],
    ["总能耗", `${m.energy_kwh.toFixed(1)} kWh`, "", `过渡能耗 ${m.transition_kwh.toFixed(1)} kWh`],
    ["能耗账单", `¥${m.total_cost.toFixed(1)}`, "", "按分时电价累计"],
    ["峰值功率", `${m.peak_kw.toFixed(1)} kW`, "", "所有运行设备瞬时合计"],
    ["主要能耗来源", m.main_energy_source || "—", "danger", "设备面板中红色标出"],
    ["手动锁定", `${m.manual_segments} 块`, "", "删除手动块后恢复自动排产"],
  ];
  $("cards").innerHTML = cards.map(([label, value, cls, sub]) =>
    `<div class="card ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`
  ).join("");
}

function renderConflicts(result) {
  const panel = $("conflictPanel");
  panel.hidden = result.feasible;
  if (result.feasible) return;
  $("conflictList").innerHTML = result.conflicts.map((conflict) => {
    const devices = (conflict.devices || []).map((d) =>
      `<div class="conflict-device">${d.device_id}：${d.reasons.join("、")}</div>`).join("");
    return `<div class="conflict-item"><strong>${conflict.message}</strong>${devices}</div>`;
  }).join("");
  $("alternativePanel").hidden = !result.alternative;
}

function drawChart(result) {
  const canvas = $("chart");
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = 240;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, width, height);
  const pad = { l: 44, r: 44, t: 16, b: 28 };
  const power = result.energy_curve_kw;
  const cost = result.cost_curve || new Array(SLOTS).fill(0);
  const maxPower = Math.max(1, ...power);
  const maxCost = Math.max(0.001, ...cost);
  const x = (i) => pad.l + i * (width - pad.l - pad.r) / (SLOTS - 1);
  const yPower = (v) => height - pad.b - v / maxPower * (height - pad.t - pad.b);
  const yCost = (v) => height - pad.b - v / maxCost * (height - pad.t - pad.b);
  ctx.strokeStyle = "#e5eaf1"; ctx.lineWidth = 1;
  for (let h = 0; h <= 4; h++) {
    const y = pad.t + h * (height - pad.t - pad.b) / 4;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(width - pad.r, y); ctx.stroke();
  }
  ctx.fillStyle = "#657083"; ctx.font = "11px sans-serif";
  for (let h = 0; h <= 24; h += 4) {
    ctx.fillText(`${h}:00`, x(h * 12), height - 8);
  }
  function line(values, yfn, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 2.2; ctx.beginPath();
    values.forEach((value, i) => i ? ctx.lineTo(x(i), yfn(value)) : ctx.moveTo(x(i), yfn(value)));
    ctx.stroke();
  }
  line(power, yPower, "#2563eb");
  line(cost, yCost, "#f59e0b");
  canvas.onmousemove = (event) => {
    const rect = canvas.getBoundingClientRect();
    const i = Math.max(0, Math.min(SLOTS - 1, Math.floor((event.clientX - rect.left - pad.l) / (rect.width - pad.l - pad.r) * SLOTS)));
    $("hoverInfo").textContent = `${slotToTime(i)}–${slotToTime(i + 1)}：功率 ${power[i].toFixed(1)} kW，电费 ¥${cost[i].toFixed(2)}，电价 ${result.tariff_currency_per_kwh[i]}/kWh`;
  };
}

function renderTimeline(result, alternative = false) {
  const hours = Array.from({ length: 25 }, (_, h) =>
    `<span class="hour-label" style="grid-column:${2 + h * 12}">${h}:00</span>`).join("");
  $("timelineHours").innerHTML = `<span></span>${hours}`;
  const rows = result.devices.map((device) => {
    const segments = result.segments
      .filter((s) => s.device_id === device.device_id)
      .map((segment) => {
        const left = segment.start / SLOTS * 100;
        const width = Math.max(0.4, (segment.end - segment.start) / SLOTS * 100);
        const label = segment.kind === "maintenance" ? "维护"
          : segment.kind === "transition" ? `${segment.mode}→${segment.to_mode || "?"}`
          : `${segment.task_id || ""} ${segment.mode}`;
        return `<button class="seg ${segment.kind} ${segment.locked ? "locked" : ""} ${alternative ? "alt" : ""}"
          data-key="${segmentKey(segment)}" data-alt="${alternative}"
          style="left:${left}%;width:${width}%" title="${label} ${slotToTime(segment.start)}-${slotToTime(segment.end)}">${label}</button>`;
      }).join("");
    return `<div class="device-row">
      <div class="device-label">${device.name}<br><small>${device.energy_kwh.toFixed(1)} kWh</small></div>
      <div class="track">${segments}</div>
    </div>`;
  }).join("");
  $("timeline").innerHTML = rows;
  $("timeline").querySelectorAll(".seg").forEach((button) => {
    button.addEventListener("click", () => openSegmentDialog(button.dataset.key, button.dataset.alt === "true"));
  });
}

function renderDevices(result) {
  $("devicePanels").innerHTML = result.devices.map((device) => {
    const major = result.metrics.main_energy_source === device.device_id;
    const modes = device.modes.map((m) => `${m.id} ${m.rate}kW/${m.speed}件h`).join("；");
    const load = Math.round(device.load_ratio * 100);
    return `<div class="device-card ${major ? "major" : ""}">
      <div class="row-flex"><strong>${device.name}</strong>${major ? `<span class="tag primary">主要能耗</span>` : ""}</div>
      <div>${modes}</div>
      <div class="row-flex"><small>启停窗口 ${slotToTime(device.shift_start)}–${slotToTime(device.shift_end)}</small>
      <small>${device.energy_kwh.toFixed(1)} kWh</small></div>
      <div class="bar"><span style="width:${Math.min(100, load)}%"></span></div>
      <small>生产负载 ${load}% · 过渡 ${device.transition_slots * SLOT_MINUTES} 分钟</small>
    </div>`;
  }).join("");
}

function renderTasks(result) {
  $("taskTable").innerHTML = `<table><thead><tr><th>任务</th><th>进度</th><th>完成</th><th>截止</th><th>依赖</th><th>状态</th></tr></thead>
  <tbody>${result.tasks.map((task) => `<tr>
    <td><strong>${task.task_id}</strong><br><small>${task.name}</small></td>
    <td>${task.completed.toFixed(1)}/${task.quantity}</td>
    <td>${task.end == null ? "—" : slotToTime(task.end)}</td>
    <td>${slotToTime(task.deadline)}</td>
    <td>${task.depends_on.join(", ") || "—"}</td>
    <td><span class="tag ${task.on_time ? "ok" : "bad"}">${task.on_time ? "按时" : "未完成"}</span></td>
  </tr>`).join("")}</tbody></table>`;
}

function renderAlternative(result) {
  if (!result.alternative) return;
  const alt = result.alternative;
  $("alternativeNote").textContent = alt.note || "已清空手动调整并重新计算。";
  $("alternativeSummary").innerHTML = `<div class="cards" style="margin:0">
    <div class="card ${alt.feasible ? "good" : "danger"}"><div class="label">替代方案</div><div class="value">${alt.feasible ? "可交付" : "仍冲突"}</div></div>
    <div class="card"><div class="label">能耗</div><div class="value">${alt.metrics.energy_kwh.toFixed(1)} kWh</div></div>
    <div class="card"><div class="label">账单</div><div class="value">¥${alt.metrics.total_cost.toFixed(1)}</div></div>
    <div class="card"><div class="label">峰值</div><div class="value">${alt.metrics.peak_kw.toFixed(1)} kW</div></div>
  </div>`;
}

function renderEditors(result) {
  $("editTask").innerHTML = result.tasks.map((t) =>
    `<option value="${t.task_id}">${t.task_id} ${t.name}</option>`).join("");
  $("editDevice").innerHTML = result.devices.map((d) =>
    `<option value="${d.device_id}">${d.name}</option>`).join("");
  syncModeOptions();
}

function syncModeOptions(selectId = "editMode") {
  const deviceId = $("editDevice").value;
  const device = displayedResult().devices.find((d) => d.device_id === deviceId);
  $(selectId).innerHTML = (device?.modes || []).map((m) =>
    `<option value="${m.id}">${m.id}｜${m.rate} kW｜${m.speed} 件/小时</option>`).join("");
}

function addOverrideFromForm() {
  const start = timeToSlot($("editStart").value);
  const end = timeToSlot($("editEnd").value);
  if (end <= start) return alert("停止时间必须晚于启动时间。");
  state.overrides.push({
    task_id: $("editTask").value,
    device_id: $("editDevice").value,
    mode: $("editMode").value,
    start, end,
  });
  refresh();
}

function findSegment(key, useAlternative) {
  const source = useAlternative && state.result.alternative ? state.result.alternative : state.result;
  return source.segments.find((segment) => segment.kind === "production" && segmentKey(segment) === key);
}

function openSegmentDialog(key, useAlternative) {
  const segment = findSegment(key, useAlternative);
  if (!segment) return;
  if (useAlternative) {
    alert("替代方案是只读对比；点击“采用替代安排”后可继续编辑。");
    return;
  }
  state.selectedSegmentKey = key;
  const device = state.result.devices.find((d) => d.device_id === segment.device_id);
  $("segmentMeta").textContent = `${segment.task_id} · ${device.name} · 计划产量 ${segment.produced}`;
  $("dialogMode").innerHTML = device.modes.map((m) =>
    `<option value="${m.id}" ${m.id === segment.mode ? "selected" : ""}>${m.id}｜${m.rate} kW｜${m.speed} 件/小时</option>`).join("");
  $("dialogStart").value = slotToTime(segment.start);
  $("dialogEnd").value = slotToTime(segment.end);
  $("deleteSegmentBtn").disabled = !segment.locked;
  $("segmentDialog").showModal();
}

function saveSelectedSegment() {
  const segment = findSegment(state.selectedSegmentKey, false);
  if (!segment) return;
  const next = {
    task_id: segment.task_id,
    device_id: segment.device_id,
    mode: $("dialogMode").value,
    start: timeToSlot($("dialogStart").value),
    end: timeToSlot($("dialogEnd").value),
  };
  if (next.end <= next.start) return alert("停止时间必须晚于启动时间。");
  if (segment.locked) {
    const index = state.overrides.findIndex((o) =>
      o.task_id === segment.task_id && o.device_id === segment.device_id &&
      o.start === segment.start && o.end === segment.end && o.mode === segment.mode);
    if (index >= 0) state.overrides.splice(index, 1, next);
    else state.overrides.push(next);
  } else {
    state.overrides.push(next);
  }
  $("segmentDialog").close();
  refresh();
}

function deleteSelectedSegment() {
  const segment = findSegment(state.selectedSegmentKey, false);
  if (!segment?.locked) return;
  state.overrides = state.overrides.filter((o) => !(
    o.task_id === segment.task_id && o.device_id === segment.device_id &&
    o.start === segment.start && o.end === segment.end && o.mode === segment.mode));
  $("segmentDialog").close();
  refresh();
}

function exportCsv() {
  const result = displayedResult();
  const rows = [["device_id", "task_id", "kind", "mode", "start", "end", "rate_kw", "produced", "energy_kwh"]];
  result.segments.forEach((s) => rows.push([
    s.device_id, s.task_id || "", s.kind, s.mode, slotToTime(s.start), slotToTime(s.end),
    s.rate, s.produced, s.energy_kwh,
  ]));
  const blob = new Blob(["\ufeff" + rows.map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n")],
    { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "schedule_plan.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

function renderAll() {
  const current = state.result;
  if (!current) return;
  const visible = displayedResult();
  renderCards(visible);
  renderConflicts(current);
  drawChart(visible);
  renderTimeline(visible, state.showingAlternative);
  renderDevices(visible);
  renderTasks(visible);
  renderAlternative(current);
  renderEditors(visible);
}

async function loadSample() {
  const response = await fetch("/api/sample");
  const body = await response.json();
  if (!body.ok) throw new Error("样例数据加载失败");
  state.devices = body.devices;
  state.tasks = body.tasks;
  state.transitions = body.transitions;
  state.tariff = body.tariff;
  state.overrides = [];
  state.files = {};
  state.result = body.result;
  renderAll();
}

function bindEvents() {
  ["devicesFile", "tasksFile", "transitionsFile"].forEach((id) => $(id).addEventListener("change", handleImports));
  $("resetBtn").addEventListener("click", loadSample);
  $("exportBtn").addEventListener("click", exportCsv);
  $("addEditBtn").addEventListener("click", addOverrideFromForm);
  $("editDevice").addEventListener("change", () => syncModeOptions());
  $("saveSegmentBtn").addEventListener("click", saveSelectedSegment);
  $("deleteSegmentBtn").addEventListener("click", deleteSelectedSegment);
  $("useAlternativeBtn").addEventListener("click", async () => {
    if (!state.showingAlternative) {
      state.showingAlternative = true;
      renderAll();
    } else {
      state.overrides = [];
      await refresh();
    }
  });
  window.addEventListener("resize", () => state.result && drawChart(displayedResult()));
}

bindEvents();
loadSample().catch((error) => alert(error.message));
