(function (global) {
  "use strict";

  const utils = global.WB.utils;

  class WhiteboardStore {
    constructor(options) {
      const settings = options || {};
      this.elements = utils.deepClone(settings.initialElements) || {};
      this.initialElements = utils.deepClone(settings.initialElements) || {};
      this.ops = [];
      this.nextClientSeq = 1;
      this.nextRevision = 1;
      this.outcomeBuffer = new Map();
      this.outcomeLog = [];
      this.rollbackGroups = new Map();
      this.sentRevisions = new Set();
      this.sender = settings.sender || null;
      this.listeners = [];
      this.lastError = "";
    }

    subscribe(listener) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter(function (item) {
          return item !== listener;
        });
      };
    }

    emit(reason) {
      this.listeners.forEach((listener) => listener({ store: this, reason }));
    }

    getOps() {
      return utils.deepClone(this.ops);
    }

    getOp(id) {
      const op = this.ops.find((item) => item.id === id);
      return op ? utils.deepClone(op) : null;
    }

    getCommittedElements() {
      return utils.deepClone(this.elements);
    }

    getActiveElements() {
      let elements = utils.deepClone(this.elements);
      this.ops
        .filter((op) => op.status !== "rolled-back" && !op.retried)
        .forEach((op) => {
          this.applyToMap(elements, op);
        });
      return elements;
    }

    getActiveElement(elementId) {
      return this.getActiveElements()[elementId] || null;
    }

    getElementStatus(elementId) {
      const affecting = this.ops
        .filter((op) => op.elementId === elementId && !op.retried);
      if (!affecting.length) return "confirmed";
      if (affecting.some((op) => op.status === "pending")) return "pending";
      if (affecting.some((op) => op.status === "rolled-back")) return "rolled-back";
      return "confirmed";
    }

    getInflightCount() {
      return this.ops.filter((op) => op.status === "pending" && !op.retried).length;
    }

    getStats() {
      const visible = this.ops.filter((op) => !op.retried);
      return {
        pending: visible.filter((op) => op.status === "pending").length,
        confirmed: visible.filter((op) => op.status === "confirmed").length,
        rolledBack: visible.filter((op) => op.status === "rolled-back").length,
        revision: this.nextRevision - 1
      };
    }

    findActiveOpsBefore(elementId, beforeSeq) {
      return this.ops
        .filter((op) => op.clientSeq < beforeSeq)
        .filter((op) => op.elementId === elementId)
        .filter((op) => op.status !== "rolled-back" && !op.retried);
    }

    dependenciesFor(elementId, beforeSeq) {
      const sameElement = this.findActiveOpsBefore(elementId, beforeSeq);
      const deps = sameElement.length
        ? [sameElement[sameElement.length - 1].id]
        : [];
      return deps;
    }

    addElement(element) {
      const normalized = this.normalizeElement(element);
      const op = this.createOperation({
        type: "add",
        elementId: normalized.id,
        input: { element: normalized }
      });
      return op;
    }

    updateElement(elementId, patch) {
      const current = this.getActiveElement(elementId);
      if (!current) {
        const error = new Error("元素不存在，无法更新：" + elementId);
        this.lastError = error.message;
        this.emit("error");
        throw error;
      }
      const allowed = ["x", "y", "color"].reduce((acc, key) => {
        if (Object.prototype.hasOwnProperty.call(patch, key)) acc[key] = patch[key];
        return acc;
      }, {});
      if (!Object.keys(allowed).length) throw new Error("没有可更新的字段");
      return this.createOperation({
        type: "update",
        elementId,
        input: { patch: allowed },
        basisElement: current
      });
    }

    deleteElement(elementId) {
      const current = this.getActiveElement(elementId);
      if (!current) {
        const error = new Error("元素不存在，无法删除：" + elementId);
        this.lastError = error.message;
        this.emit("error");
        throw error;
      }
      return this.createOperation({
        type: "delete",
        elementId,
        input: {},
        basisElement: current
      });
    }

    beginMoveDraft(elementId) {
      const current = this.getActiveElement(elementId);
      if (!current) throw new Error("元素不存在，无法拖动：" + elementId);
      const seq = this.nextClientSeq;
      const dependencies = this.dependenciesFor(elementId, seq);
      const op = {
        id: utils.makeId("op"),
        clientSeq: seq,
        localAt: Date.now(),
        status: "pending",
        phase: "draft",
        type: "update",
        elementId,
        dependencies,
        input: { patch: { x: current.x, y: current.y } },
        basisHash: utils.stableHash(current),
        basisElement: utils.deepClone(current),
        expectedElement: utils.deepClone(current),
        revision: null,
        outcome: null,
        remoteReason: "",
        divergence: null,
        rollbackGroupId: null,
        retried: false,
        retriedBy: null,
        unsent: true
      };
      this.ops.push(op);
      this.nextClientSeq += 1;
      this.emit("draft-start");
      return utils.deepClone(op);
    }

    updateMoveDraft(opId, x, y) {
      const op = this.ops.find((item) => item.id === opId);
      if (!op || op.status !== "pending" || op.phase !== "draft" || !op.unsent) {
        return null;
      }
      op.input.patch.x = Math.round(x);
      op.input.patch.y = Math.round(y);
      op.expectedElement = Object.assign(utils.deepClone(op.expectedElement), {
        x: Math.round(x),
        y: Math.round(y)
      });
      return utils.deepClone(op);
    }

    cancelMoveDraft(opId) {
      const op = this.ops.find((item) => item.id === opId);
      if (!op || op.phase !== "draft" || !op.unsent) return false;
      const index = this.ops.indexOf(op);
      this.ops.splice(index, 1);
      this.emit("draft-cancel");
      return true;
    }

    normalizeElement(element) {
      const allowedTypes = ["note", "rect", "circle"];
      if (!element || !element.id) throw new Error("元素必须包含 id");
      if (!allowedTypes.includes(element.type)) throw new Error("不支持的元素类型");
      return {
        id: String(element.id),
        type: element.type,
        label: String(element.label || element.type),
        x: Math.round(Number(element.x) || 0),
        y: Math.round(Number(element.y) || 0),
        width: Math.round(Number(element.width) || (element.type === "note" ? 160 : 128)),
        height: Math.round(Number(element.height) || (element.type === "note" ? 110 : 128)),
        color: String(element.color || "#fde68a")
      };
    }

    createOperation(descriptor) {
      const seq = this.nextClientSeq;
      const elementId = descriptor.elementId;
      const dependencies = descriptor.dependencies || this.dependenciesFor(elementId, seq);
      const now = Date.now();
      const op = {
        id: descriptor.id || utils.makeId("op"),
        clientSeq: seq,
        localAt: descriptor.localAt || now,
        status: "pending",
        phase: "queued",
        type: descriptor.type,
        elementId,
        dependencies,
        input: utils.deepClone(descriptor.input || {}),
        basisHash: descriptor.basisElement
          ? utils.stableHash(descriptor.basisElement)
          : null,
        basisElement: descriptor.basisElement ? utils.deepClone(descriptor.basisElement) : null,
        expectedElement: null,
        revision: null,
        outcome: null,
        remoteReason: "",
        divergence: null,
        rollbackGroupId: null,
        retried: false,
        retriedBy: null
      };
      op.expectedElement = this.snapshotAfter(op);
      this.ops.push(op);
      this.nextClientSeq += 1;
      this.emit("local-op:" + op.type);
      return utils.deepClone(op);
    }

    snapshotAfter(op) {
      if (op.type === "delete") return null;
      if (op.type === "add") return utils.deepClone(op.input.element);
      const before = op.basisElement || this.getActiveElement(op.elementId);
      if (!before) return null;
      const after = utils.deepClone(before);
      Object.assign(after, op.input.patch || {});
      ["x", "y", "width", "height"].forEach(function (key) {
        if (after[key] !== undefined && after[key] !== null) after[key] = Math.round(after[key]);
      });
      return after;
    }

    applyToMap(elements, op) {
      const next = elements;
      if (op.status === "rolled-back") return next;
      if (op.type === "add") {
        if (op.expectedElement) next[op.elementId] = utils.deepClone(op.expectedElement);
      } else if (op.type === "update") {
        if (!next[op.elementId]) return next;
        if (op.expectedElement) next[op.elementId] = utils.deepClone(op.expectedElement);
      } else if (op.type === "delete") {
        delete next[op.elementId];
      }
      return next;
    }

    sendOperation(opId, revision) {
      const op = this.ops.find((item) => item.id === opId);
      if (!op || op.status !== "pending") return null;
      op.phase = "in-flight";
      op.unsent = false;
      if (revision !== undefined && revision !== null) {
        op.revision = revision;
        this.sentRevisions.add(revision);
      }
      this.emit("send");
      return utils.deepClone(op);
    }

    receiveOutcome(incoming) {
      const op = this.ops.find((item) => item.id === incoming.opId);
      if (!op) {
        const error = new Error("收到未知操作结果：" + incoming.opId);
        this.lastError = error.message;
        throw error;
      }
      const revision = Number(incoming.revision);
      if (!Number.isInteger(revision) || revision < 1) throw new Error("确认修订号无效");
      op.phase = "received";
      op.revision = revision;
      this.outcomeBuffer.set(revision, {
        opId: op.id,
        status: incoming.status === "accepted" ? "accepted" : "rejected",
        element: incoming.element ? this.normalizeElement(incoming.element) : null,
        reason: incoming.reason || ""
      });
      this.emit("outcome-buffered");
      this.drainOutcomes();
      return this.getOp(op.id);
    }

    drainOutcomes() {
      while (this.outcomeBuffer.has(this.nextRevision)) {
        const outcome = this.outcomeBuffer.get(this.nextRevision);
        this.outcomeBuffer.delete(this.nextRevision);
        const op = this.ops.find((item) => item.id === outcome.opId);
        const alreadyRolledBack = op ? op.status === "rolled-back" : false;
        if (op) this.commitOutcome(op, outcome, this.nextRevision);
        this.outcomeLog.push(utils.deepClone(Object.assign(
          { revision: this.nextRevision },
          outcome,
          op ? { elementId: op.elementId, opType: op.type } : {},
          alreadyRolledBack ? { ignoredLate: true } : {}
        )));
        this.nextRevision += 1;
      }
    }

    commitOutcome(op, outcome, revision) {
      op.revision = revision;
      op.outcome = utils.deepClone(outcome);
      op.remoteReason = outcome.reason || "";

      if (op.status === "rolled-back") {
        op.phase = "settled";
        this.emit("late-outcome");
        return;
      }
      if (op.status !== "pending") return;

      if (outcome.status === "rejected") {
        const dependentIds = this.collectDependents(op.id);
        const group = this.ensureRollbackGroup(op, dependentIds, "rejected");
        [op.id].concat(dependentIds).forEach((id) => {
          this.markRolledBack(id, outcome.reason || "服务端拒绝了该操作", group.id);
        });
        op.phase = "settled";
        this.emit("rejected");
        return;
      }

      const actual = outcome.element ? this.normalizeElement(outcome.element) : null;
      const divergent = !utils.elementsEqual(actual, op.expectedElement);
      if (divergent) {
        this.commitAuthoritativeElement(op, actual);
        op.status = "rolled-back";
        op.phase = "settled";
        op.divergence = {
          expected: utils.deepClone(op.expectedElement),
          actual: utils.deepClone(actual),
          reason: outcome.reason || "服务端返回的最终元素与本地预期不同"
        };
        const dependentIds = this.collectDependents(op.id);
        const group = this.ensureRollbackGroup(op, dependentIds, "diverged");
        [op.id].concat(dependentIds).forEach((id) => {
          this.markRolledBack(id, op.divergence.reason, group.id);
        });
        this.emit("diverged");
        return;
      }

      if (op.type === "delete") {
        delete this.elements[op.elementId];
      } else if (actual) {
        this.elements[op.elementId] = utils.deepClone(actual);
      }
      op.status = "confirmed";
      op.phase = "settled";
      op.divergence = null;
      this.emit("confirmed");
    }

    commitAuthoritativeElement(op, actual) {
      if (op.type === "delete" || !actual) {
        delete this.elements[op.elementId];
      } else {
        this.elements[op.elementId] = utils.deepClone(actual);
      }
    }

    collectDependents(rootId) {
      const result = [];
      const seen = new Set([rootId]);
      let frontier = [rootId];
      while (frontier.length) {
        const current = new Set(frontier);
        const nextLevel = this.ops
          .filter((op) => op.status === "pending" && !seen.has(op.id))
          .filter((op) => op.dependencies.some((dep) => current.has(dep)))
          .map((op) => op.id);
        nextLevel.forEach((id) => {
          if (!seen.has(id)) {
            seen.add(id);
            result.push(id);
          }
        });
        frontier = nextLevel;
      }
      return result.sort((a, b) => {
        const opA = this.ops.find((op) => op.id === a);
        const opB = this.ops.find((op) => op.id === b);
        return opA.clientSeq - opB.clientSeq;
      });
    }

    ensureRollbackGroup(root, dependentIds, kind) {
      const existing = Array.from(this.rollbackGroups.values())
        .find((group) => group.rootOpId === root.id && !group.retried);
      if (existing) return existing;

      const rolledIds = [root.id].concat(dependentIds);
      const group = {
        id: "rb_" + root.clientSeq + "_" + Math.random().toString(36).slice(2, 7),
        rootOpId: root.id,
        kind,
        reason: kind === "diverged"
          ? (root.divergence && root.divergence.reason) || "本地预期与服务结果不同"
          : root.remoteReason || "服务端拒绝了该操作",
        createdAt: Date.now(),
        opIds: rolledIds,
        divergedRootId: kind === "diverged" ? root.id : null,
        previewByElement: this.buildRollbackPreview(root, rolledIds, kind),
        retried: false,
        retriedAt: null
      };
      this.rollbackGroups.set(group.id, group);
      return group;
    }

    buildRollbackPreview(root, rolledIds, kind) {
      const ids = new Set(rolledIds);
      const rolledOps = this.ops
        .filter((op) => ids.has(op.id))
        .sort((a, b) => a.clientSeq - b.clientSeq);
      const byElement = new Map();

      rolledOps.forEach((op, index) => {
        let before;
        if (index === 0) {
          before = op.type === "add" ? null : utils.deepClone(op.basisElement);
        } else if (byElement.has(op.elementId)) {
          before = utils.deepClone(byElement.get(op.elementId).attempted);
        } else {
          before = op.type === "add" ? null : utils.deepClone(op.basisElement);
        }

        let attempted = before ? utils.deepClone(before) : null;
        if (op.type === "add") attempted = utils.deepClone(op.expectedElement);
        if (op.type === "update" && attempted) Object.assign(attempted, op.input.patch || {});
        if (op.type === "delete") attempted = null;
        byElement.set(op.elementId, {
          before,
          attempted,
          kind: attempted ? "value" : "deleted"
        });
      });

      if (kind === "diverged" && root.expectedElement && !byElement.has(root.elementId)) {
        byElement.set(root.elementId, {
          before: utils.deepClone(root.basisElement),
          attempted: utils.deepClone(root.expectedElement),
          kind: "diverged",
          remoteActual: utils.deepClone(root.divergence ? root.divergence.actual : null)
        });
      } else if (kind === "diverged" && byElement.has(root.elementId)) {
        byElement.get(root.elementId).remoteActual = utils.deepClone(
          root.divergence ? root.divergence.actual : null
        );
      }
      if (kind === "diverged" && byElement.has(root.elementId)) {
        byElement.get(root.elementId).kind = "diverged";
      }
      return Object.fromEntries(byElement);
    }

    markRolledBack(opId, reason, groupId) {
      const op = this.ops.find((item) => item.id === opId);
      if (!op) return;
      op.status = "rolled-back";
      op.rollbackGroupId = groupId;
      op.rollbackReason = reason;
      if (op.phase === "settled") return;
      op.phase = op.unsent || op.phase === "draft"
        ? "local-cancelled"
        : "awaiting-late-outcome";
    }

    getRollbackGroups() {
      return Array.from(this.rollbackGroups.values())
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((group) => {
          const copy = utils.deepClone(group);
          copy.operations = copy.opIds
            .map((id) => this.ops.find((op) => op.id === id))
            .filter(Boolean);
          copy.hasPendingOutcome = copy.opIds.some((id) => {
            const op = this.ops.find((item) => item.id === id);
            return op && op.phase !== "settled";
          });
          return copy;
        });
    }

    retryGroup(groupId) {
      const group = this.rollbackGroups.get(groupId);
      if (!group) throw new Error("回退组不存在");
      if (group.retried) throw new Error("该回退组已经重新发起");
      const unresolved = group.opIds.some((id) => {
        const op = this.ops.find((item) => item.id === id);
        return !op || op.phase !== "settled";
      });
      if (unresolved) throw new Error("仍有操作等待服务返回，暂时不能重试");

      const oldOps = group.opIds
        .map((id) => this.ops.find((op) => op.id === id))
        .filter(Boolean)
        .sort((a, b) => a.clientSeq - b.clientSeq);
      const newOps = [];
      const skipped = [];
      const replacementById = {};

      oldOps.forEach((oldOp) => {
        if (oldOp.retried) return;
        let newOp = null;
        const current = this.getActiveElement(oldOp.elementId);

        if (oldOp.type === "add") {
          if (current) {
            skipped.push(oldOp.id);
          } else {
            newOp = this.createOperation({
              type: "add",
              elementId: oldOp.elementId,
              input: oldOp.input,
              dependencies: []
            });
          }
          if (newOp) replacementById[oldOp.id] = newOp.id;
        } else if (oldOp.type === "delete") {
          if (!current) {
            skipped.push(oldOp.id);
          } else {
            newOp = this.createOperation({
              type: "delete",
              elementId: oldOp.elementId,
              input: {},
              basisElement: current
            });
          }
          if (newOp) replacementById[oldOp.id] = newOp.id;
        } else if (oldOp.type === "update") {
          if (!current) {
            skipped.push(oldOp.id);
            return;
          }
          const patch = oldOp.input.patch || {};
          const changed = Object.keys(patch).some((key) => current[key] !== patch[key]);
          if (!changed) {
            skipped.push(oldOp.id);
          } else {
            newOp = this.createOperation({
              type: "update",
              elementId: oldOp.elementId,
              input: { patch },
              basisElement: current
            });
          }
          if (newOp) replacementById[oldOp.id] = newOp.id;
        }

        if (newOp) newOps.push(newOp);
      });

      oldOps.forEach((oldOp) => {
        oldOp.retried = true;
        oldOp.retriedBy = replacementById[oldOp.id] || (skipped.includes(oldOp.id) ? "skipped" : null);
      });
      group.retried = true;
      group.retriedAt = Date.now();
      group.retriedOpIds = newOps.map((op) => op.id);
      group.skippedOpIds = skipped;
      this.emit("retry");
      return { group: utils.deepClone(group), operations: newOps, skipped };
    }

    getKeptOps() {
      const rolledIds = new Set();
      this.ops.forEach((op) => {
        if (op.status === "rolled-back" && !op.retried) rolledIds.add(op.id);
      });
      return this.ops
        .filter((op) => !rolledIds.has(op.id))
        .filter((op) => op.status === "confirmed" || op.status === "pending")
        .map((op) => ({
          id: op.id,
          elementId: op.elementId,
          type: op.type,
          status: op.status
        }));
    }

    assertConvergedWithReplay() {
      const replay = WhiteboardStore.replayOutcomes(this.initialElements, this.outcomeLog);
      const current = this.getCommittedElements();
      const replayIds = Object.keys(replay).sort();
      const currentIds = Object.keys(current).sort();
      if (JSON.stringify(replayIds) !== JSON.stringify(currentIds)) {
        throw new Error("权威元素集合与按确认顺序重放结果不一致");
      }
      replayIds.forEach((id) => {
        if (!utils.elementsEqual(replay[id], current[id])) {
          throw new Error("元素 " + id + " 与按确认顺序重放结果不一致");
        }
      });
      return { ok: true, revision: this.nextRevision - 1, count: replayIds.length };
    }

    static replayOutcomes(initialElements, outcomes) {
      const elements = utils.deepClone(initialElements || {});
      outcomes
        .slice()
        .sort((a, b) => a.revision - b.revision)
        .forEach((outcome) => {
          if (outcome.ignoredLate) return;
          if (outcome.status !== "accepted") {
            return;
          }
          if (!outcome.element) {
            delete elements[outcome.elementId];
            return;
          }
          const element = {
            id: outcome.element.id,
            type: outcome.element.type,
            label: outcome.element.label,
            x: outcome.element.x,
            y: outcome.element.y,
            width: outcome.element.width,
            height: outcome.element.height,
            color: outcome.element.color
          };
          elements[element.id] = element;
        });
      return elements;
    }
  }

  global.WB = global.WB || {};
  global.WB.WhiteboardStore = WhiteboardStore;
})(typeof window !== "undefined" ? window : globalThis);
