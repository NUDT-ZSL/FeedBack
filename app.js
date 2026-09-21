(function (root) {
  "use strict";

  var els = {};
  var store = new root.SearchStore();
  var timers = [];

  function $(id) { return document.getElementById(id); }

  function currentInput() {
    return root.SearchStore.normalizeInput({
      query: els.query.value,
      filter: els.filter.value,
      page: parseInt(els.page.value, 10) || 1
    });
  }

  function clearTimersForRun(runId) {
    timers = timers.filter(function (timer) {
      if (timer.runId === runId) {
        clearTimeout(timer.handle);
        return false;
      }
      return true;
    });
  }

  function scheduleBatch(contextKey, runId, input, index) {
    var delay = 750 + index * 650;
    var handle = setTimeout(function () {
      var result = store.ingestBatch({
        contextKey: contextKey,
        runId: runId,
        totalBatches: root.SearchSimulator.totalBatches,
        batch: root.SearchSimulator.makeBatch(input, index)
      });
      if (result.state === "superseded-run") clearTimersForRun(runId);
    }, delay);
    timers.push({ runId: runId, handle: handle });
  }

  function startSearch(options) {
    var input = currentInput();
    var token = store.startContext(input, options);
    if (!token.reused) {
      for (var i = 0; i < root.SearchSimulator.totalBatches; i += 1) {
        scheduleBatch(token.key, token.runId, input, i);
      }
    }
    render();
  }

  function injectConflict() {
    var ctx = store.getActive();
    if (!ctx) return;
    var input = { query: ctx.query, filter: ctx.filter, page: ctx.page };
    store.ingestBatch({
      contextKey: ctx.key,
      runId: ctx.runId,
      totalBatches: root.SearchSimulator.totalBatches,
      batch: root.SearchSimulator.makeConflictBatch(input)
    });
  }

  function retriggerContext(key) {
    var ctx = store.contexts.get(key);
    if (!ctx) return;
    clearTimersForRun(ctx.runId);
    els.query.value = ctx.query;
    els.filter.value = ctx.filter;
    els.page.value = ctx.page;
    startSearch({ force: true });
  }

  function statusText(ctx) {
    if (ctx.status === "complete") return "已完成";
    return "加载中";
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function renderContextTabs() {
    var tabs = [];
    store.contexts.forEach(function (ctx) {
      var view = store.deriveView(ctx.key);
      var state = ctx.key === store.activeKey ? " active" : "";
      var percent = Math.round(view.progress * 100);
      var warning = ctx.staleBatchCount ? '<span class="pill warn">' + ctx.staleBatchCount + " 批后台到达</span>" : "";
      tabs.push('<button class="tab' + state + '" data-action="switch" data-key="' + esc(ctx.key) + '">' +
        '<span class="tab-title">' + esc(ctx.title) + "</span>" +
        '<span class="tab-meta">' + statusText(ctx) + " · " + percent + "%</span>" + warning + "</button>");
    });
    els.contexts.innerHTML = tabs.join("") || '<p class="muted">尚无上下文</p>';
  }

  function renderResults(view) {
    if (!view.rows.length) {
      return '<div class="empty">第一批结果尚未到达。切换条件不会取消它，切回本上下文即可继续查看缓存结果。</div>';
    }
    return view.rows.map(function (row) {
      var selected = row.selected;
      var badge = row.conflict
        ? '<span class="pill danger">' + (row.resolved ? "矛盾已裁决" : "位置矛盾") + "</span>"
        : '<span class="pill ok">一致</span>';
      var body = selected
        ? '<h4>' + esc(selected.item.title) + '<small>' + esc(root.SearchSimulator.typeLabel(selected.item.type)) + "</small></h4>" +
          '<p>' + esc(selected.item.content.summary) + "</p>" +
          '<p class="muted">批次 ' + esc(selected.batchId) + " · 分值 " + esc(selected.item.content.score) +
          " · 更新 " + esc(selected.item.content.updatedAt) + "</p>"
        : '<p class="danger-text">所有版本都已排除。</p>';
      var variants = row.variants.map(function (v) {
        var chosen = row.selected && row.selected.batchId === v.batchId ? "（当前展示）" : "";
        return '<button class="variant" data-action="choose" data-location="' + esc(row.locationId) +
          '" data-batch="' + esc(v.batchId) + '">采用 ' + esc(v.batchId) + chosen + "</button>";
      }).join("");
      return '<article class="result' + (row.conflict ? " conflict" : "") + '">' +
        '<div class="result-head"><span class="location">' + esc(row.locationId) + "</span>" + badge + "</div>" +
        body + '<div class="variant-row">' + variants + "</div></article>";
    }).join("");
  }

  function renderBatches(ctx) {
    if (!ctx.arrived.length) return '<p class="muted">等待第一批…</p>';
    return ctx.arrived.map(function (batch) {
      var excluded = ctx.decisions.excludedBatchIds.has(batch.id);
      var mode = excluded
        ? '<span class="pill danger">已排除</span><button data-action="restore" data-batch="' + esc(batch.id) + '">撤销排除</button>'
        : '<span class="pill ok">参与展示</span><button data-action="exclude" data-batch="' + esc(batch.id) + '">排除此批</button>';
      var arrival = batch.deliveredWhileInactive ? "后台到达 · 已缓存" : "当前上下文时到达";
      return '<li><strong>' + esc(batch.label) + " " + esc(batch.id) + "</strong>" +
        '<span class="muted">' + arrival + " · " + esc(batch.receivedAt) + "</span>" +
        '<div class="batch-actions">' + mode + "</div></li>";
    }).join("");
  }

  function renderStale() {
    if (!store.staleEvents.length) return '<p class="muted">暂无过期或后台批次。</p>';
    return store.staleEvents.slice(0, 8).map(function (event) {
      var discarded = event.reason === "superseded";
      var pill = discarded
        ? '<span class="pill danger">未写入：运行已过期</span>'
        : '<span class="pill warn">未渲染：已缓存到所属上下文</span>';
      var action = discarded
        ? '<button data-action="retrigger" data-key="' + esc(event.contextKey) + '">回到并重触发</button>'
        : '<button data-action="switch" data-key="' + esc(event.contextKey) + '">回到上下文继续等待</button>';
      return '<li><div>' + pill + "<strong>" + esc(event.title) + "</strong>" +
        '<span class="muted">' + esc(event.at) + " · 批次 " + esc(event.batchId || "全部") + "</span>" +
        '<p>' + esc(event.message) + "</p></div>" + action + "</li>";
    }).join("");
  }

  function render() {
    renderContextTabs();
    var ctx = store.getActive();
    if (!ctx) {
      els.summary.textContent = "";
      els.progressFill.style.width = "0%";
      els.progressText.textContent = "未开始";
      els.results.innerHTML = "";
      els.batches.innerHTML = "";
      els.stale.innerHTML = renderStale();
      return;
    }
    var view = store.deriveView(ctx.key);
    var percent = Math.round(view.progress * 100);
    els.summary.textContent = ctx.title + "｜运行 " + ctx.runId + "｜" + statusText(ctx) +
      "｜矛盾位置 " + view.conflicts.length + "｜已排除批次 " + view.excludedCount;
    els.progressFill.style.width = percent + "%";
    els.progressText.textContent = ctx.arrived.length + "/" + (ctx.totalBatches || "?") + " 批 · " + percent + "%";
    els.results.innerHTML = renderResults(view);
    els.batches.innerHTML = renderBatches(ctx);
    els.stale.innerHTML = renderStale();
  }

  document.addEventListener("DOMContentLoaded", function () {
    els.query = $("query");
    els.filter = $("filter");
    els.page = $("page");
    els.search = $("search");
    els.retry = $("retry");
    els.conflict = $("conflict");
    els.contexts = $("contexts");
    els.summary = $("summary");
    els.progressFill = $("progressFill");
    els.progressText = $("progressText");
    els.results = $("results");
    els.batches = $("batches");
    els.stale = $("stale");
    els.search.addEventListener("click", function () { startSearch(); });
    els.retry.addEventListener("click", function () {
      var active = store.getActive();
      if (active) retriggerContext(active.key);
    });
    els.conflict.addEventListener("click", injectConflict);
    document.body.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-action]");
      if (!button) return;
      var ctx = store.getActive();
      var action = button.dataset.action;
      var key = button.dataset.key;
      var batchId = button.dataset.batch;
      if (action === "switch") {
        store.setActive(key);
      } else if (action === "retrigger") {
        retriggerContext(key);
      } else if (ctx && action === "exclude") {
        store.excludeBatch(ctx.key, batchId);
      } else if (ctx && action === "restore") {
        store.restoreBatch(ctx.key, batchId);
      } else if (ctx && action === "choose") {
        store.chooseVariant(ctx.key, button.dataset.location, batchId);
      }
    });
    store.subscribe(render);
    startSearch();
  });
})(window);
