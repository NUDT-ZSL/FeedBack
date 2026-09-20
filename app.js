import {
  createState,
  registerDevice,
  addSample,
  addConnectionEvent,
  addPolicyEvent,
  resolveConflict,
  correctRecord,
  STATUS_TEXT
} from "./engine.js";
import { createDemoState } from "./demo.js";

let state = createDemoState();
let selectedBatchId = state.batches[0]?.id || null;
let activeTab = "sample";
let activeDevice = "ALL";

const $ = selector => document.querySelector(selector);

function fmtTime(t) {
  if (t === null || t === undefined || Number.isNaN(Number(t))) return "—";
  return new Date(Number(t)).toLocaleString("zh-CN", { hour12: false });
}

function fmtInput(t) {
  const d = new Date(t || Date.now());
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtInputSeconds(t) {
  const d = new Date(t);
  const pad = n => String(n).padStart(2, "0");
  const aligned = new Date(Math.floor(d.getTime() / 10_000) * 10_000);
  return `${aligned.getFullYear()}-${pad(aligned.getMonth() + 1)}-${pad(aligned.getDate())}T${pad(aligned.getHours())}:${pad(aligned.getMinutes())}:${pad(aligned.getSeconds())}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

function deviceName(id) {
  return state.devices[id]?.name || id;
}

function batchTitle(batch) {
  const range = batch.mode === "count"
    ? `序号 ${batch.startSeq}–${batch.endSeq}`
    : `${fmtTime(batch.startAt)} 至 ${fmtTime(batch.endAt)}`;
  return `${deviceName(batch.deviceId)} · ${batch.mode === "count" ? "数量批次" : "时间批次"} · ${range}`;
}

function findRecord(id) {
  return state.records.find(r => r.id === id);
}

function renderDeviceFilter() {
  const ids = ["ALL", ...new Set(state.batches.map(b => b.deviceId))];
  if (!ids.includes(activeDevice)) activeDevice = "ALL";
  $("#deviceFilter").innerHTML = ids.map(id => `<option value="${id}">${id === "ALL" ? "全部设备" : escapeHtml(deviceName(id))}</option>`).join("");
  $("#deviceFilter").value = activeDevice;
}

function renderResume() {
  $("#resumeStrip").innerHTML = state.resume.map(r => `
    <article class="resume-card">
      <span class="hint">${escapeHtml(deviceName(r.deviceId))}</span>
      <strong>${r.delivered ? `从序号 ${r.resumeSeq} 续采` : "尚无有效锚点"}</strong>
      <div class="hint">连续锚点：${r.anchorSeq ?? "—"} · 当前连接：${r.connection === "connected" ? "已连接" : r.connection === "disconnected" ? "断开" : "未知"}</div>
      <div class="meta">${escapeHtml(r.note)}${r.missingSeq.length ? `；历史空洞：${r.missingSeq.join(", ")}` : ""}</div>
    </article>
  `).join("");
}

function renderBatchCard(batch) {
  const seqHtml = batch.slots.map(slot => {
    const conflictClass = slot.conflictId ? " conflict" : "";
    const label = slot.status === "missing"
      ? `${slot.seq}<br><small>缺</small>`
      : `${slot.seq}${slot.duplicateRecordIds.length > 1 ? `<br><small>×${slot.duplicateRecordIds.length}</small>` : ""}`;
    return `<span class="seq ${slot.status}${conflictClass}" title="${escapeHtml(slot.reason || "")}">${label}</span>`;
  }).join("");
  const reason = batch.status === "complete"
    ? `${batch.deliveredCount} 个槽位均已交付，批次闭合`
    : batch.reason;
  const connectionBadge = batch.evidence.some(e => e.kind === "connection")
    ? `<span class="mini-badge connection">连接变化</span>` : "";
  const boundaryBadge = batch.closeEventId
    ? `<span class="mini-badge boundary">切批事件 ${escapeHtml(batch.closeEventId)}</span>` : "";
  return `
    <article class="batch-card ${batch.status} ${batch.id === selectedBatchId ? "selected" : ""}" data-id="${batch.id}">
      <div class="batch-top">
        <div>
          <strong>${escapeHtml(batchTitle(batch))}</strong>
          <div class="meta">已交付 ${batch.deliveredCount} / ${batch.slots.length} · ${batch.closed ? "物理批次已闭合" : "当前批次仍开放"} ${connectionBadge}${boundaryBadge}</div>
        </div>
        <span class="badge ${batch.status}">${STATUS_TEXT[batch.status]}</span>
      </div>
      <div class="seq-strip">${seqHtml}</div>
      <div class="meta">${escapeHtml(reason)}</div>
    </article>`;
}

function renderBatches() {
  const batches = state.batches.filter(b => activeDevice === "ALL" || b.deviceId === activeDevice);
  $("#batchTimeline").innerHTML = batches.map(renderBatchCard).join("") || `<p class="hint">暂无批次，请先录入采样。</p>`;
  document.querySelectorAll(".batch-card").forEach(card => {
    card.addEventListener("click", () => {
      selectedBatchId = card.dataset.id;
      renderAll(false);
    });
  });
  const push = state.lastPush;
  if (push) {
    $("#pushInfo").textContent = push.fullReplay
      ? "已完成全量推演"
      : `事件 ${push.eventId}：仅重推 ${push.changedBatchIds.length} 个变化批次（与全量重放同源）`;
    for (const id of push.changedBatchIds) {
      document.querySelector(`.batch-card[data-id="${id}"]`)?.classList.add("push-flash");
    }
  }
}

function renderDetail() {
  const batch = state.batches.find(b => b.id === selectedBatchId);
  $("#selectedTitle").textContent = batch ? batchTitle(batch) : "选择一个批次查看依据";
  if (!batch) {
    $("#batchDetail").innerHTML = `<p class="hint">点击上方批次卡片查看证据。</p>`;
    return;
  }
  const recordIds = new Set();
  batch.evidence.forEach(e => e.recordIds.forEach(id => recordIds.add(id)));
  const records = [...recordIds].map(findRecord).filter(Boolean);
  const accepted = batch.slots
    .filter(s => s.status === "delivered")
    .map(s => s.delivered)
    .filter(rec => rec.resolvedBy || rec.correctedBy)
    .filter(rec => !records.some(r => r.id === rec.id));
  records.push(...accepted);
  const evidenceHtml = batch.evidence.map(e => `
    <div class="evidence ${e.kind}">
      <strong>${escapeHtml(e.message)}</strong>
      <div class="hint">记录：${e.recordIds.length ? e.recordIds.map(escapeHtml).join(", ") : "无"} ｜ 事件：${e.eventIds.length ? e.eventIds.map(escapeHtml).join(", ") : "无"}</div>
    </div>
  `).join("");
  const recordsHtml = records.map(rec => `
    <div class="record-row">
      <span><strong>${escapeHtml(rec.id)}</strong> · #${rec.seq} · ${escapeHtml(rec.value)}</span>
      <span>${fmtTime(rec.sampleAt)}</span>
    </div>
    <div class="hint">接收 ${fmtTime(rec.receivedAt)} · ${escapeHtml(rec.source || "手动录入")}${rec.correctedBy ? ` · 已被 ${rec.correctedBy} 修正` : ""}${rec.resolvedBy ? ` · 已由 ${rec.resolvedBy} 裁决` : ""}</div>
    ${rec.resolvedBy ? "" : `<button class="ghost" data-correct="${rec.id}">修正时刻/数值</button>`}
  `).join("");
  $("#batchDetail").innerHTML = `
    <div><h3>结论依据</h3>${evidenceHtml || `<p class="hint">暂无证据</p>`}</div>
    <div>
      <h3>采信与重复记录</h3>
      ${recordsHtml || `<p class="hint">没有关联记录</p>`}
    </div>`;
  document.querySelectorAll("[data-correct]").forEach(button => {
    button.addEventListener("click", () => correctInteractively(button.dataset.correct));
  });
}

function correctInteractively(recordId) {
  const rec = findRecord(recordId);
  if (!rec) return;
  const nextValue = prompt(`修正记录 ${recordId} (#${rec.seq}) 的数值。留空表示不改数值。`, rec.value);
  if (nextValue === null) return;
  const nextTime = prompt("修正采样时刻（本地日期时间，留空表示不改时刻）。", fmtInput(rec.sampleAt));
  if (nextTime === null) return;
  const input = { recordId };
  if (nextValue.trim()) input.value = nextValue;
  if (nextTime.trim()) input.sampleAt = nextTime;
  correctRecord(state, input);
  renderAll();
}

function renderConflicts() {
  if (!state.conflicts.length) {
    $("#conflictList").innerHTML = `<p class="hint">当前没有冲突。</p>`;
    return;
  }
  $("#conflictList").innerHTML = state.conflicts.map(conflict => {
    const rows = conflict.records.map(rec => `
      <div class="record-row">
        <span>${escapeHtml(rec.id)}：${escapeHtml(rec.value)}</span>
        <span>${fmtTime(rec.sampleAt)}</span>
      </div>
    `).join("");
    return `
      <article class="conflict-item">
        <strong>${escapeHtml(deviceName(conflict.deviceId))} #${conflict.seq}</strong>
        <span class="badge ${conflict.status === "open" ? "untrusted" : "complete"}">${conflict.status === "open" ? "待裁决" : "已裁决"}</span>
        ${rows}
        <div class="meta">系统不静默择一；请选择保留版本或输入人工值。</div>
        <div class="form-grid">
          <button data-resolve="${conflict.deviceId}|${conflict.seq}|a">采信首个</button>
          <button data-resolve="${conflict.deviceId}|${conflict.seq}|b">采信最新</button>
          <button class="secondary wide" data-custom="${conflict.deviceId}|${conflict.seq}">输入人工裁决值</button>
        </div>
      </article>`;
  }).join("");
  document.querySelectorAll("[data-resolve]").forEach(button => {
    button.addEventListener("click", () => {
      const [deviceId, seq, resolution] = button.dataset.resolve.split("|");
      resolveConflict(state, { deviceId, seq: Number(seq), resolution });
      renderAll();
    });
  });
  document.querySelectorAll("[data-custom]").forEach(button => {
    button.addEventListener("click", () => {
      const [deviceId, seqText] = button.dataset.custom.split("|");
      const value = prompt(`输入 ${deviceName(deviceId)} 序号 ${seqText} 的人工裁决值`);
      if (value !== null && value.trim() !== "") {
        resolveConflict(state, { deviceId, seq: Number(seqText), resolution: "custom", value });
        renderAll();
      }
    });
  });
}

function renderUnassigned() {
  if (!state.unassignable.length) {
    $("#unassignedList").innerHTML = `<p class="hint">所有有效对象均已显式归属。</p>`;
    return;
  }
  $("#unassignedList").innerHTML = state.unassignable.map(item => `
    <article class="orphan-item">
      <strong>${escapeHtml(item.deviceId || "未知设备")} · ${escapeHtml(item.seq ?? item.recordId ?? "缺口")}</strong>
      <div class="hint">${escapeHtml(item.reason || "无法归属到批次")}</div>
    </article>
  `).join("");
}

function renderForm() {
  const deviceOptions = ["PUMP-A", "TEMP-B"].map(id => `<option value="${id}">${escapeHtml(deviceName(id))}</option>`).join("");
  let html = `<input type="hidden" name="kind" value="${activeTab}">
    <label>设备</label><select name="deviceId">${deviceOptions}<option value="NEW">新设备...</option></select>`;
  if (activeTab === "sample") {
    html += `
      <div class="form-grid">
        <div><label>序号</label><input name="seq" type="number" required></div>
        <div><label>数值</label><input name="value" required></div>
        <div class="wide"><label>采样时刻</label><input name="sampleAt" type="datetime-local" step="1" value="${fmtInputSeconds(Date.now())}"></div>
      </div>`;
  } else if (activeTab === "connection") {
    html += `
      <div class="form-grid">
        <div><label>状态</label><select name="status"><option value="disconnected">断开</option><option value="connected">重连</option></select></div>
        <div><label>时刻</label><input name="at" type="datetime-local" step="1" value="${fmtInput(Date.now())}"></div>
        <div class="wide"><label>原因</label><input name="reason" placeholder="例如：网关离线 / 人工恢复"></div>
      </div>`;
  } else {
    html += `
      <div class="form-grid">
        <div><label>切批方式</label><select name="mode"><option value="count">数量阈值</option><option value="time">时间窗口</option></select></div>
        <div><label>生效时刻</label><input name="at" type="datetime-local" step="1" value="${fmtInput(Date.now())}"></div>
        <div><label>数量（条）</label><input name="count" type="number" value="4" min="1"></div>
        <div><label>时间窗（毫秒）</label><input name="windowMs" type="number" value="60000" min="1000"></div>
        <div class="wide"><label>说明</label><input name="note" placeholder="阈值调整原因"></div>
      </div>`;
  }
  html += `<button type="submit" class="wide">追加事件并重放</button>`;
  $("#eventForm").innerHTML = html;
}

function formData() {
  return Object.fromEntries(new FormData($("#eventForm")).entries());
}

function resolveDevice(input) {
  if (input.deviceId !== "NEW") return input.deviceId;
  const deviceId = prompt("输入新设备标识", "PUMP-C");
  if (!deviceId) throw new Error("需要设备标识");
  registerDevice(state, deviceId, {
    name: deviceId,
    defaultPolicy: { mode: "count", count: 4 },
    expectedIntervalMs: 10_000
  });
  return deviceId;
}

function renderAll(scrollToChange = true) {
  renderDeviceFilter();
  renderResume();
  renderBatches();
  renderDetail();
  renderConflicts();
  renderUnassigned();
  renderForm();
  if (scrollToChange && state.lastPush?.changedBatchIds?.length) {
    document.querySelector(`.batch-card[data-id="${state.lastPush.changedBatchIds[0]}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

$(".tabs").addEventListener("click", event => {
  if (!event.target.dataset.tab) return;
  activeTab = event.target.dataset.tab;
  document.querySelectorAll(".tab").forEach(tab => tab.classList.toggle("active", tab === event.target));
  renderForm();
});

$("#deviceFilter").addEventListener("change", event => {
  activeDevice = event.target.value;
  renderBatches();
});

$("#eventForm").addEventListener("submit", event => {
  event.preventDefault();
  try {
    const input = formData();
    const deviceId = resolveDevice(input);
    if (activeTab === "sample") {
      addSample(state, {
        deviceId,
        seq: Number(input.seq),
        value: input.value,
        sampleAt: input.sampleAt,
        receivedAt: new Date(),
        source: "交互录入"
      });
    } else if (activeTab === "connection") {
      addConnectionEvent(state, { deviceId, status: input.status, at: input.at, reason: input.reason });
    } else {
      addPolicyEvent(state, {
        deviceId,
        mode: input.mode,
        count: Number(input.count),
        windowMs: Number(input.windowMs),
        at: input.at,
        note: input.note
      });
    }
    renderAll();
  } catch (error) {
    alert(error.message);
  }
});

$("#resetDemo").addEventListener("click", () => {
  state = createDemoState();
  selectedBatchId = state.batches[0]?.id || null;
  activeDevice = "ALL";
  renderAll(false);
});

renderAll(false);
