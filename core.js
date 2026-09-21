(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SearchStore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function nowText() {
    return new Date().toLocaleTimeString([], { hour12: false });
  }

  function stableHash(value) {
    var text = JSON.stringify(value, function (key, val) {
      if (key === "batchId" || key === "receivedAt") return undefined;
      return val;
    });
    var hash = 5381;
    for (var i = 0; i < text.length; i += 1) {
      hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    }
    return "h" + (hash >>> 0).toString(36);
  }

  function SearchStore() {
    this.contexts = new Map();
    this.listeners = new Set();
    this.activeKey = null;
    this.staleEvents = [];
    this.runSeq = 0;
  }

  SearchStore.prototype.subscribe = function (listener) {
    this.listeners.add(listener);
    return function () { this.listeners.delete(listener); }.bind(this);
  };

  SearchStore.prototype.emit = function () {
    this.listeners.forEach(function (listener) { listener(); });
  };

  SearchStore.normalizeInput = function (input) {
    var query = (input.query || "").trim().replace(/\s+/g, " ");
    return {
      query: query,
      filter: input.filter || "all",
      page: Math.max(1, parseInt(input.page, 10) || 1)
    };
  };

  SearchStore.keyOf = function (input) {
    var ctx = SearchStore.normalizeInput(input);
    return ctx.page + "|" + ctx.filter + "|" + ctx.query.toLowerCase();
  };

  SearchStore.prototype.describe = function (ctx) {
    var keyword = ctx.query || "（空关键词）";
    var filterName = { all: "全部", doc: "文档", image: "图片", log: "日志" }[ctx.filter] || ctx.filter;
    return keyword + " · " + filterName + " · 第" + ctx.page + "页";
  };

  SearchStore.prototype.recordStale = function (event) {
    this.staleEvents.unshift(Object.assign({
      id: "stale-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      at: nowText()
    }, event));
    if (this.staleEvents.length > 60) this.staleEvents.length = 60;
  };

  SearchStore.prototype.startContext = function (rawInput, options) {
    options = options || {};
    var input = SearchStore.normalizeInput(rawInput);
    var key = SearchStore.keyOf(input);
    var existing = this.contexts.get(key);
    if (existing && !options.force) {
      this.setActive(key);
      return { key: key, runId: existing.runId, reused: true };
    }
    if (options.force && existing) {
      this.recordStale({
        contextKey: key,
        runId: existing.runId,
        batchId: "*",
        reason: "superseded",
        title: existing.title,
        message: "旧检索运行已被手动重新触发取代。"
      });
    }
    this.runSeq += 1;
    var runId = "run-" + this.runSeq + "-" + Date.now().toString(36);
    this.contexts.set(key, {
      key: key,
      query: input.query,
      filter: input.filter,
      page: input.page,
      title: this.describe(input),
      status: "loading",
      runId: runId,
      startedAt: nowText(),
      totalBatches: null,
      arrived: [],
      batchIndex: new Map(),
      staleBatchCount: 0,
      decisions: {
        excludedBatchIds: new Set(),
        selectedByLocation: new Map(),
        updatedAt: null
      },
      error: null
    });
    this.activeKey = key;
    this.emit();
    return { key: key, runId: runId, reused: false };
  };

  SearchStore.prototype.setActive = function (key) {
    if (!this.contexts.has(key)) return false;
    if (this.activeKey !== key) {
      this.activeKey = key;
      this.emit();
    }
    return true;
  };

  SearchStore.prototype.getActive = function () {
    return this.contexts.get(this.activeKey) || null;
  };

  SearchStore.prototype.ingestBatch = function (envelope) {
    var ctx = this.contexts.get(envelope.contextKey);
    if (!ctx) return { accepted: false, state: "unknown-context" };
    if (ctx.runId !== envelope.runId) {
      this.recordStale({
        contextKey: ctx.key,
        runId: envelope.runId,
        batchId: envelope.batch && envelope.batch.id,
        reason: "superseded",
        title: ctx.title,
        message: "过期运行的批次未写入重新触发后的上下文。"
      });
      this.emit();
      return { accepted: false, state: "superseded-run" };
    }
    var batch = envelope.batch;
    if (!batch || !batch.id || ctx.batchIndex.has(batch.id)) {
      return { accepted: false, state: "duplicate" };
    }
    var stored = Object.assign({}, batch, {
      contextKey: ctx.key,
      runId: envelope.runId,
      receivedAt: nowText(),
      deliveredWhileInactive: this.activeKey !== ctx.key
    });
    if (stored.deliveredWhileInactive) {
      ctx.staleBatchCount += 1;
      this.recordStale({
        contextKey: ctx.key,
        runId: envelope.runId,
        batchId: stored.id,
        reason: "context-switched",
        title: ctx.title,
        message: "批次属于“" + ctx.title + "”，已缓存但未渲染到当前视图。"
      });
    }
    ctx.arrived.push(stored);
    ctx.batchIndex.set(stored.id, stored);
    if (Number.isFinite(envelope.totalBatches)) {
      ctx.totalBatches = Math.max(ctx.totalBatches || 0, envelope.totalBatches);
    }
    if (ctx.totalBatches && ctx.arrived.length >= ctx.totalBatches) {
      ctx.status = "complete";
    }
    this.emit();
    return {
      accepted: true,
      state: stored.deliveredWhileInactive ? "cached-for-other-context" : "rendered",
      context: ctx
    };
  };

  SearchStore.prototype.deriveView = function (key) {
    var ctx = this.contexts.get(key);
    if (!ctx) return null;
    var groups = new Map();
    var order = [];
    ctx.arrived.forEach(function (batch) {
      var excluded = ctx.decisions.excludedBatchIds.has(batch.id);
      batch.items.forEach(function (item) {
        var locationId = item.locationId || item.id;
        if (!groups.has(locationId)) {
          groups.set(locationId, { locationId: locationId, variants: [] });
          order.push(locationId);
        }
        groups.get(locationId).variants.push({
          batchId: batch.id,
          excludedBatch: excluded,
          contentHash: stableHash(item.content),
          item: item
        });
      });
    });
    var rows = [];
    var conflicts = [];
    order.forEach(function (locationId) {
      var group = groups.get(locationId);
      var visible = group.variants.filter(function (v) { return !v.excludedBatch; });
      var hashes = new Set(visible.map(function (v) { return v.contentHash; }));
      var conflict = visible.length > 1 && hashes.size > 1;
      var chosenBatchId = ctx.decisions.selectedByLocation.get(locationId);
      var chosen = visible.find(function (v) { return v.batchId === chosenBatchId; }) || null;
      if (conflict) {
        conflicts.push(locationId);
        rows.push({ locationId: locationId, conflict: true, resolved: Boolean(chosen), selected: chosen, variants: visible });
      } else if (visible.length) {
        rows.push({ locationId: locationId, conflict: false, resolved: false, selected: visible[0], variants: visible });
      }
    });
    var planned = ctx.totalBatches || ctx.arrived.length || 1;
    return {
      context: ctx,
      rows: rows,
      conflicts: conflicts,
      progress: Math.min(1, ctx.arrived.length / Math.max(1, planned)),
      excludedCount: ctx.decisions.excludedBatchIds.size
    };
  };

  SearchStore.prototype.ensureContext = function (key) {
    var ctx = this.contexts.get(key);
    if (!ctx) throw new Error("Unknown context: " + key);
    return ctx;
  };

  SearchStore.prototype.excludeBatch = function (key, batchId) {
    var ctx = this.ensureContext(key);
    ctx.decisions.excludedBatchIds.add(batchId);
    ctx.decisions.updatedAt = nowText();
    this.emit();
  };

  SearchStore.prototype.restoreBatch = function (key, batchId) {
    var ctx = this.ensureContext(key);
    ctx.decisions.excludedBatchIds.delete(batchId);
    ctx.decisions.updatedAt = nowText();
    this.emit();
  };

  SearchStore.prototype.chooseVariant = function (key, locationId, batchId) {
    var ctx = this.ensureContext(key);
    ctx.decisions.selectedByLocation.set(locationId, batchId);
    ctx.decisions.updatedAt = nowText();
    this.emit();
  };

  SearchStore.prototype.clearChoice = function (key, locationId) {
    var ctx = this.ensureContext(key);
    ctx.decisions.selectedByLocation.delete(locationId);
    ctx.decisions.updatedAt = nowText();
    this.emit();
  };

  SearchStore.stableHash = stableHash;
  return SearchStore;
});
