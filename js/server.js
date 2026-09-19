(function (global) {
  "use strict";

  const utils = global.WB.utils;

  class MockLocalServer {
    constructor(initialElements, options) {
      const settings = options || {};
      this.elements = utils.deepClone(initialElements || {});
      this.maxLatency = settings.maxLatency === undefined ? 1200 : settings.maxLatency;
      this.armedMode = "normal";
      this.pendingCount = 0;
      this.onModeChange = settings.onModeChange || function () {};
    }

    setMaxLatency(ms) {
      this.maxLatency = Math.max(0, Number(ms) || 0);
    }

    arm(mode) {
      this.armedMode = mode === "reject" || mode === "diverge" ? mode : "normal";
      this.onModeChange(this.armedMode);
    }

    submit(op, callback) {
      const revision = ++this.pendingCount;
      const outcome = this.process(op, revision);
      const delay = this.maxLatency === 0
        ? 0
        : Math.round(Math.random() * this.maxLatency);
      global.setTimeout(() => {
        callback(outcome);
      }, delay);
      return revision;
    }

    process(op, revision) {
      const current = this.elements[op.elementId] || null;

      if (this.armedMode === "reject") {
        this.armedMode = "normal";
        this.onModeChange(this.armedMode);
        return this.rejected(op, revision, "模拟服务端拒绝：权限、校验或写入冲突未通过");
      }

      if (op.type === "add") {
        if (current) {
          return this.rejected(op, revision, "元素已存在，重复添加被拒绝");
        }
        if (this.armedMode === "diverge") {
          this.armedMode = "normal";
          this.onModeChange(this.armedMode);
          const shifted = this.applyDivergence(op.input.element);
          this.elements[op.elementId] = shifted;
          return this.accepted(op, revision, shifted, "服务端调整了位置以避免重叠");
        }
        const element = utils.deepClone(op.input.element);
        this.elements[element.id] = element;
        return this.accepted(op, revision, element);
      }

      if (!current) {
        return this.rejected(op, revision, "目标元素不存在，可能已被其他会话删除");
      }
      if (op.basisHash && utils.stableHash(current) !== op.basisHash) {
        return this.rejected(op, revision, "前置状态不匹配：该操作依赖的本地版本已过期");
      }

      if (op.type === "delete") {
        if (this.armedMode === "diverge") {
          this.armedMode = "normal";
          this.onModeChange(this.armedMode);
          return this.accepted(op, revision, current, "服务端没有删除元素，而是保留并恢复了它");
        }
        delete this.elements[op.elementId];
        return this.accepted(op, revision, null);
      }

      if (this.armedMode === "diverge") {
        this.armedMode = "normal";
        this.onModeChange(this.armedMode);
        const element = this.applyDivergence(current, op.input.patch);
        this.elements[op.elementId] = element;
        return this.accepted(op, revision, element, "服务端规范化了属性或位置");
      }

      const element = Object.assign(utils.deepClone(current), op.input.patch || {});
      ["x", "y", "width", "height"].forEach(function (key) {
        if (element[key] !== undefined) element[key] = Math.round(element[key]);
      });
      this.elements[op.elementId] = element;
      return this.accepted(op, revision, element);
    }

    applyDivergence(element, patch) {
      const next = utils.deepClone(element);
      if (patch) Object.assign(next, patch);
      if (next.type === "note") next.color = "#fecdd3";
      else next.color = "#bae6fd";
      next.x = Math.max(24, (Number(next.x) || 0) + 46);
      next.y = Math.max(24, (Number(next.y) || 0) + 32);
      return next;
    }

    accepted(op, revision, element, reason) {
      const result = {
        opId: op.id,
        revision,
        status: "accepted",
        element: element ? utils.deepClone(element) : null
      };
      if (reason) result.reason = reason;
      return result;
    }

    rejected(op, revision, reason) {
      return { opId: op.id, revision, status: "rejected", element: null, reason };
    }
  }

  global.WB = global.WB || {};
  global.WB.MockLocalServer = MockLocalServer;
})(typeof window !== "undefined" ? window : globalThis);
