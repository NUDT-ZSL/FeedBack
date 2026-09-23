/* 记忆模型：指数遗忘曲线 R(t)=exp(-t/S)，S 为记忆稳定度（天）。
 * 保持率低于阈值即到期，间隔由曲线推导而非固定值。 */
(function (global) {
  'use strict';
  var DAY_MS = 86400000;
  var CFG = {
    retrievalThreshold: 0.85, // 保持率低于该值即到期
    nearDueRetention: 0.93,   // 低于该值视为临近到期，进入候选
    minStability: 0.3,
    maxStability: 3650,
    defaultMinutes: 5
  };
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function retrievability(stability, elapsedDays) {
    return Math.exp(-elapsedDays / Math.max(stability, 1e-6));
  }
  function intervalFor(stability, threshold) {
    return -stability * Math.log(threshold || CFG.retrievalThreshold);
  }
  function initialStability(q) {
    if (q >= 5) return 4.0;
    if (q >= 4) return 3.0;
    if (q >= 3) return 1.5;
    if (q >= 2) return 0.8;
    return 0.5;
  }
  /* 应用一次复习。q:0~5 回忆质量；elapsedDays 距上次复习天数 */
  function applyReview(state, q, elapsedDays) {
    var S = state.stability, D = state.difficulty;
    var R = retrievability(S, Math.max(0, elapsedDays));
    var next = { stability: S, difficulty: D, lapses: state.lapses, needsBoost: state.needsBoost };
    if (q >= 3) {
      var gain = 1 + (q - 2) * 0.35 * (1.25 - 0.6 * R) * (1.15 - 0.5 * D);
      next.stability = clamp(S * Math.max(1.08, gain), CFG.minStability, CFG.maxStability);
      next.needsBoost = false;
    } else {
      // 回忆质量明显低于预期：缩短间隔并标记需要加强
      next.stability = clamp(S * (0.4 + 0.1 * q), CFG.minStability, CFG.maxStability);
      next.lapses = state.lapses + 1;
      next.needsBoost = true;
    }
    next.difficulty = clamp(D + 0.08 * (3 - q), 0.3, 1.0);
    return next;
  }
  function freshState() { return { stability: 0, difficulty: 0.7, lapses: 0, needsBoost: false }; }
  /* 由复习历史重放推导状态；overrideStability 为手动调整值 */
  function deriveState(item) {
    var st = freshState();
    var reviews = (item.reviews || []).slice().sort(function (a, b) { return a.ts - b.ts; });
    var prevTs = null;
    for (var i = 0; i < reviews.length; i++) {
      var rv = reviews[i];
      var elapsed = prevTs == null ? 0 : (rv.ts - prevTs) / DAY_MS;
      if (prevTs == null) {
        st.stability = initialStability(rv.q);
        if (rv.q <= 2) { st.needsBoost = true; st.lapses += 1; }
        st.difficulty = clamp(st.difficulty + 0.08 * (3 - rv.q), 0.3, 1.0);
      } else {
        st = applyReview(st, rv.q, elapsed);
      }
      prevTs = rv.ts;
    }
    if (typeof item.overrideStability === 'number' && item.overrideStability > 0) {
      st.stability = clamp(item.overrideStability, CFG.minStability, CFG.maxStability);
    }
    st.lastReviewTs = prevTs;
    return st;
  }
  global.MemoryModel = {
    CFG: CFG, clamp: clamp, retrievability: retrievability, intervalFor: intervalFor,
    deriveState: deriveState, DAY_MS: DAY_MS
  };
})(window);
