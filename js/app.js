(function () {
  "use strict";

  const { utils, WhiteboardStore, MockLocalServer } = window.WB;
  const canvas = document.getElementById("canvas");
  const deleteSelectedButton = document.getElementById("deleteSelected");
  const operationLog = document.getElementById("operationLog");
  const rollbackList = document.getElementById("rollbackList");
  const toastElement = document.getElementById("toast");

  const initialElements = {
    note_welcome: {
      id: "note_welcome", type: "note", label: "拖动我",
      x: 58, y: 54, width: 168, height: 112, color: "#fde68a"
    },
    shape_start: {
      id: "shape_start", type: "circle", label: "图形",
      x: 292, y: 78, width: 132, height: 132, color: "#bae6fd"
    }
  };

  const store = new WhiteboardStore({ initialElements });
  const server = new MockLocalServer(initialElements, {
    maxLatency: Number(document.getElementById("latency").value),
    onModeChange: renderServerMode
  });

  let selectedId = "note_welcome";
  let chosenColor = "#bbf7d0";
  let pendingPointer = null;
  let toastTimer = null;
  store.subscribe(render);

  function sendOp(op) {
    store.sendOperation(op.id);
    const revision = server.submit(op, function (outcome) {
      try {
        store.receiveOutcome(outcome);
        if (store.getInflightCount() === 0) {
          const check = store.assertConvergedWithReplay();
          showToast("已按确认顺序收敛，修订 #" + check.revision);
        }
      } catch (error) {
        showToast(error.message);
      }
    });
    store.sendOperation(op.id, revision);
  }

  function addElement(type) {
    const active = store.getActiveElements();
    const count = Object.keys(active).length;
    const id = utils.makeId(type === "note" ? "note" : "shape");
    const addCount = store.getOps().filter((op) => op.type === "add" && !op.retried).length;
    const label = type === "note" ? "便签 " + (addCount + 1)
      : type === "rect" ? "方形" : "圆形";
    const element = {
      id, type, label,
      x: 70 + (count * 34) % 360,
      y: 72 + (count * 47) % 250,
      width: type === "note" ? 164 : 128,
      height: type === "note" ? 112 : 128,
      color: chosenColor
    };
    selectedId = id;
    sendOp(store.addElement(element));
  }

  function updateColor(elementId, color) {
    const current = store.getActiveElement(elementId);
    if (!current || current.color === color) return;
    sendOp(store.updateElement(elementId, { color }));
  }

  function deleteElement(elementId) {
    if (!store.getActiveElement(elementId)) return;
    sendOp(store.deleteElement(elementId));
    if (selectedId === elementId) selectedId = "";
  }

  function canvasPoint(event) {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  canvas.addEventListener("pointerdown", function (event) {
    const target = event.target.closest(".board-element");
    if (!target) {
      selectedId = "";
      render();
      return;
    }
    const element = store.getActiveElement(target.dataset.id);
    if (!element) return;
    selectedId = element.id;
    canvas.setPointerCapture(event.pointerId);
    const point = canvasPoint(event);
    pendingPointer = {
      elementId: element.id,
      pointerId: event.pointerId,
      segmentX: point.x,
      segmentY: point.y,
      op: null,
      moved: false
    };
    render();
  });

  canvas.addEventListener("pointermove", function (event) {
    if (!pendingPointer || event.pointerId !== pendingPointer.pointerId) return;
    const current = store.getActiveElement(pendingPointer.elementId);
    if (!current) {
      pendingPointer = null;
      render();
      return;
    }
    const point = canvasPoint(event);
    const nextX = utils.clamp(
      Math.round(current.x + point.x - pendingPointer.segmentX),
      0, Math.max(0, canvas.clientWidth - current.width)
    );
    const nextY = utils.clamp(
      Math.round(current.y + point.y - pendingPointer.segmentY),
      0, Math.max(0, canvas.clientHeight - current.height)
    );

    if (!pendingPointer.moved &&
        (Math.abs(nextX - current.x) > 2 || Math.abs(nextY - current.y) > 2)) {
      pendingPointer.moved = true;
      pendingPointer.op = store.beginMoveDraft(pendingPointer.elementId);
    }
    if (!pendingPointer.moved) return;

    let op = store.getOp(pendingPointer.op.id);
    if (!op || op.status !== "pending" || op.phase !== "draft") {
      if (!store.getActiveElement(pendingPointer.elementId)) {
        pendingPointer = null;
        render();
        return;
      }
      pendingPointer.segmentX = point.x;
      pendingPointer.segmentY = point.y;
      pendingPointer.op = store.beginMoveDraft(pendingPointer.elementId);
      op = pendingPointer.op;
    }
    store.updateMoveDraft(op.id, nextX, nextY);
    render();
  });

  function finishPointer(event, canceled) {
    if (!pendingPointer || event.pointerId !== pendingPointer.pointerId) return;
    const draft = pendingPointer;
    pendingPointer = null;
    if (!draft.moved) {
      render();
      return;
    }
    const op = store.getOp(draft.op.id);
    if (canceled) store.cancelMoveDraft(op.id);
    else if (op && op.phase === "draft") sendOp(op);
    render();
  }

  canvas.addEventListener("pointerup", (event) => finishPointer(event, false));
  canvas.addEventListener("pointercancel", (event) => finishPointer(event, true));

  function describePatch(patch) {
    const parts = [];
    if (patch.x !== undefined || patch.y !== undefined) parts.push("拖动");
    if (patch.color) parts.push("改色");
    return parts.join("+") || "更新";
  }

  function actionLabel(op) {
    const shortId = op.elementId.split("_").slice(-1)[0];
    const name = op.type === "add" ? "添加"
      : op.type === "delete" ? "删除"
      : describePatch(op.input.patch);
    return name + " · " + shortId;
  }

  function renderGhost(elementId, element, kind, reason) {
    const node = document.createElement("div");
    node.className = "ghost " + element.type + " " + kind;
    node.style.left = element.x + "px";
    node.style.top = element.y + "px";
    node.style.width = element.width + "px";
    node.style.height = element.height + "px";
    node.style.background = element.color;
    const label = document.createElement("span");
    label.className = "ghost-label";
    label.textContent = kind === "diverged" ? "本地预期已回退" : "已回退";
    label.title = elementId + " · " + reason;
    node.appendChild(label);
    canvas.appendChild(node);
  }

  function renderGhosts(elements) {
    store.getRollbackGroups()
      .filter((group) => !group.retried)
      .forEach(function (group) {
        Object.entries(group.previewByElement).forEach(function ([elementId, preview]) {
          if (preview.attempted) {
            renderGhost(elementId, preview.attempted, preview.kind, group.reason);
          } else if (preview.before && !elements[elementId]) {
            renderGhost(elementId, preview.before, "deleted-ghost", group.reason);
          }
        });
      });
  }

  function renderCanvas() {
    const elements = store.getActiveElements();
    canvas.innerHTML = "";
    renderGhosts(elements);

    Object.values(elements).forEach(function (element) {
      const node = document.createElement("div");
      node.className = "board-element " + element.type;
      node.dataset.id = element.id;
      node.dataset.status = store.getElementStatus(element.id);
      node.style.left = element.x + "px";
      node.style.top = element.y + "px";
      node.style.width = element.width + "px";
      node.style.height = element.height + "px";
      node.style.background = element.type === "note"
        ? element.color : "rgba(255,255,255,.62)";
      node.style.borderColor = element.type === "note"
        ? "rgba(15,23,42,.18)" : element.color;
      if (element.id === selectedId) node.classList.add("selected");
      if (pendingPointer && pendingPointer.elementId === element.id) node.classList.add("dragging");

      const label = document.createElement("span");
      label.className = "element-label";
      label.textContent = element.label;
      const idLabel = document.createElement("span");
      idLabel.className = "element-id";
      idLabel.textContent = element.id.split("_").slice(-1)[0];
      node.append(label, idLabel);
      canvas.appendChild(node);
    });

    if (!Object.keys(elements).length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      Object.assign(empty.style, {
        position: "absolute", left: "50%", top: "50%",
        transform: "translate(-50%, -50%)"
      });
      empty.textContent = "画布为空，点击左上角添加便签或图形";
      canvas.appendChild(empty);
    }
  }

  function renderRollbackPanel() {
    const groups = store.getRollbackGroups();
    document.getElementById("rollbackCount").textContent =
      groups.filter((group) => !group.retried).length;
    rollbackList.innerHTML = "";
    if (!groups.length) {
      rollbackList.innerHTML = '<div class="empty-state">暂无回退。可让下一次操作被拒绝或返回不同结果。</div>';
      return;
    }

    groups.forEach(function (group) {
      const root = store.getOp(group.rootOpId);
      const node = document.createElement("article");
      node.className = "rollback-group " + (group.retried ? "retried" : "reverted");
      const opsText = group.opIds
        .map((id) => "#" + store.getOp(id).clientSeq).join("、");
      node.innerHTML =
        '<div class="rollback-head"><span class="rollback-title"></span></div>' +
        '<div class="rollback-reason reason"></div>' +
        '<div class="rollback-reason">回退操作：<strong></strong></div>' +
        '<div class="kept-note"></div><div class="rollback-actions"></div>';
      node.querySelector(".rollback-title").textContent =
        (group.kind === "diverged" ? "结果分歧：" : "已回退：") +
        actionLabel(root) + (group.retried ? " · 已重发" : "");
      node.querySelector(".reason").textContent = group.reason;
      node.querySelector("strong").textContent = opsText;
      node.querySelector(".kept-note").textContent =
        "未直接依赖这些操作的改动已保留，画布当前可继续编辑。";

      const actions = node.querySelector(".rollback-actions");
      if (group.retried) {
        const note = document.createElement("span");
        note.className = "muted";
        note.textContent = "已重发为 " + (group.retriedOpIds || [])
          .map((id) => "#" + store.getOp(id).clientSeq).join("、");
        actions.appendChild(note);
      } else {
        const retry = document.createElement("button");
        retry.className = "mini-btn";
        retry.textContent = group.hasPendingOutcome ? "等待迟到返回…" : "重发这组改动";
        retry.disabled = group.hasPendingOutcome;
        retry.addEventListener("click", function () {
          try {
            const result = store.retryGroup(group.id);
            result.operations.forEach(sendOp);
            showToast("已重新发起 " + result.operations.length + " 个操作");
          } catch (error) {
            showToast(error.message);
          }
        });
        actions.appendChild(retry);
      }
      rollbackList.appendChild(node);
    });
  }

  function renderLog() {
    const stats = store.getStats();
    const ops = store.getOps().slice().reverse();
    document.getElementById("logCounts").textContent =
      stats.pending + " 待 / " + stats.confirmed + " 确认 / " + stats.rolledBack + " 回退";
    operationLog.innerHTML = "";
    if (!ops.length) {
      operationLog.innerHTML = '<div class="empty-state">操作发生后会记录顺序、依赖和状态。</div>';
      return;
    }

    ops.forEach(function (op) {
      const row = document.createElement("article");
      row.className = "op-row " + op.status + (op.retried ? " retried" : "");
      const statusText = { pending: "待确认", confirmed: "已确认", "rolled-back": "已回退" }[op.status];
      const phaseText = op.status === "pending"
        ? (op.phase === "draft" ? "（本地拖动中）" : "（等待服务）")
        : op.phase === "settled" ? "（修订 #" + op.revision + "）" : "（本地分支已取消）";
      const depText = op.dependencies.length
        ? op.dependencies.map((id) => "#" + store.getOp(id).clientSeq).join("、")
        : "无";
      const reason = op.rollbackReason || (op.divergence && op.divergence.reason) ||
        (op.outcome && op.outcome.reason) || "";
      row.innerHTML =
        '<div class="op-head"><span class="op-title"></span><span class="badge"></span></div>' +
        '<div class="op-meta">依赖：<span class="deps"></span> <strong></strong></div>' +
        (reason ? '<div class="op-meta op-reason"></div>' : "");
      row.querySelector(".op-title").textContent = "#" + op.clientSeq + " " + actionLabel(op);
      const badge = row.querySelector(".badge");
      badge.className = "badge " + op.status;
      badge.textContent = statusText;
      row.querySelector(".deps").textContent = depText;
      row.querySelector("strong").textContent = phaseText;
      if (reason) row.querySelector(".op-reason").textContent = reason;
      operationLog.appendChild(row);
    });
  }

  function renderSync() {
    const stats = store.getStats();
    const dot = document.getElementById("syncDot");
    const state = document.getElementById("syncState");
    const meta = document.getElementById("syncMeta");
    dot.classList.remove("synced", "rolled-back");
    meta.textContent = "权威修订 #" + stats.revision;
    if (stats.pending > 0) {
      state.textContent = "同步中";
      meta.textContent += " · " + stats.pending + " 个待确认";
    } else if (stats.rolledBack > 0) {
      state.textContent = "可编辑，存在回退";
      dot.classList.add("rolled-back");
      meta.textContent += " · " + stats.rolledBack + " 个已回退";
    } else {
      state.textContent = "已同步";
      dot.classList.add("synced");
    }
  }

  function render() {
    renderCanvas();
    renderRollbackPanel();
    renderLog();
    renderSync();
    deleteSelectedButton.disabled = !selectedId || !store.getActiveElement(selectedId);
    document.querySelectorAll(".color-swatch").forEach(function (button) {
      button.classList.toggle("selected", button.dataset.color === chosenColor);
    });
  }

  function renderServerMode(mode) {
    const node = document.getElementById("serverMode");
    const value = mode || server.armedMode;
    node.className = "server-mode " + (value === "normal" ? "" : value);
    node.textContent = {
      normal: "正常确认",
      reject: "已设置：下一次操作将被拒绝",
      diverge: "已设置：下一次确认将返回不同结果"
    }[value];
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toastElement.textContent = message;
    toastElement.classList.add("show");
    toastTimer = window.setTimeout(function () {
      toastElement.classList.remove("show");
    }, 2600);
  }

  document.querySelector(".toolbar").addEventListener("click", function (event) {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.action === "add-note") addElement("note");
    if (button.dataset.action === "add-rect") addElement("rect");
    if (button.dataset.action === "add-circle") addElement("circle");
    if (button.dataset.color) {
      chosenColor = button.dataset.color;
      if (selectedId) updateColor(selectedId, chosenColor);
    }
  });

  deleteSelectedButton.addEventListener("click", function () {
    if (selectedId) deleteElement(selectedId);
  });
  document.getElementById("latency").addEventListener("input", function (event) {
    const value = Number(event.target.value);
    server.setMaxLatency(value);
    document.getElementById("latencyValue").textContent = (value / 1000).toFixed(1) + "s";
  });
  document.getElementById("armReject").addEventListener("click", () => server.arm("reject"));
  document.getElementById("armDiverge").addEventListener("click", () => server.arm("diverge"));

  render();
})();
