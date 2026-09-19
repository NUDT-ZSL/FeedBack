/* 界面装配：帧循环、页面可见性生命周期、表单校验展示与渲染。 */
(function () {
  "use strict";
  var scheduler = Scheduler.createScheduler({ shardSize: 10, frameBudget: 6 });
  var engineOn = true;
  var simulatedHidden = false;
  var selectedTaskId = null;
  var lastStepAt = 0;

  function $(id) { return document.getElementById(id); }
  var els = {
    engineState: $("engineState"), pageState: $("pageState"),
    frameBudget: $("frameBudget"), shardSize: $("shardSize"), stepInterval: $("stepInterval"),
    toggleEngine: $("toggleEngine"), toggleVisibility: $("toggleVisibility"), clearFinished: $("clearFinished"),
    addForm: $("addForm"), taskId: $("taskId"), totalWork: $("totalWork"), priority: $("priority"),
    batchText: $("batchText"), batchAdd: $("batchAdd"), formErrors: $("formErrors"),
    taskTableBody: $("taskTableBody"), queueMeta: $("queueMeta"),
    shardPanel: $("shardPanel"), shardTaskLabel: $("shardTaskLabel"), eventLog: $("eventLog"),
  };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var STATUS_TEXT = { active: "推进中", queued: "排队中", paused: "已暂停", done: "已完成", cancelled: "已取消" };

  // 演示数据：启动后即可看到队列、分片切小与顺延行为
  scheduler.addTasks([
    { id: "render-A", totalWork: 36, priority: 5 },
    { id: "hash-C", totalWork: 55, priority: 8 },
    { id: "compress-B", totalWork: 24, priority: 3 },
    { id: "index-D", totalWork: 18, priority: 1 },
  ]);

  function effectiveLifecycle() {
    return (!document.hidden && !simulatedHidden) ? "visible" : "hidden";
  }
  function syncLifecycle() {
    scheduler.setLifecycle(effectiveLifecycle());
    render();
  }
  document.addEventListener("visibilitychange", syncLifecycle);

  // 帧循环：每个动画帧按步进间隔节流推进一次；页面隐藏时浏览器停发帧，
  // 模拟隐藏时引擎 step 会因生命周期为 hidden 而空转，两种路径都不会计入工作量。
  function frame(now) {
    var interval = Math.max(30, Number(els.stepInterval.value) || 250);
    if (engineOn && now - lastStepAt >= interval) {
      lastStepAt = now;
      scheduler.config.frameBudget = Math.max(0, Number(els.frameBudget.value) || 0);
      scheduler.config.shardSize = Math.max(1, Number(els.shardSize.value) || 1);
      scheduler.step();
      render();
    }
    requestAnimationFrame(frame);
  }

  function showErrors(errors) {
    els.formErrors.innerHTML = errors.length
      ? "<ul>" + errors.map(function (e) { return "<li>" + esc(e) + "</li>"; }).join("") + "</ul>"
      : "";
  }

  els.addForm.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var item = {
      id: els.taskId.value.trim(),
      totalWork: Number(els.totalWork.value),
      priority: els.priority.value === "" ? 0 : Number(els.priority.value),
    };
    var res = scheduler.addTasks([item]);
    showErrors(res.ok ? [] : res.errors.map(function (e) { return e.message; }));
    if (res.ok) { els.taskId.value = ""; els.totalWork.value = ""; }
    render();
  });

  els.batchAdd.addEventListener("click", function () {
    var lines = els.batchText.value.split(/\r?\n/);
    var items = [];
    var errors = [];
    lines.forEach(function (line, i) {
      var text = line.trim();
      if (!text) return;
      var parts = text.split(/[,，\s]+/).filter(Boolean);
      if (parts.length < 2 || parts.length > 3) {
        errors.push("第 " + (i + 1) + " 行：格式应为「标识,总工作量,优先级」");
        return;
      }
      var p = parts.length === 3 ? Number(parts[2]) : 0;
      if (parts.length === 3 && !isFinite(p)) {
        errors.push("第 " + (i + 1) + " 行：优先级必须是数字");
        return;
      }
      items.push({ id: parts[0], totalWork: Number(parts[1]), priority: p, line: i + 1 });
    });
    if (errors.length === 0 && items.length > 0) {
      var res = scheduler.addTasks(items);
      if (!res.ok) {
        // 引擎错误携带批内下标，这里映射回用户可见的行号，指出出错位置
        errors = res.errors.map(function (e) {
          var line = items[e.index] ? items[e.index].line : e.index + 1;
          return "第 " + line + " 行：" + e.message;
        });
      } else {
        els.batchText.value = "";
      }
    } else if (items.length === 0 && errors.length === 0) {
      errors = ["没有可提交的内容"];
    }
    showErrors(errors);
    render();
  });

  els.toggleEngine.addEventListener("click", function () {
    engineOn = !engineOn;
    els.toggleEngine.textContent = engineOn ? "暂停调度" : "恢复调度";
    render();
  });
  els.toggleVisibility.addEventListener("click", function () {
    simulatedHidden = !simulatedHidden;
    els.toggleVisibility.textContent = simulatedHidden ? "模拟页面恢复" : "模拟页面隐藏";
    syncLifecycle();
  });
  els.clearFinished.addEventListener("click", function () {
    scheduler.removeFinished();
    if (selectedTaskId && !scheduler.query(selectedTaskId)) selectedTaskId = null;
    render();
  });
  els.taskTableBody.addEventListener("click", function (ev) {
    var btn = ev.target.closest("button[data-act]");
    if (btn) {
      var id = btn.getAttribute("data-id");
      if (btn.getAttribute("data-act") === "cancel") {
        scheduler.cancel(id);
      } else {
        var q = scheduler.query(id);
        if (q) scheduler.setPriority(id, q.priority + Number(btn.getAttribute("data-delta")));
      }
      render();
      return;
    }
    var tr = ev.target.closest("tr[data-id]");
    if (tr) {
      selectedTaskId = tr.getAttribute("data-id");
      render();
    }
  });

  function rowHtml(q, order) {
    var pct = q.totalWork > 0 ? Math.round((100 * q.completedWork) / q.totalWork) : 0;
    var pos = q.pausePosition ? "分片 #" + q.pausePosition.shardIndex + " · 偏移 " + q.pausePosition.offset : "—";
    var last = q.lastEvent ? esc(q.lastEvent.detail) : "—";
    var defer = q.deferReason ? esc(q.deferReason) : "—";
    var actions = "";
    if (q.status !== "done" && q.status !== "cancelled") {
      actions = '<button data-act="prio" data-delta="1" data-id="' + esc(q.id) + '">优先级+</button>'
        + '<button data-act="prio" data-delta="-1" data-id="' + esc(q.id) + '">优先级-</button>'
        + '<button data-act="cancel" data-id="' + esc(q.id) + '" class="danger">取消</button>';
    }
    return '<tr class="st-' + q.status + (q.id === selectedTaskId ? " selected" : "") + '" data-id="' + esc(q.id) + '">'
      + "<td>" + order + "</td>"
      + "<td>" + esc(q.id) + "</td>"
      + "<td>" + q.priority + "</td>"
      + '<td><span class="badge st-' + q.status + '">' + STATUS_TEXT[q.status] + "</span></td>"
      + '<td><div class="bar"><div class="fill" style="width:' + pct + '%"></div></div>'
      + "<span>" + q.completedWork + "/" + q.totalWork + "</span></td>"
      + "<td>" + pos + "</td>"
      + '<td class="defer">' + defer + "</td>"
      + '<td class="event">' + last + "</td>"
      + '<td class="actions">' + actions + "</td>"
      + "</tr>";
  }

  function render() {
    var lifecycle = scheduler.getLifecycle();
    els.engineState.textContent = engineOn ? "调度运行中" : "调度已手动暂停";
    els.engineState.className = "badge " + (engineOn ? "ok" : "warn");
    els.pageState.textContent = lifecycle === "visible" ? "页面可见" : "页面隐藏 · 暂停保位";
    els.pageState.className = "badge " + (lifecycle === "visible" ? "ok" : "warn");

    var all = scheduler.queryAll();
    var queue = scheduler.getQueue();
    var byId = {};
    all.forEach(function (q) { byId[q.id] = q; });
    var doneCount = all.filter(function (q) { return q.status === "done"; }).length;
    var cancelledCount = all.filter(function (q) { return q.status === "cancelled"; }).length;
    els.queueMeta.textContent = "待推进 " + queue.length + " · 已完成 " + doneCount + " · 已取消 " + cancelledCount;

    // 行顺序：待推进按规划顺序在前，已完成、已取消在后
    var rows = [];
    queue.forEach(function (id, i) { rows.push(rowHtml(byId[id], i + 1)); });
    all.forEach(function (q) { if (q.status === "done") rows.push(rowHtml(q, "—")); });
    all.forEach(function (q) { if (q.status === "cancelled") rows.push(rowHtml(q, "—")); });
    els.taskTableBody.innerHTML = rows.join("");

    renderShards();
    renderLog();
  }

  function renderShards() {
    var q = selectedTaskId ? scheduler.query(selectedTaskId) : null;
    if (!q) {
      var queue = scheduler.getQueue();
      var fallback = queue.length ? scheduler.query(queue[0]) : scheduler.queryAll()[0] || null;
      selectedTaskId = fallback ? fallback.id : null;
      q = fallback;
    }
    if (!q) {
      els.shardTaskLabel.textContent = "";
      els.shardPanel.innerHTML = "<p>暂无任务</p>";
      return;
    }
    els.shardTaskLabel.textContent = "任务 " + q.id + " · 剩余分片 " + q.remainingShards.length + "/" + q.shardCount;
    var current = q.pausePosition ? q.pausePosition.shardIndex : -1;
    els.shardPanel.innerHTML = q.shards.map(function (s) {
      var pct = s.work > 0 ? Math.round((100 * s.done) / s.work) : 0;
      var cls = "shard" + (s.left === 0 ? " done" : "") + (s.index === current && q.status !== "done" ? " current" : "");
      return '<div class="' + cls + '">#' + s.index + " · " + s.done + "/" + s.work
        + '<div class="bar"><div class="fill" style="width:' + pct + '%"></div></div>'
        + (s.index === current && q.status !== "done" ? "暂停/续起于偏移 " + s.done : (s.left === 0 ? "已完成" : "待推进"))
        + "</div>";
    }).join("");
  }

  function renderLog() {
    var entries = scheduler.getLog(40).slice().reverse();
    els.eventLog.innerHTML = entries.map(function (e) {
      return "<li>#" + e.at + ' <span class="tag">' + esc(e.type) + "</span>"
        + (e.taskId ? '<span class="tid">[' + esc(e.taskId) + "]</span>" : "")
        + esc(e.detail) + "</li>";
    }).join("");
  }

  render();
  requestAnimationFrame(frame);
})();
