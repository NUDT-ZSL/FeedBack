(() => {
  "use strict";

  const DEFAULTS = { query: "", type: "all", page: 1 };

  function normalizeContext(input = {}) {
    const page = Number.parseInt(input.page, 10);
    return {
      query: String(input.query ?? "").trim(),
      type: String(input.type ?? DEFAULTS.type),
      page: Number.isFinite(page) && page > 0 ? page : 1
    };
  }

  function contextKey(context) {
    return JSON.stringify(normalizeContext(context));
  }

  function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  function stableHash(value) {
    const text = typeof value === "string" ? value : stableStringify(value);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function claimFingerprint(item) {
    if (item.contentKey) return String(item.contentKey);
    const { position, id, ...content } = item;
    return stableHash(stableStringify(content));
  }

  function createCoordinator({ source, now = () => Date.now() } = {}) {
    if (!source || typeof source.start !== "function") {
      throw new TypeError("createCoordinator requires a source with start()");
    }

    const state = { activeContextKey: null, contexts: new Map(), notices: [], sequence: 0 };
    const listeners = new Set();

    function emit() {
      const snapshot = getSnapshot();
      for (const listener of listeners) listener(snapshot);
    }

    function subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    function ensureContext(input) {
      const params = normalizeContext(input);
      const key = contextKey(params);
      if (!state.contexts.has(key)) {
        state.contexts.set(key, {
          key,
          params,
          createdAt: now(),
          status: "idle",
          runId: 0,
          activeRuns: new Set(),
          totalBatches: null,
          batches: new Map(),
          staleBatchIds: new Set(),
          excludedBatchIds: new Set(),
          choices: new Map(),
          staleArrivals: 0,
          lastError: null
        });
      }
      return state.contexts.get(key);
    }

    function startRun(context) {
      context.runId += 1;
      context.status = "loading";
      context.lastError = null;
      const runId = context.runId;
      context.activeRuns.add(runId);

      source.start({
        context: { ...context.params },
        key: context.key,
        runId,
        onStart: (totalBatches) => {
          const count = Number(totalBatches);
          context.totalBatches = Math.max(context.totalBatches ?? 0, count);
          emit();
        },
        onBatch: (batch) => receiveBatch(context, batch),
        onError: (message) => {
          if (!context.activeRuns.delete(runId)) return;
          context.status = "error";
          context.lastError = String(message || "检索失败");
          emit();
        },
        onComplete: () => {
          if (!context.activeRuns.delete(runId)) return;
          if (context.activeRuns.size === 0) context.status = "complete";
          emit();
        }
      });
    }

    function submit(input) {
      const context = ensureContext(input);
      state.activeContextKey = context.key;
      startRun(context);
      emit();
      return context.key;
    }

    function retrigger(key) {
      const context = state.contexts.get(key);
      if (!context) throw new Error(`Unknown context: ${key}`);
      state.activeContextKey = key;
      startRun(context);
      emit();
    }

    function switchContext(key) {
      if (!state.contexts.has(key)) throw new Error(`Unknown context: ${key}`);
      state.activeContextKey = key;
      state.notices = state.notices.filter((notice) => notice.contextKey !== key);
      emit();
    }

    function receiveBatch(context, incoming) {
      const batchId = String(incoming.batchId);
      if (context.batches.has(batchId)) return;
      const items = Array.isArray(incoming.items) ? incoming.items : [];
      const batch = { batchId, items, arrivedAt: now(), sequence: ++state.sequence };
      context.batches.set(batchId, batch);

      if (state.activeContextKey !== context.key) {
        context.staleArrivals += 1;
        context.staleBatchIds.add(batchId);
        state.notices.push({
          id: `${context.key}:${batchId}:${batch.arrivedAt}`,
          contextKey: context.key,
          batchId,
          at: batch.arrivedAt
        });
      }
      emit();
    }

    function withContext(key, fn) {
      const context = state.contexts.get(key);
      if (!context) throw new Error(`Unknown context: ${key}`);
      fn(context);
      emit();
    }

    function dismissNotice(id) {
      state.notices = state.notices.filter((notice) => notice.id !== id);
      emit();
    }

    function excludeBatch(key, batchId) {
      withContext(key, (context) => context.excludedBatchIds.add(String(batchId)));
    }

    function restoreBatch(key, batchId) {
      withContext(key, (context) => context.excludedBatchIds.delete(String(batchId)));
    }

    function resolveConflict(key, position, claimKey) {
      withContext(key, (context) => context.choices.set(Number(position), {
        claimKey: String(claimKey),
        at: now(),
        sequence: state.sequence
      }));
    }

    function clearResolution(key, position) {
      withContext(key, (context) => context.choices.delete(Number(position)));
    }

    function aggregate(context) {
      const positions = new Map();
      for (const batch of context.batches.values()) {
        const excluded = context.excludedBatchIds.has(batch.batchId);
        for (const item of batch.items) {
          const position = Number(item.position);
          if (!positions.has(position)) positions.set(position, new Map());
          const claimKey = claimFingerprint(item);
          const claimants = positions.get(position);
          if (!claimants.has(claimKey)) {
            claimants.set(claimKey, {
              claimKey,
              item,
              batchIds: [],
              excludedBatchIds: [],
              firstArrivedAt: batch.arrivedAt,
              firstArrivedSeq: batch.sequence
            });
          }
          const claim = claimants.get(claimKey);
          if (!claim.batchIds.includes(batch.batchId)) {
            claim.batchIds.push(batch.batchId);
            if (excluded) claim.excludedBatchIds.push(batch.batchId);
          }
        }
      }

      return Array.from(positions.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([position, claimantsById]) => {
          const allClaims = Array.from(claimantsById.values())
            .sort((a, b) => a.firstArrivedAt - b.firstArrivedAt
              || a.claimKey.localeCompare(b.claimKey));
          const visibleClaims = allClaims.filter(
            (claim) => claim.batchIds.length > claim.excludedBatchIds.length
          );
          const decision = context.choices.get(position);
          const chosen = visibleClaims.find((claim) => claim.claimKey === decision?.claimKey) || null;
          const hasNewerClaim = Boolean(decision)
            && visibleClaims.some((claim) => claim.firstArrivedSeq > decision.sequence);
          const status = visibleClaims.length === 0
            ? "excluded"
            : visibleClaims.length > 1
              ? chosen && !hasNewerClaim ? "resolved" : "conflict"
              : "unique";
          return { position, status, hasNewerClaim, claims: allClaims, visibleClaims, chosen };
        });
    }

    function getContextView(key) {
      const context = state.contexts.get(key);
      if (!context) return null;
      return {
        ...context,
        isActive: state.activeContextKey === key,
        arrivedBatches: context.batches.size,
        positions: aggregate(context)
      };
    }

    function getSnapshot() {
      return {
        activeContextKey: state.activeContextKey,
        activeContext: state.activeContextKey ? getContextView(state.activeContextKey) : null,
        contexts: Array.from(state.contexts.keys()).map(getContextView),
        notices: state.notices.slice()
      };
    }

    return {
      subscribe,
      submit,
      retrigger,
      switchContext,
      dismissNotice,
      excludeBatch,
      restoreBatch,
      resolveConflict,
      clearResolution,
      getSnapshot
    };
  }

  const api = { normalizeContext, contextKey, stableHash, createCoordinator };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.SearchCore = api;
})();
