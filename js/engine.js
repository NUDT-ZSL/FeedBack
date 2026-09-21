/* 评分规则引擎：同时供浏览器与 Node 测试加载，不依赖 DOM。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ScoringEngine = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function round(value, digits) {
    if (!Number.isFinite(value)) return 0;
    const factor = Math.pow(10, digits || 0);
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toFiniteNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function rankLevel(value, bands) {
    if (!bands || bands.length === 0 || !Number.isFinite(value)) {
      return { grade: "未设置", min: null };
    }
    const sorted = bands.slice().sort((a, b) => b.min - a.min);
    const match = sorted.find((band) => value >= band.min);
    if (match) return { grade: match.grade, min: match.min };
    const lowest = sorted[sorted.length - 1];
    return { grade: "未达 " + lowest.grade, min: lowest.min };
  }

  function dimensionWeight(dims, id, weights) {
    const dimension = dims.find((item) => item.id === id);
    const value = toFiniteNumber(weights ? weights[id] : dimension && dimension.weight);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  function evaluate(scheme, rawScores) {
    const dims = scheme.dimensions || [];
    const weights = scheme.weights || {};
    const totalWeight = dims.reduce(
      (sum, dim) => sum + dimensionWeight(dims, dim.id, weights),
      0
    );
    const scored = dims.filter((dim) => {
      const raw = toFiniteNumber(rawScores[dim.id]);
      return raw !== null && dimensionWeight(dims, dim.id, weights) > 0;
    });
    const scoredWeight = scored.reduce(
      (sum, dim) => sum + dimensionWeight(dims, dim.id, weights),
      0
    );
    const scaledRawSum = scored.reduce((sum, dim) => {
      const maxScore = dim.maxScore || 100;
      const scaled = Number(rawScores[dim.id]) / maxScore * 100;
      return sum + scaled * dimensionWeight(dims, dim.id, weights);
    }, 0);
    const scoredAverage = scoredWeight > 0 ? scaledRawSum / scoredWeight : 0;

    const preliminary = dims.map((dim) => {
      const weight = dimensionWeight(dims, dim.id, weights);
      const rawInput = rawScores ? rawScores[dim.id] : null;
      const raw = toFiniteNumber(rawInput);
      const missing = raw === null;
      const normalizedRaw = raw === null
        ? null
        : raw / (dim.maxScore || 100) * 100;
      let effectiveRaw = normalizedRaw;
      let included = !missing;
      let imputed = false;
      if (missing) {
        imputed = true;
        if (dim.missingPolicy === "zero") {
          effectiveRaw = 0;
          included = true;
        } else if (dim.missingPolicy === "full") {
          effectiveRaw = 100;
          included = true;
        } else if (dim.missingPolicy === "average") {
          effectiveRaw = scoredAverage;
          included = true;
        } else {
          effectiveRaw = null;
          included = false;
        }
      }
      return { dim, weight, raw, missing, imputed, effectiveRaw, included };
    });

    const includedWeight = preliminary.reduce(
      (sum, item) => sum + (item.included ? item.weight : 0),
      0
    );
    const weightedSum = preliminary.reduce((sum, item) => {
      if (!item.included || item.weight === 0) return sum;
        return sum + (item.effectiveRaw / 100) * item.weight;
    }, 0);
    const total = includedWeight > 0 ? (weightedSum / includedWeight) * 100 : null;
    const entries = preliminary.map((item) => {
      const weightedPoints =
        item.included && item.weight > 0
          ? (item.effectiveRaw / 100) * item.weight
          : 0;
      const contribution =
        item.included && includedWeight > 0
          ? (weightedPoints / includedWeight) * 100
          : 0;
      const delta =
        item.included && includedWeight > 0
          ? ((item.effectiveRaw - total) * item.weight) / includedWeight
          : 0;
      const level = rankLevel(item.effectiveRaw, item.dim.levels);
      return Object.assign({}, item, {
        id: item.dim.id,
        name: item.dim.name,
        maxScore: item.dim.maxScore || 100,
        missingPolicy: item.dim.missingPolicy || "prorate",
        weightedPoints,
        contribution,
        delta,
        scale: 100 / (item.dim.maxScore || 100),
        level
      });
    });

    entries.forEach((entry) => {
      if (!entry.missing || entry.missingPolicy === "prorate" || !entry.included) {
        entry.missingImpact = 0;
        return;
      }
      const otherWeight = includedWeight - entry.weight;
      if (otherWeight <= 0) {
        entry.missingImpact = null;
      } else {
        const otherWeighted =
          weightedSum - (entry.effectiveRaw / 100) * entry.weight;
        const counterfactual = (otherWeighted / otherWeight) * 100;
        entry.missingImpact = total - counterfactual;
      }
    });

    const overall = total === null ? null : rankLevel(total, scheme.overallBands);
    const sortedBands = (scheme.overallBands || [])
      .slice()
      .sort((a, b) => b.min - a.min);
    const overallIndex = overall
      ? sortedBands.findIndex((band) => band.grade === overall.grade)
      : -1;
    const nextBand = overallIndex > 0 ? sortedBands[overallIndex - 1] : null;

    const blockers = !nextBand
      ? []
      : entries
          .filter((entry) => entry.included && entry.weight > 0)
          .map((entry) => {
            const gap = Math.max(0, nextBand.min - entry.effectiveRaw);
            const potentialGain = (gap * entry.weight) / includedWeight;
            return {
              id: entry.id,
              name: entry.name,
              level: entry.level.grade,
              effectiveRaw: entry.effectiveRaw,
              gap,
              rawGap: gap / (100 / (entry.maxScore || 100)),
              potentialGain,
              missing: entry.missing,
              imputed: entry.imputed,
              canCrossAlone:
                gap > 0 && potentialGain >= nextBand.min - total - 0.000001
            };
          })
          .filter((item) => item.gap > 0)
          .sort((a, b) => b.potentialGain - a.potentialGain);

    const formulaTerms = entries
      .filter((entry) => entry.included && entry.weight > 0)
      .map((entry) => {
        const source = entry.imputed ? "缺省估分" : "原始分";
        return `${entry.name} ${round(entry.effectiveRaw, 1)}（${source}，原始满分${entry.maxScore}）× ${entry.weight}%`;
      });

    return {
      total,
      overallGrade: overall ? overall.grade : "未评级",
      overallMin: overall ? overall.min : null,
      nextGrade: nextBand ? nextBand.grade : null,
      nextMin: nextBand ? nextBand.min : null,
      totalWeight,
      includedWeight,
      scoredWeight,
      coverage: totalWeight > 0 ? scoredWeight / totalWeight : 0,
      entries,
      highs: entries
        .filter((entry) => entry.delta > 0.05)
        .sort((a, b) => b.delta - a.delta),
      lows: entries
        .filter((entry) => entry.delta < -0.05)
        .sort((a, b) => a.delta - b.delta),
      blockers,
      formulaTerms,
      calculatedAt: new Date().toISOString()
    };
  }

  return { round, clamp, toFiniteNumber, rankLevel, evaluate };
});
