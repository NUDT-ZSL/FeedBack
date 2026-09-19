/*
 * 分片计算调度引擎（纯逻辑，无 DOM 依赖）。
 * 浏览器中挂载为 window.Scheduler，Node 中通过 module.exports 导出，便于离线自动化验证。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.Scheduler = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  function createScheduler(options) {
    const config = Object.assign({ shardSize: 10, frameBudget: 6 }, options || {});
    const tasks = new Map(); // id -> task，插入序即提交序
    let seqCounter = 0;
    let queue = []; // 待推进任务 id，按当前规划顺序排列
    let lifecycle = "visible";
    const eventLog = [];

    function remainingWork(t) { return t.totalWork - t.completedWork; }
    function currentShard(t) { return t.shards[t.shardCursor] || null; }
    function headTask() {
      for (const id of queue) {
        const t = tasks.get(id);
        if (t && t.status !== "done" && t.status !== "cancelled" && remainingWork(t) > 0) return t;
      }
      return null;
    }
    function pausePosition(t) {
      if (t.status === "done") return null;
      const shard = currentShard(t);
      if (!shard) return null;
      return { shardIndex: shard.index, offset: shard.done };
    }
    function logEvent(type, detail, taskId) {
      const entry = { at: eventLog.length + 1, type: type, taskId: taskId || null, detail: detail };
      eventLog.push(entry);
      return entry;
    }

    function buildShards(totalWork) {
      const shards = [];
      let left = totalWork;
      let index = 0;
      while (left > 0) {
        const work = Math.min(config.shardSize, left);
        shards.push({ index: index++, work: work, done: 0 });
        left -= work;
      }
      return shards;
    }

    // 校验整批任务：标识唯一（不得与既有任务或批内重复）、总工作量必须为正数。
    // 错误携带批内下标 index 与字段名 field 以指出出错位置；有任何错误则整批拒绝。
    function validateBatch(items) {
      const errors = [];
      const seen = new Set();
      items.forEach(function (item, i) {
        const rawId = item ? item.id : undefined;
        if (rawId === undefined || rawId === null || String(rawId).trim() === "") {
          errors.push({ index: i, field: "id", message: "任务标识缺失" });
        } else {
          const key = String(rawId);
          if (tasks.has(key) || seen.has(key)) {
            errors.push({ index: i, field: "id", message: "标识 \"" + key + "\" 重复" });
          }
          seen.add(key);
        }
        const w = item ? item.totalWork : undefined;
        if (typeof w !== "number" || !isFinite(w) || w <= 0) {
          errors.push({ index: i, field: "totalWork", message: "总工作量必须为正数（收到 " + JSON.stringify(w === undefined ? null : w) + "）" });
        }
        const p = item ? item.priority : undefined;
        if (p !== undefined && (typeof p !== "number" || !isFinite(p))) {
          errors.push({ index: i, field: "priority", message: "优先级必须是数字" });
        }
      });
      return errors;
    }

    function addTasks(items) {
      if (!Array.isArray(items) || items.length === 0) {
        return { ok: false, errors: [{ index: -1, field: "batch", message: "提交批次为空" }] };
      }
      const errors = validateBatch(items);
      if (errors.length > 0) return { ok: false, errors: errors };
      items.forEach(function (item) {
        const id = String(item.id);
        const task = {
          id: id,
          totalWork: item.totalWork,
          priority: typeof item.priority === "number" ? item.priority : 0,
          seq: seqCounter++,
          shards: buildShards(item.totalWork),
          shardCursor: 0,
          completedWork: 0,
          status: "queued",
          deferReason: null,
          lastEvent: null,
        };
        task.lastEvent = logEvent("submit", "任务提交，共 " + task.shards.length + " 个分片", id);
        tasks.set(id, task);
      });
      replan();
      refreshStatuses();
      return { ok: true, errors: [] };
    }

    // 推进顺序是 (优先级降序, 提交序升序) 的纯函数：
    // 取消或调优先级后重算该函数，结果与从头全量重规划完全一致；
    // 重算只改排队顺序，不触碰任何任务的分片游标与已完成工作量。
    function compareTasks(a, b) {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.seq - b.seq;
    }
    function plannedOrder() {
      return Array.from(tasks.values())
        .filter(function (t) { return t.status !== "cancelled" && t.status !== "done" && remainingWork(t) > 0; })
        .sort(compareTasks)
        .map(function (t) { return t.id; });
    }
    function replan() { queue = plannedOrder(); return queue.slice(); }

    function refreshStatuses() {
      const head = headTask();
      tasks.forEach(function (t) {
        if (t.status === "done" || t.status === "cancelled") return;
        t.status = head && t.id === head.id
          ? (lifecycle === "visible" ? "active" : "paused")
          : "queued";
      });
    }

    // 生命周期切换：隐藏时仅记录暂停位置（分片序号 + 片内偏移），不清空任何进度；
    // 恢复时从同一偏移续起，不整片重跑。
    function setLifecycle(state) {
      if (state === lifecycle) return lifecycle;
      lifecycle = state;
      const head = headTask();
      if (state === "hidden") {
        logEvent("lifecycle", "页面隐藏，调度暂停");
        if (head) {
          const pos = pausePosition(head);
          head.lastEvent = logEvent("lifecycle", "页面隐藏，暂停于分片 #" + pos.shardIndex + " 偏移 " + pos.offset, head.id);
        }
      } else {
        logEvent("lifecycle", "页面恢复，调度继续");
        if (head) {
          const pos = pausePosition(head);
          head.lastEvent = logEvent("lifecycle", "页面恢复，从分片 #" + pos.shardIndex + " 偏移 " + pos.offset + " 续起", head.id);
        }
      }
      refreshStatuses();
      return lifecycle;
    }

    // 推进一帧。整帧额度不足时队首分片顺延并记录依据；
    // 分片超出帧内剩余额度时把该片切小推进、剩余部分顺延，绝不静默丢弃或停滞。
    function step(budget) {
      const report = { advances: [], defers: [], idle: false, reason: null };
      if (lifecycle !== "visible") {
        report.idle = true;
        report.reason = "页面隐藏，调度已暂停";
        return report;
      }
      let budgetLeft = typeof budget === "number" ? budget : config.frameBudget;
      const head = headTask();
      if (!head) {
        report.idle = true;
        report.reason = "队列空闲";
        return report;
      }
      if (budgetLeft <= 0) {
        const shard = currentShard(head);
        defer(head, shard, "单帧可用额度为 " + Math.max(0, budgetLeft) + "，分片 #" + shard.index + " 顺延至下一帧", report);
        return report;
      }
      while (budgetLeft > 0) {
        const task = headTask();
        if (!task) break;
        const shard = currentShard(task);
        const shardLeft = shard.work - shard.done;
        const amount = Math.min(budgetLeft, shardLeft);
        if (amount <= 0) break; // 防御：理论不可达
        shard.done += amount; // 只累加实际推进量，恢复时从偏移续起，不重复计入
        task.completedWork += amount;
        budgetLeft -= amount;
        report.advances.push({ taskId: task.id, shardIndex: shard.index, amount: amount });
        if (shard.done < shard.work) {
          defer(task, shard, "分片 #" + shard.index + " 工作量 " + shard.work + " 超出本帧剩余额度，已切小推进 " + amount + "，剩余 " + (shard.work - shard.done) + " 顺延至后续帧", report);
        } else {
          task.deferReason = null;
          task.shardCursor += 1;
          if (task.shardCursor >= task.shards.length) {
            task.status = "done";
            task.lastEvent = logEvent("done", "任务完成，累计推进 " + task.completedWork, task.id);
            replan();
          }
        }
      }
      refreshStatuses();
      return report;
    }

    function defer(task, shard, reason, report) {
      task.deferReason = reason;
      if (!task.lastEvent || task.lastEvent.detail !== reason) {
        task.lastEvent = logEvent("defer", reason, task.id);
      }
      report.defers.push({ taskId: task.id, shardIndex: shard.index, reason: reason });
    }

    // 取消：仅把该任务移出规划并重算顺序，其他任务的游标与已完成量保持不变。
    function cancel(id) {
      const t = tasks.get(String(id));
      if (!t) return { ok: false, error: "任务不存在：" + id };
      if (t.status === "done") return { ok: false, error: "任务已完成，无法取消" };
      if (t.status === "cancelled") return { ok: false, error: "任务已取消" };
      t.status = "cancelled";
      t.deferReason = null;
      t.lastEvent = logEvent("cancel", "任务被取消，仅重算推进顺序，未影响其他任务的推进位置", t.id);
      replan();
      refreshStatuses();
      return { ok: true, queue: queue.slice() };
    }

    // 调优先级：只重算推进顺序（与从头重规划一致），不回退任何已推进位置。
    function setPriority(id, priority) {
      const t = tasks.get(String(id));
      if (!t) return { ok: false, error: "任务不存在：" + id };
      if (typeof priority !== "number" || !isFinite(priority)) return { ok: false, error: "优先级必须是数字" };
      if (t.status === "done" || t.status === "cancelled") return { ok: false, error: "任务已结束，优先级调整无效" };
      const old = t.priority;
      if (old === priority) return { ok: true, queue: queue.slice() };
      t.priority = priority;
      t.lastEvent = logEvent("replan", "优先级 " + old + " → " + priority + "，推进顺序重算（与从头重规划一致）", t.id);
      replan();
      refreshStatuses();
      return { ok: true, queue: queue.slice() };
    }

    function query(id) {
      const t = tasks.get(String(id));
      if (!t) return null;
      return {
        id: t.id,
        status: t.status,
        priority: t.priority,
        totalWork: t.totalWork,
        completedWork: t.completedWork,
        remainingWork: remainingWork(t),
        shardCount: t.shards.length,
        shardCursor: t.shardCursor,
        shards: t.shards.map(function (s) {
          return { index: s.index, work: s.work, done: s.done, left: s.work - s.done };
        }),
        remainingShards: t.shards.slice(t.shardCursor).map(function (s) {
          return { index: s.index, work: s.work, done: s.done, left: s.work - s.done };
        }),
        pausePosition: pausePosition(t),
        deferReason: t.deferReason,
        lastEvent: t.lastEvent,
      };
    }

    // 任意任务的查询结果按稳定顺序返回：优先级降序，提交序升序。
    function queryAll() {
      return Array.from(tasks.values()).sort(compareTasks).map(function (t) { return query(t.id); });
    }

    return {
      config: config,
      addTasks: addTasks,
      step: step,
      cancel: cancel,
      setPriority: setPriority,
      setLifecycle: setLifecycle,
      query: query,
      queryAll: queryAll,
      plannedOrder: plannedOrder, // 从头全量重规划的顺序，用于校验增量重算一致性
      getQueue: function () { return queue.slice(); },
      getLifecycle: function () { return lifecycle; },
      getLog: function (limit) {
        return typeof limit === "number" ? eventLog.slice(-limit) : eventLog.slice();
      },
      removeFinished: function () {
        const removed = [];
        tasks.forEach(function (t, id) {
          if (t.status === "done" || t.status === "cancelled") {
            tasks.delete(id);
            removed.push(id);
          }
        });
        replan();
        refreshStatuses();
        return removed;
      },
    };
  }

  return { createScheduler: createScheduler };
});
