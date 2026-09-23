/* 排期与每日清单：由遗忘曲线推导到期时间与紧迫度，按预算挑选清单。 */
(function (global) {
  'use strict';
  var M = global.MemoryModel;
  var DAY_MS = M.DAY_MS, CFG = M.CFG;

  /* 计算知识点当前排期信息 */
  function schedule(item, now) {
    var st = M.deriveState(item);
    var created = item.createdAt || now;
    var anchor = st.lastReviewTs != null ? st.lastReviewTs : created;
    var elapsed = Math.max(0, (now - anchor) / DAY_MS);
    var S = st.stability > 0 ? st.stability : 0.5; // 未复习过按很弱处理
    var R = st.lastReviewTs == null ? 0 : M.retrievability(S, elapsed);
    var interval = M.intervalFor(S);
    var dueTs = anchor + interval * DAY_MS;
    return {
      state: st,
      retention: R,
      intervalDays: interval,
      dueTs: dueTs,
      overdueDays: (now - dueTs) / DAY_MS, // >0 已逾期，<0 距到期天数
      elapsedDays: elapsed,
      neverReviewed: st.lastReviewTs == null
    };
  }

  function fmtDays(d) {
    var a = Math.abs(d);
    if (a < 0.04) return '今天';
    if (a < 1) return Math.max(1, Math.round(a * 24)) + ' 小时';
    if (a < 30) return a.toFixed(1) + ' 天';
    return (a / 30).toFixed(1) + ' 个月';
  }

  /* 生成入选理由 */
  function reasonFor(sch) {
    var parts = [];
    if (sch.neverReviewed) {
      parts.push('新知识点，尚未复习，需建立初始记忆');
    } else if (sch.overdueDays > 0.04) {
      parts.push('已逾期 ' + fmtDays(sch.overdueDays) +
        '，保持率降至约 ' + Math.round(sch.retention * 100) + '%');
    } else if (sch.overdueDays > -0.5) {
      parts.push('今日到期，保持率约 ' + Math.round(sch.retention * 100) + '%');
    } else {
      parts.push('临近到期（约 ' + fmtDays(-sch.overdueDays) + ' 后到期），提前巩固');
    }
    if (sch.state.needsBoost) {
      parts.push('上次回忆质量偏低，已标记需要加强并缩短间隔');
    }
    return parts.join('；');
  }

  /* 在时间预算内生成当日复习清单 */
  function buildPlan(items, budgetMinutes, now) {
    var candidates = [];
    for (var i = 0; i < items.length; i++) {
      var sch = schedule(items[i], now);
      if (sch.neverReviewed || sch.retention <= CFG.nearDueRetention) {
        candidates.push({ item: items[i], sch: sch });
      }
    }
    candidates.sort(function (a, b) {
      var ba = a.sch.state.needsBoost ? 1 : 0, bb = b.sch.state.needsBoost ? 1 : 0;
      if (ba !== bb) return bb - ba;                 // 需要加强优先
      return b.sch.overdueDays - a.sch.overdueDays;  // 再按紧迫度降序
    });
    var list = [], used = 0, skipped = [];
    for (var j = 0; j < candidates.length; j++) {
      var c = candidates[j];
      var mins = c.item.minutes || CFG.defaultMinutes;
      if (used + mins <= budgetMinutes) {
        used += mins;
        list.push({ item: c.item, sch: c.sch, reason: reasonFor(c.sch) });
      } else {
        skipped.push({ item: c.item, sch: c.sch });
      }
    }
    return { list: list, totalMinutes: used, budget: budgetMinutes, skipped: skipped };
  }

  global.Plan = { schedule: schedule, buildPlan: buildPlan, reasonFor: reasonFor, fmtDays: fmtDays };
})(window);
