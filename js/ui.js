/* 界面层：渲染事项列表、详情、冲突裁决、增量更新展示 */
(function () {
  "use strict";
  const Engine = window.HandoverEngine;
  const STATUS_LABEL = { complete: "可完成", partial: "部分完整", untrusted: "不可信", blocked: "待裁决" };
  const STATUS_BADGE = { complete: "badge-ok", partial: "badge-part", untrusted: "badge-bad", blocked: "badge-blocked" };
  const FILL_CLASS = { complete: "fill-ok", partial: "fill-part", untrusted: "fill-bad", blocked: "fill-blocked" };
  const LS_KEY = "handover-state-v1";

  let state, engine, selectedId = null, lastAffected = [];

  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* 忽略损坏缓存 */ }
    return makeSampleData();
  }
  function persist() { localStorage.setItem(LS_KEY, JSON.stringify(state)); }

  function init() {
    state = loadState();
    engine = new Engine(state);
    engine.fullDerive();
    renderAll();
    bindGlobalActions();
    logChange("系统启动：已全量推导 " + state.items.length + " 项交接事项");
  }


  /* ===== 渲染：整体 ===== */
  function renderAll() {
    renderGlobalStats();
    renderItemList();
    renderDetail();
  }

  function renderGlobalStats() {
    const vals = [...engine.results.values()];
    const avg = vals.length ? Math.round(vals.reduce((s, r) => s + r.completeness, 0) / vals.length) : 0;
    document.getElementById("global-completeness").textContent = avg + "%";
    const v = engine.verifyConsistency();
    const badge = document.getElementById("consistency-badge");
    badge.textContent = v.consistent ? "增量=全量 ✓" : ("不一致：" + v.itemId);
    badge.className = "badge " + (v.consistent ? "badge-ok" : "badge-bad");
  }

  /* ===== 渲染：事项列表 ===== */
  function renderItemList() {
    const box = document.getElementById("item-list");
    box.innerHTML = "";
    for (const it of state.items) {
      const r = engine.results.get(it.id);
      const card = document.createElement("div");
      card.className = "item-card" + (it.id === selectedId ? " selected" : "") +
        (lastAffected.includes(it.id) ? " flash" : "");
      card.dataset.itemId = it.id;
      card.innerHTML =
        '<div class="item-head">' +
          '<span class="item-id">' + esc(it.id) + '</span>' +
          '<span class="item-title">' + esc(it.title) + '</span>' +
          '<span class="badge ' + STATUS_BADGE[r.status] + '">' + STATUS_LABEL[r.status] + '</span>' +
        '</div>' +
        '<div class="item-role">责任角色：' + esc(it.role) + '</div>' +
        '<div class="completeness-bar"><div class="completeness-fill ' + FILL_CLASS[r.status] +
          '" style="width:' + r.completeness + '%"></div></div>' +
        '<div class="item-meta-row"><span>完整度 ' + r.completeness + '%</span>' +
          '<span>' + (it.deadline ? "截止 " + it.deadline.slice(0, 10) : "无时限") + '</span></div>';
      card.onclick = () => { selectedId = it.id; lastAffected = []; renderAll(); };
      box.appendChild(card);
    }
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g,
      c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ===== 渲染：详情面板 ===== */
  function renderDetail() {
    const empty = document.getElementById("detail-empty");
    const box = document.getElementById("detail-content");
    const it = state.items.find(i => i.id === selectedId);
    if (!it) { empty.hidden = false; box.hidden = true; return; }
    empty.hidden = true; box.hidden = false;
    const r = engine.results.get(it.id);
    let html =
      '<h2>' + esc(it.title) + ' <span class="badge ' + STATUS_BADGE[r.status] + '">' +
        STATUS_LABEL[r.status] + ' ' + r.completeness + '%</span></h2>' +
      '<div class="detail-meta">' +
        '<span>编号 <b>' + esc(it.id) + '</b></span>' +
        '<span>责任角色 <b>' + esc(it.role) + '</b></span>' +
        '<span>时效 <b>' + (it.deadline ? esc(it.deadline) : "无") + '</b></span>' +
        '<span>来源 <b>' + esc(it.sourceNote || "—") + '</b></span>' +
      '</div>';

    // 依赖
    html += '<div class="section"><h3>前置依赖（' + it.dependsOn.length + '）</h3>';
    if (!it.dependsOn.length) html += '<div class="empty-hint" style="padding:8px">无前置依赖</div>';
    for (const depId of it.dependsOn) {
      const dep = state.items.find(i => i.id === depId);
      if (!dep) {
        html += '<div class="dep-row"><span class="dep-missing">⚠ ' + esc(depId) + '（事项不存在，依赖缺失）</span></div>';
      } else {
        const dr = engine.results.get(depId);
        html += '<div class="dep-row"><span class="item-id">' + esc(depId) + '</span>' +
          '<span class="dep-title"><a href="#" data-goto="' + esc(depId) + '">' + esc(dep.title) + '</a></span>' +
          '<span class="badge ' + STATUS_BADGE[dr.status] + '">' + STATUS_LABEL[dr.status] + '</span></div>';
      }
    }
    html += '</div>';

    // 冲突裁决
    if (r.conflicts.length) {
      html += '<div class="section"><h3>来源冲突（需裁决后才能继续推导）</h3>';
      for (const cf of r.conflicts) {
        html += '<div class="conflict-box"><h4>「' + esc(cf.key) + '」存在矛盾来源，双方均已保留：</h4>';
        for (const cid of cf.ctxIds) {
          const c = state.contexts.find(x => x.id === cid);
          html += '<div class="conflict-option">' +
            '<span class="ctx-value">' + esc(c.value) + '</span>' +
            '<span class="ctx-source">来源：' + esc(c.source) + '</span>' +
            '<button class="btn btn-primary btn-small" data-adopt="' + esc(c.id) + '">采用此版本</button>' +
          '</div>';
        }
        html += '</div>';
      }
      html += '</div>';
    }

    // 上下文条目
    const ctxs = state.contexts.filter(c => c.itemId === it.id);
    html += '<div class="section"><h3>上下文条目（' + ctxs.length + '）' +
      '<button class="btn btn-small" id="btn-add-ctx" style="margin-left:8px">+ 添加上下文</button></h3>';
    if (!ctxs.length) html += '<div class="empty-hint" style="padding:8px">暂无上下文条目</div>';
    for (const c of ctxs) {
      const cs = r.contextStates[c.id] || { trusted: false, note: "" };
      const cls = c.status !== "active" ? "ctx-rejected" : (cs.trusted ? "ctx-chosen" : "");
      html += '<div class="ctx-row ' + cls + '">' +
        '<span class="ctx-key">' + esc(c.key) + '</span>' +
        '<input class="inline-input ctx-value" data-edit-value="' + esc(c.id) + '" value="' + esc(c.value) + '">' +
        '<span class="ctx-source">来源：' + esc(c.source) + '</span>' +
        '<input class="inline-input" style="width:165px" type="datetime-local" data-edit-expiry="' + esc(c.id) + '" value="' + esc(c.expiresAt || "") + '" title="有效期至">' +
        '<span class="' + (cs.trusted ? "" : "ctx-expired") + '">' + esc(c.status !== "active" ? "已弃用" : cs.note) + '</span>' +
      '</div>';
    }
    html += '</div>';

    // 推导依据
    html += '<div class="section"><h3>推导依据</h3><ul class="reason-list">';
    for (const rs of r.reasons) html += '<li class="reason-' + rs.level + '">' + esc(rs.text) + '</li>';
    if (!r.reasons.length) html += '<li class="reason-ok">无异常</li>';
    html += '</ul></div>';

    // 受影响链路
    if (lastAffected.length) {
      html += '<div class="section"><h3>本次增量重推影响链路</h3><div class="affected-chain">' +
        lastAffected.map(id => '<span class="chain-node">' + esc(id) + '</span>').join('<span class="chain-arrow">→</span>') +
        '</div></div>';
    }
    html += '<div class="section"><h3>变更记录</h3><div id="change-log"></div></div>';

    box.innerHTML = html;
    bindDetailEvents(box);
    renderChangeLog();
  }

  /* ===== 详情事件 ===== */
  function bindDetailEvents(box) {
    box.querySelectorAll("[data-goto]").forEach(a => a.onclick = e => {
      e.preventDefault(); selectedId = a.dataset.goto; lastAffected = []; renderAll();
    });
    box.querySelectorAll("[data-adopt]").forEach(b => b.onclick = () => adjudicate(b.dataset.adopt));
    box.querySelectorAll("[data-edit-value]").forEach(inp => inp.onchange = () =>
      editContext(inp.dataset.editValue, { value: inp.value }));
    box.querySelectorAll("[data-edit-expiry]").forEach(inp => inp.onchange = () =>
      editContext(inp.dataset.editExpiry, { expiresAt: inp.value || null }));
    const addBtn = box.querySelector("#btn-add-ctx");
    if (addBtn) addBtn.onclick = addContext;
  }

  /* ===== 变更操作：统一走增量重推 ===== */
  const changeLog = [];
  function logChange(msg) {
    changeLog.unshift(new Date().toLocaleTimeString() + "  " + msg);
    if (changeLog.length > 50) changeLog.pop();
    renderChangeLog();
  }
  function renderChangeLog() {
    const el = document.getElementById("change-log");
    if (el) el.innerHTML = changeLog.map(esc).map(t => "<div>" + t + "</div>").join("");
  }

  function applyMutation(changedItemId, desc) {
    const { affected } = engine.incrementalDerive([changedItemId]);
    lastAffected = affected;
    persist();
    renderAll();
    const v = engine.verifyConsistency();
    logChange(desc + "；增量重推 " + affected.length + " 项（" + affected.join("、") + "），一致性：" +
      (v.consistent ? "与全量重推一致 ✓" : "不一致 ✗"));
    toast(desc);
  }

  function adjudicate(ctxId) {
    const chosen = state.contexts.find(c => c.id === ctxId);
    if (!chosen) return;
    for (const c of state.contexts) {
      if (c.itemId === chosen.itemId && c.key === chosen.key && c.id !== ctxId && c.status === "active") {
        c.status = "superseded"; // 保留展示，不删除
      }
    }
    applyMutation(chosen.itemId, "裁决「" + chosen.key + "」采用来源「" + chosen.source + "」的版本，冲突双方均已保留");
  }

  function editContext(ctxId, patch) {
    const c = state.contexts.find(x => x.id === ctxId);
    if (!c) return;
    Object.assign(c, patch);
    applyMutation(c.itemId, "修改上下文「" + c.key + "」（" + Object.keys(patch).join("/") + "）");
  }

  function addContext() {
    const key = prompt("上下文键名（如：切换窗口）");
    if (!key) return;
    const value = prompt("取值");
    if (value == null) return;
    const source = prompt("来源说明", "手工录入") || "手工录入";
    const id = "C-" + String(Date.now()).slice(-6);
    state.contexts.push({ id, itemId: selectedId, key, value, source, expiresAt: null, status: "active" });
    applyMutation(selectedId, "新增上下文「" + key + "」");
  }

  /* ===== 全局动作 ===== */
  function bindGlobalActions() {
    document.getElementById("btn-reset").onclick = () => {
      if (!confirm("重置为内置示例数据？当前修改将丢失。")) return;
      state = makeSampleData();
      engine = new Engine(state);
      engine.fullDerive();
      selectedId = null; lastAffected = [];
      persist(); renderAll();
      logChange("已重置为示例数据并全量重推");
    };
    document.getElementById("btn-export").onclick = () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "handover-state.json";
      a.click();
    };
    const fileInput = document.getElementById("import-file");
    document.getElementById("btn-import").onclick = () => fileInput.click();
    fileInput.onchange = () => {
      const f = fileInput.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!Array.isArray(data.items) || !Array.isArray(data.contexts)) throw new Error("格式不正确");
          state = data;
          engine = new Engine(state);
          engine.fullDerive();
          selectedId = null; lastAffected = [];
          persist(); renderAll();
          logChange("已导入 JSON 并全量重推");
        } catch (e) { toast("导入失败：" + e.message); }
      };
      reader.readAsText(f);
    };
    const dlg = document.getElementById("add-item-dialog");
    document.getElementById("btn-add-item").onclick = () => dlg.showModal();
    document.getElementById("add-item-form").addEventListener("submit", e => {
      if (e.submitter && e.submitter.value !== "ok") return;
      const fd = new FormData(e.target);
      const id = "H-" + String(state.items.length + 1).padStart(2, "0") + "-" + String(Date.now()).slice(-3);
      state.items.push({
        id,
        title: fd.get("title"),
        role: fd.get("role"),
        dependsOn: String(fd.get("dependsOn") || "").split(",").map(s => s.trim()).filter(Boolean),
        deadline: fd.get("deadline") || null,
        sourceNote: fd.get("sourceNote") || "",
      });
      engine.fullDerive(); // 新事项可能改变任意链路的环结构，做全量
      selectedId = id; lastAffected = [];
      persist(); renderAll();
      logChange("新增事项 " + id + "，已全量重推");
      e.target.reset();
    });
  }

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
