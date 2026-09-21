(() => {
  "use strict";

  const { createCoordinator } = window.SearchCore;
  const { createMockSource } = window.MockSearch;
  let emitConflictNext = false;

  const source = createMockSource({
    delay: 260,
    variance: 620,
    shouldEmitConflict: () => {
      const shouldEmit = emitConflictNext;
      emitConflictNext = false;
      window.queueMicrotask(() => {
        document.getElementById("conflictToggle").checked = false;
      });
      return shouldEmit;
    }
  });
  const coordinator = createCoordinator({ source });

  const $ = (id) => document.getElementById(id);
  const elements = {
    form: $("searchForm"),
    query: $("queryInput"),
    type: $("typeSelect"),
    page: $("pageInput"),
    conflictToggle: $("conflictToggle"),
    retrigger: $("retriggerBtn"),
    contextCount: $("contextCount"),
    contextList: $("contextList"),
    notices: $("notices"),
    title: $("currentTitle"),
    meta: $("currentMeta"),
    progress: $("progress"),
    results: $("results"),
    inspector: $("batchInspector")
  };

  function text(value) {
    return document.createTextNode(String(value ?? ""));
  }

  function el(tagName, className, content) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (content !== undefined) {
      const children = (Array.isArray(content) ? content : [content]).filter((item) => item !== null);
      node.append(...children);
    }
    return node;
  }

  function contextLabel(params) {
    const type = { all: "全部", doc: "文档", media: "媒体", dataset: "数据集" }[params.type] || params.type;
    const query = params.query || "空关键词";
    return `${query} · ${type} · 第 ${params.page} 页`;
  }

  function statusLabel(status) {
    return { idle: "待加载", loading: "加载中", complete: "已完成", error: "失败" }[status] || status;
  }

  function submitCurrentForm() {
    coordinator.submit({
      query: elements.query.value,
      type: elements.type.value,
      page: elements.page.value
    });
  }

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    emitConflictNext = elements.conflictToggle.checked;
    submitCurrentForm();
  });

  elements.conflictToggle.addEventListener("change", () => {
    emitConflictNext = elements.conflictToggle.checked;
  });

  elements.retrigger.addEventListener("click", () => {
    const snapshot = coordinator.getSnapshot();
    if (snapshot.activeContextKey) {
      emitConflictNext = elements.conflictToggle.checked;
      coordinator.retrigger(snapshot.activeContextKey);
    }
  });

  function renderContexts(snapshot) {
    elements.contextCount.textContent = snapshot.contexts.length;
    elements.contextList.replaceChildren();
    snapshot.contexts.forEach((context) => {
      const conflicts = context.positions.filter((item) => item.status === "conflict").length;
      const badges = [
        el("span", `badge ${context.status}`, statusLabel(context.status)),
        el("span", "badge", `已到 ${context.arrivedBatches}${context.totalBatches === null ? "" : `/${context.totalBatches}`}`),
        el("span", "badge", `过期到达 ${context.staleArrivals}`)
      ];
      if (conflicts > 0) badges.push(el("span", "badge conflict", `矛盾 ${conflicts}`));
      const arrived = context.arrivedBatches;
      const total = context.totalBatches ?? 0;
      const percent = total > 0 ? Math.min(100, Math.round((arrived / total) * 100))
        : context.status === "complete" ? 100 : 0;
      const progress = el("div", "mini-progress", el("span"));
      progress.firstElementChild.style.width = `${percent}%`;
      const card = el("button", `context-card ${context.isActive ? "active" : ""}`, [
        el("strong", null, contextLabel(context.params)),
        el("small", null, `批次：${Array.from(context.batches.keys()).join("、") || "尚无"}`),
        el("div", "badge-row", badges),
        progress
      ]);
      card.addEventListener("click", () => coordinator.switchContext(context.key));
      elements.contextList.append(card);
    });
  }

  function renderNotices(snapshot) {
    elements.notices.replaceChildren();
    snapshot.notices.forEach((notice) => {
      const context = snapshot.contexts.find((item) => item.key === notice.contextKey);
      const label = context ? contextLabel(context.params) : notice.contextKey;
      const resumeButton = el("button", "secondary", "回到该上下文继续等待");
      resumeButton.addEventListener("click", () => coordinator.switchContext(notice.contextKey));
      const retryButton = el("button", null, "重新触发");
      retryButton.addEventListener("click", () => coordinator.retrigger(notice.contextKey));
      const dismissButton = el("button", "secondary", "知道了");
      dismissButton.addEventListener("click", () => coordinator.dismissNotice(notice.id));
      const node = el("div", "notice", [
        el("div", null, [
          el("strong", null, "有批次在上下文过期后到达："),
          text(`批次 ${notice.batchId} 已安全保留在「${label}」，没有覆盖当前视图。`)
        ]),
        el("div", "notice-actions", [resumeButton, retryButton, dismissButton])
      ]);
      elements.notices.append(node);
    });
  }

  function renderProgress(context) {
    if (!context) {
      elements.progress.replaceChildren();
      return;
    }
    const total = context.totalBatches ?? 0;
    const arrived = context.arrivedBatches;
    const percent = total > 0 ? Math.round((arrived / total) * 100)
      : context.status === "complete" ? 100 : 0;
    const dots = [];
    const totalForDots = total || Math.max(arrived, 1);
    for (let index = 1; index <= totalForDots; index += 1) {
      dots.push(el("span", `dot ${index <= arrived ? "arrived" : ""}`));
    }
    const box = el("div", "progress-box", [
      el("div", "progress-line", [
        el("span", null, `状态：${statusLabel(context.status)} · 已到达 ${arrived} 个批次`),
        el("span", null, total ? `预计 ${total} 个 · ${percent}%` : "等待源返回批次计划"),
      ]),
      el("div", "progress-track", el("div", "progress-fill")),
      el("div", "batch-dots", dots)
    ]);
    box.querySelector(".progress-fill").style.width = `${percent}%`;
    if (context.lastError) {
      box.append(el("p", null, `错误：${context.lastError}`));
    }
    elements.progress.replaceChildren(box);
  }

  function renderClaim(context, entry, claim) {
    const item = claim.item;
    const decision = context.choices.get(entry.position);
    const isChosen = decision?.claimKey === claim.claimKey;
    const meta = `内容指纹 ${claim.claimKey} · 来源批次 ${claim.batchIds.join("、")}`;
    const actions = [];
    if (entry.visibleClaims.length > 1) {
      if (isChosen) {
        const clear = el("button", "secondary", "撤销裁决");
        clear.addEventListener("click", () => coordinator.clearResolution(context.key, entry.position));
        actions.push(clear);
      } else {
        const choose = el("button", null, "裁决采用此内容");
        choose.addEventListener("click", () => coordinator.resolveConflict(context.key, entry.position, claim.claimKey));
        actions.push(choose);
      }
    }
    claim.batchIds.forEach((batchId) => {
      const excluded = context.excludedBatchIds.has(batchId);
      const button = el("button", excluded ? "secondary" : "danger", excluded ? `恢复批次 ${batchId}` : `排除批次 ${batchId}`);
      button.addEventListener("click", () => {
        if (excluded) coordinator.restoreBatch(context.key, batchId);
        else coordinator.excludeBatch(context.key, batchId);
      });
      actions.push(button);
    });
    return el("div", `claim ${isChosen ? "chosen" : ""}`, [
      el("div", "claim-meta", meta),
      el("h4", null, item.title),
      el("p", null, item.summary),
      el("div", "claim-actions", actions)
    ]);
  }

  function renderResults(context) {
    if (!context || context.positions.length === 0) {
      const message = !context
        ? "提交一个检索开始。"
        : context.status === "loading"
          ? "批次尚未到达，已到达后会实时补充；切换到旧上下文不会被新批次覆盖。"
          : "当前筛选没有结果。";
      elements.results.replaceChildren(el("div", "empty", message));
      return;
    }
    const cards = context.positions.map((entry) => {
      const titlePrefix = {
        conflict: "待裁决矛盾",
        resolved: "已裁决",
        excluded: "相关批次均已排除",
        unique: "结果"
      }[entry.status];
      const header = el("div", null, [
        el("div", "position", `位置 ${entry.position}`),
        el("h3", null, [
          text(titlePrefix),
          entry.status === "conflict"
            ? el("span", "conflict-flag", entry.hasNewerClaim ? "裁决后出现新内容" : `${entry.visibleClaims.length} 种内容`)
            : null
        ])
      ]);
      const displayClaims = entry.chosen ? [entry.chosen, ...entry.visibleClaims.filter((claim) => claim !== entry.chosen)] : entry.visibleClaims;
      const hiddenClaims = entry.claims.filter((claim) => !entry.visibleClaims.includes(claim));
      const hiddenNote = hiddenClaims.length
        ? el("p", null, `另有 ${hiddenClaims.length} 种内容的来源批次已被排除，可在批次检查区恢复。`)
        : null;
      return el("article", `result-card ${entry.status}`, [
        header,
        ...displayClaims.map((claim) => renderClaim(context, entry, claim)),
        hiddenNote
      ]);
    });
    elements.results.replaceChildren(...cards);
  }

  function renderInspector(context) {
    if (!context) {
      elements.inspector.replaceChildren();
      return;
    }
    const rows = Array.from(context.batches.values()).map((batch) => {
      const excluded = context.excludedBatchIds.has(batch.batchId);
      const stale = context.staleBatchIds.has(batch.batchId);
      const button = el("button", excluded ? "secondary" : "danger", excluded ? "恢复" : "排除");
      button.addEventListener("click", () => {
        if (excluded) coordinator.restoreBatch(context.key, batch.batchId);
        else coordinator.excludeBatch(context.key, batch.batchId);
      });
      return el("div", `batch-row ${excluded ? "excluded" : ""}`, [
        el("div", null, [
          el("strong", null, `批次 ${batch.batchId}`),
          el("small", null, ` · ${batch.items.length} 条${stale ? " · 到达时当前视图已切换" : ""}${excluded ? " · 已排除" : ""}`)
        ]),
        button
      ]);
    });
    elements.inspector.replaceChildren(
      el("h3", null, "批次检查区"),
      el("p", null, "排除只影响此上下文的展示结论，不会删除批次，也不会影响其他上下文。"),
      ...(rows.length ? rows : [el("div", "empty", "尚无批次到达。")])
    );
  }

  function render(snapshot) {
    renderContexts(snapshot);
    renderNotices(snapshot);
    const context = snapshot.activeContext;
    elements.retrigger.hidden = !context;
    if (context) {
      elements.title.textContent = contextLabel(context.params);
      elements.meta.textContent = `该上下文保留 ${context.arrivedBatches} 个已到批次、${context.staleArrivals} 个过期时到达批次；裁决和排除均仅属于本上下文。`;
    } else {
      elements.title.textContent = "尚未提交检索";
      elements.meta.textContent = "提交后可在批次返回途中继续改关键词、筛选或翻页。";
    }
    renderProgress(context);
    renderResults(context);
    renderInspector(context);
  }

  coordinator.subscribe(render);
  render(coordinator.getSnapshot());
})();
