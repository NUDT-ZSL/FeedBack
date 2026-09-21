/* 方案维护、默认数据与权重一致性工具。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ScoringSchema = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MISSING_POLICIES = [
    { id: "prorate", name: "按已评分项重新分摊", hint: "该维度不计入分母，其余维度权重等比补足" },
    { id: "zero", name: "按 0 分处理", hint: "缺项明确计入总分，通常会明显拉低结果" },
    { id: "full", name: "按满分处理", hint: "缺项不扣分，适合该项由系统自动豁免" },
    { id: "average", name: "按其他已评均分", hint: "用已评分维度的加权平均分临时补齐" }
  ];

  function createId(prefix) {
    return prefix + "-" + Date.now().toString(36) + "-" +
      Math.random().toString(36).slice(2, 7);
  }

  function allocateIntegerWeights(previous, changedId, desiredValue) {
    const ids = Object.keys(previous);
    const desired = Math.max(0, Math.min(100, Math.round(Number(desiredValue) || 0)));
    const others = ids.filter((id) => id !== changedId);
    if (others.length === 0) return { [changedId]: 100 };
    const remaining = 100 - desired;
    if (remaining === 0) {
      return Object.assign({}, previous, Object.fromEntries(
        ids.map((id) => [id, id === changedId ? 100 : 0])
      ));
    }
    const otherTotal = others.reduce((sum, id) => sum + Math.max(0, previous[id] || 0), 0);
    const shares = otherTotal > 0
      ? others.map((id) => Math.max(0, previous[id] || 0) / otherTotal)
      : others.map(() => 1 / others.length);
    const exact = shares.map((share) => remaining * share);
    const floored = exact.map((value) => Math.floor(value));
    let leftover = remaining - floored.reduce((sum, value) => sum + value, 0);
    const order = exact
      .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
      .sort((a, b) => b.fraction - a.fraction);
    order.forEach((item, rank) => {
      if (rank < leftover) floored[item.index] += 1;
    });
    const result = Object.assign({}, previous, { [changedId]: desired });
    others.forEach((id, index) => { result[id] = floored[index]; });
    return result;
  }

  function validateBands(bands, label, errors) {
    if (!Array.isArray(bands) || bands.length < 2) {
      errors.push(label + "至少需要两个等级");
      return;
    }
    const mins = bands.map((band) => Number(band.min));
    if (mins.some((min) => !Number.isFinite(min) || min < 0 || min > 100)) {
      errors.push(label + "的阈值必须在 0–100 之间");
    }
    if (new Set(mins).size !== mins.length) errors.push(label + "阈值不能重复");
    if (!mins.some((min) => min === 0)) errors.push(label + "建议包含 0 分基础等级");
  }

  function validateScheme(scheme) {
    const errors = [];
    if (!scheme || !Array.isArray(scheme.dimensions) || scheme.dimensions.length === 0) {
      errors.push("方案至少需要一个评分维度");
      return { valid: false, errors };
    }
    const weightSum = scheme.dimensions.reduce((sum, dim) => {
      return sum + (Number(scheme.weights[dim.id]) || 0);
    }, 0);
    if (weightSum !== 100) errors.push("当前权重合计为 " + weightSum + "%，必须等于 100%");
    scheme.dimensions.forEach((dim) => {
      if (!dim.name || !dim.name.trim()) errors.push("存在未命名维度");
      if (!MISSING_POLICIES.some((item) => item.id === dim.missingPolicy)) {
        errors.push((dim.name || "维度") + "的缺省策略无效");
      }
      validateBands(dim.levels, (dim.name || "维度") + "等级", errors);
    });
    validateBands(scheme.overallBands, "总评等级", errors);
    return { valid: errors.length === 0, errors };
  }

  function defaultLevels() {
    return [
      { grade: "优秀", min: 90 },
      { grade: "良好", min: 75 },
      { grade: "合格", min: 60 },
      { grade: "待改进", min: 0 }
    ];
  }

  function defaultScheme() {
    const dimensions = [
      { id: "d-communication", name: "沟通表达", weight: 25, maxScore: 100, missingPolicy: "prorate", levels: defaultLevels() },
      { id: "d-practice", name: "实操完成度", weight: 30, maxScore: 100, missingPolicy: "zero", levels: defaultLevels() },
      { id: "d-analysis", name: "问题分析", weight: 20, maxScore: 100, missingPolicy: "average", levels: defaultLevels() },
      { id: "d-collab", name: "协作反馈", weight: 15, maxScore: 100, missingPolicy: "prorate", levels: defaultLevels() },
      { id: "d-safety", name: "安全规范", weight: 10, maxScore: 100, missingPolicy: "full", levels: defaultLevels() }
    ];
    return {
      version: 1,
      name: "技能训练营通用评分方案",
      overallBands: [
        { grade: "卓越", min: 90 },
        { grade: "熟练", min: 80 },
        { grade: "合格", min: 60 },
        { grade: "需复训", min: 0 }
      ],
      dimensions,
      weights: Object.fromEntries(dimensions.map((dim) => [dim.id, dim.weight]))
    };
  }

  function defaultStudents() {
    return [
      { id: "s-lin", name: "林一诺", team: "先锋班 A 组", scores: { "d-communication": 88, "d-practice": 82, "d-analysis": 76, "d-collab": 91 } },
      { id: "s-chen", name: "陈墨", team: "先锋班 A 组", scores: { "d-communication": 72, "d-practice": 64, "d-analysis": 69, "d-collab": 75, "d-safety": 58 } },
      { id: "s-zhao", name: "赵晓彤", team: "先锋班 B 组", scores: { "d-practice": 94, "d-analysis": 89, "d-collab": 86, "d-safety": 92 } }
    ];
  }

  return {
    MISSING_POLICIES,
    createId,
    allocateIntegerWeights,
    validateBands,
    validateScheme,
    defaultLevels,
    defaultScheme,
    defaultStudents
  };
});
