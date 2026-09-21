/* 资产全周期价值推导引擎（纯函数，无依赖；浏览器与 Node 通用）。
 *
 * asset = { id, name, cost, start:"YYYY-MM", lifeYears, salvage,
 *           disposalTime:"YYYY-MM"|"", disposalProceeds:Number|null,
 *           adjustments:[{ id, time:"YYYY-MM",
 *             type:"impairment"|"appreciation"|"revaluation", // 减值/增值/重估
 *             amount, pending:待核实, excluded:裁决排除, note, seq:录入顺序 }] }
 *
 * 推导规则：
 *  - 以月为最小期间，自启用时刻起共 lifeYears*12 期；
 *  - 每期期初先应用该时点全部未排除调整（重估=设为金额，减值=减，增值=加），
 *    再按剩余期间直线法计提折旧（不低于残值）；
 *  - 同一时点 >=2 条未排除调整即冲突：全部保留并标记，推导照常但结论不可信，
 *    由使用者裁决（排除或修改）后重推；
 *  - 缺启用时刻/年限/残值，或调整后价值越界（<0 或 >成本），结论不可信并说明原因。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ValueEngine = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const EPS = 1e-9;
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function parseYM(s) {
    if (typeof s !== "string") return null;
    const m = /^(\d{4})-(\d{2})$/.exec(s.trim());
    if (!m) return null;
    const y = +m[1], mo = +m[2];
    if (mo < 1 || mo > 12) return null;
    return y * 12 + (mo - 1);
  }
  function toYM(idx) {
    const y = Math.floor(idx / 12), mo = (idx % 12) + 1;
    return y + "-" + String(mo).padStart(2, "0");
  }
  function round2(x) { return Math.round(x * 100) / 100; }
  function round6(x) { return Math.round(x * 1e6) / 1e6; }
  const TYPE_LABEL = { impairment: "减值", appreciation: "增值", revaluation: "重估" };
  /* 推导单项资产。纯函数：相同输入必得相同输出，因此
   * “只重推受影响资产”与“整体重推”天然一致。 */
  function computeAsset(asset) {
    const issues = [];
    const cost = asset.cost, salvage = asset.salvage;
    const startIdx = parseYM(asset.start);
    const lifeMonths = isNum(asset.lifeYears) && asset.lifeYears > 0
      ? Math.round(asset.lifeYears * 12) : 0;
    if (!isNum(cost) || cost < 0)
      issues.push({ code: "MISSING_COST", message: "缺少有效的投入成本" });
    if (startIdx === null)
      issues.push({ code: "MISSING_START", message: "缺少启用时刻" });
    if (lifeMonths <= 0)
      issues.push({ code: "MISSING_LIFE", message: "缺少有效的预计使用年限" });
    if (!isNum(salvage) || salvage < 0)
      issues.push({ code: "MISSING_SALVAGE", message: "缺少残值预期" });
    else if (isNum(cost) && salvage > cost)
      issues.push({ code: "SALVAGE_GT_COST", message: "残值预期高于投入成本，请确认" });
    const adjustments = (asset.adjustments || []).slice()
      .sort((a, b) => (a.seq || 0) - (b.seq || 0));
    const active = adjustments.filter(a => !a.excluded && parseYM(a.time) !== null);
    // 冲突检测：同一时点 >=2 条未排除调整，全部保留并标出
    const byTime = new Map();
    for (const a of active) {
      if (!byTime.has(a.time)) byTime.set(a.time, []);
      byTime.get(a.time).push(a);
    }
    const conflicts = [];
    for (const [time, list] of byTime)
      if (list.length >= 2) conflicts.push({ time, adjustmentIds: list.map(a => a.id) });
    conflicts.sort((a, b) => parseYM(a.time) - parseYM(b.time));
    const baseMissing = issues.some(i => i.code.indexOf("MISSING_") === 0);
    if (baseMissing) {
      return {
        assetId: asset.id, ok: false, trustworthy: false,
        issues, conflicts, periods: [], disposal: null,
        hasConflicts: conflicts.length > 0,
        hasPending: adjustments.some(a => a.pending && !a.excluded),
      };
    }
    const dispIdx = parseYM(asset.disposalTime);
    const endIdx = startIdx + lifeMonths - 1;
    let lastIdx = endIdx;
    if (dispIdx !== null && dispIdx >= startIdx && dispIdx <= endIdx) lastIdx = dispIdx;
    else if (dispIdx !== null)
      issues.push({ code: "DISPOSAL_OUT_OF_RANGE", message: "处置时刻不在使用周期内，已忽略" });
    const periods = [];
    let value = cost;
    let remaining = lifeMonths;
    let outOfBounds = false;
    for (let idx = startIdx; idx <= lastIdx; idx++, remaining--) {
      const time = toYM(idx);
      const openValue = value;
      const here = byTime.get(time) || [];
      const adjDetails = [];
      let adjDelta = 0;
      for (const a of here) {
        let delta;
        if (a.type === "revaluation") delta = a.amount - value;
        else if (a.type === "impairment") delta = -Math.abs(a.amount);
        else delta = Math.abs(a.amount); // appreciation
        value += delta;
        adjDelta += delta;
        adjDetails.push({ id: a.id, type: a.type, label: TYPE_LABEL[a.type] || a.type,
                          amount: a.amount, delta: round6(delta), pending: !!a.pending });
      }
      const flags = [];
      if (adjDetails.length > 0) {
        if (value < -EPS) {
          flags.push({ code: "OUT_OF_BOUNDS",
            message: "调整后账面价值为负（" + round2(value) + "）" });
          outOfBounds = true;
        } else if (value > cost + EPS && !adjDetails.some(d => d.type === "revaluation")) {
          flags.push({ code: "OUT_OF_BOUNDS",
            message: "调整后账面价值超过投入成本（" + round2(value) + "）" });
          outOfBounds = true;
        }
      }
      // 当期折旧：剩余期间直线法，不低于残值
      let dep = 0;
      if (value > salvage + EPS) dep = (value - salvage) / remaining;
      value -= dep;
      if (value < salvage - EPS && dep > 0) value = salvage; // 数值兜底
      periods.push({
        time, openValue: round6(openValue), adjDelta: round6(adjDelta),
        dep: round6(dep), closeValue: round6(value),
        adjDetails, flags,
        conflict: here.length >= 2,
        pending: here.some(a => a.pending),
      });
    }
    if (outOfBounds)
      issues.push({ code: "OUT_OF_BOUNDS",
        message: "存在导致账面价值越界（<0 或 >成本）的调整" });
    // 处置损益
    let disposal = null;
    if (dispIdx !== null && dispIdx >= startIdx && dispIdx <= endIdx) {
      const proceeds = isNum(asset.disposalProceeds) ? asset.disposalProceeds : null;
      const bookValue = periods.length ? periods[periods.length - 1].closeValue : cost;
      disposal = {
        time: asset.disposalTime, proceeds, bookValue,
        gainLoss: proceeds === null ? null : round6(proceeds - bookValue),
      };
      if (proceeds === null)
        issues.push({ code: "MISSING_PROCEEDS",
          message: "已设定处置时刻但缺少处置收入，无法计算处置损益" });
    }
    const hasConflicts = conflicts.length > 0;
    const hasPending = adjustments.some(a => a.pending && !a.excluded);
    const trustworthy = !outOfBounds && !hasConflicts &&
      !issues.some(i => i.code === "SALVAGE_GT_COST" || i.code === "MISSING_PROCEEDS");
    return {
      assetId: asset.id, ok: true, trustworthy, issues, conflicts, periods, disposal,
      hasConflicts, hasPending,
      finalValue: periods.length ? periods[periods.length - 1].closeValue : round6(cost),
    };
  }
  /* 整体重推：逐项独立推导。 */
  function computeAll(assets) {
    const out = {};
    for (const a of assets) out[a.id] = computeAsset(a);
    return out;
  }
  return { computeAsset, computeAll, parseYM, toYM, TYPE_LABEL };
});
