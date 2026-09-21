/* 评分引擎：纯逻辑，无 DOM 依赖，可在浏览器与 Node 中共用。 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ScoringEngine = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const MISSING_STRATEGIES = {
    zero: "缺分按 0 计",
    default: "缺分按缺省分计",
    exclude: "缺分剔除并重分配权重",
  };

  function defaultScheme() {
    return {
      name: "技能训练营评分方案",
      overallBands: [
        { min: 90, label: "A 优秀" },
        { min: 80, label: "B 良好" },
        { min: 70, label: "C 合格" },
        { min: 60, label: "D 待提升" },
        { min: 0, label: "E 不合格" },
      ],
      dimensions: [
        dim("tech", "技术能力", 30, 70),
        dim("comm", "沟通表达", 20, 70),
        dim("team", "团队协作", 20, 70),
        dim("deliver", "交付质量", 20, 70),
        dim("attitude", "学习态度", 10, 70),
      ],
    };
  }

  function dim(id, name, weight, defaultScore) {
    return {
      id,
      name,
      weight,
      maxScore: 100,
      defaultScore,
      missingStrategy: "default",
      bands: [
        { min: 90, label: "优秀" },
        { min: 75, label: "良好" },
        { min: 60, label: "合格" },
        { min: 0, label: "待提升" },
      ],
    };
  }

  function gradeFor(bands, value) {
    const sorted = [...bands].sort((a, b) => b.min - a.min);
    for (const b of sorted) if (value >= b.min) return b.label;
    return sorted[sorted.length - 1].label;
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  /**
   * 计算评分结果。scores: { [dimId]: number|null }，null/undefined/NaN 视为缺分。
   */
  function computeResult(scheme, scores) {
    scores = scores || {};
    const weightSum = scheme.dimensions.reduce((s, d) => s + d.weight, 0);
    const weightConsistent = Math.abs(weightSum - 100) < 1e-9;

    const dims = scheme.dimensions.map((d) => {
      const raw = scores[d.id];
      const missing = raw === null || raw === undefined || Number.isNaN(Number(raw));
      let excluded = false;
      let effectiveScore = null;
      if (missing) {
        if (d.missingStrategy === "exclude") excluded = true;
        else if (d.missingStrategy === "zero") effectiveScore = 0;
        else effectiveScore = d.defaultScore;
      } else {
        effectiveScore = Number(raw);
      }
      return { def: d, raw: missing ? null : Number(raw), missing, excluded, effectiveScore };
    });

    // 剔除缺分维度后，对剩余权重归一化，保证整体一致。
    const active = dims.filter((x) => !x.excluded);
    const activeWeightSum = active.reduce((s, x) => s + x.def.weight, 0);
    const results = dims.map((x) => {
      if (x.excluded) return buildDimResult(x, 0, 0, null);
      const effWeight = activeWeightSum > 0 ? (x.def.weight / activeWeightSum) * 100 : 0;
      const normalized = x.def.maxScore > 0 ? (x.effectiveScore / x.def.maxScore) * 100 : 0;
      const contribution = (normalized * effWeight) / 100;
      const r = buildDimResult(x, effWeight, contribution, normalized);
      r._preciseContribution = contribution; // 内部全精度，避免舍入累计误差
      return r;
    });

    const total = round2(results.reduce((s, r) => s + (r._preciseContribution || 0), 0));
    results.forEach((r) => delete r._preciseContribution);
    return {
      dimensions: results,
      total,
      grade: gradeFor(scheme.overallBands, total),
      weightSum: round2(weightSum),
      weightConsistent,
      excludedCount: dims.filter((x) => x.excluded).length,
    };
  }

  function buildDimResult(x, effWeight, contribution, normalized) {
    const d = x.def;
    return {
      id: d.id,
      name: d.name,
      raw: x.raw,
      missing: x.missing,
      excluded: x.excluded,
      strategy: x.missing ? d.missingStrategy : null,
      strategyLabel: x.missing ? MISSING_STRATEGIES[d.missingStrategy] : null,
      effectiveScore: x.excluded ? null : x.effectiveScore,
      normalized: normalized === null ? null : round2(normalized),
      weight: d.weight,
      effectiveWeight: round2(effWeight),
      contribution: round2(contribution),
      band: x.excluded ? null : gradeFor(d.bands, normalized),
      lowestBand: x.excluded ? false : gradeFor(d.bands, normalized) === lowestBandLabel(d.bands),
    };
  }

  function lowestBandLabel(bands) {
    return [...bands].sort((a, b) => b.min - a.min).slice(-1)[0].label;
  }

  /**
   * 生成评价依据：总分构成、拉高/拉低维度、降级触发维度、缺分影响。
   */
  function buildExplanation(scheme, result) {
    const lines = [];
    const active = result.dimensions.filter((d) => !d.excluded);
    lines.push(`总分 ${result.total} = 各维度（折算分 x 有效权重）之和，评定等级：${result.grade}。`);
    if (!result.weightConsistent) {
      lines.push(`注意：当前权重之和为 ${result.weightSum}，不为 100，计算时已按比例归一化。`);
    }

    // 与总分对比：折算分高于总分即拉高，低于总分即拉低。
    const raises = [];
    const lowers = [];
    for (const d of active) {
      const delta = round2(d.normalized - result.total);
      const entry = { id: d.id, name: d.name, contribution: d.contribution, delta };
      if (delta > 0.005) raises.push(entry);
      else if (delta < -0.005) lowers.push(entry);
    }
    raises.sort((a, b) => b.delta - a.delta);
    lowers.sort((a, b) => a.delta - b.delta);

    if (raises.length) {
      lines.push("拉高结果的维度：" + raises.map((d) => `${d.name}（折算分高于总分 ${d.delta} 分）`).join("、") + "。");
    }
    if (lowers.length) {
      lines.push("拉低结果的维度：" + lowers.map((d) => `${d.name}（折算分低于总分 ${-d.delta} 分）`).join("、") + "。");
    }

    const triggers = active.filter((d) => d.lowestBand);
    if (triggers.length) {
      lines.push("触发降级的关键维度：" + triggers.map((d) => `${d.name}（${d.band}，折算分 ${d.normalized}）`).join("、") + "。");
    }

    for (const d of result.dimensions) {
      if (d.excluded) {
        lines.push(`「${d.name}」缺分，按方案策略「${d.strategyLabel}」处理：该维度被剔除，其权重已分摊到其余维度。`);
      } else if (d.missing) {
        lines.push(`「${d.name}」缺分，按方案策略「${d.strategyLabel}」处理：以 ${d.effectiveScore} 分计入，贡献 ${d.contribution}。`);
      }
    }
    return { lines, raises, lowers, downgradeTriggers: triggers.map((d) => d.name) };
  }

  /** 对比两次结果，等级变化时返回描述，否则返回 null。 */
  function detectGradeChange(before, after) {
    if (!before || !after || before.grade === after.grade) return null;
    return {
      from: before.grade,
      to: after.grade,
      fromTotal: before.total,
      toTotal: after.total,
    };
  }

  return {
    MISSING_STRATEGIES,
    defaultScheme,
    gradeFor,
    computeResult,
    buildExplanation,
    detectGradeChange,
  };
});
