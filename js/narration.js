/* 将评分结果转换成教练可核对、可留存的中文评价依据。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      typeof require === "function" ? require("./engine.js") : root.ScoringEngine
    );
  } else {
    root.ScoringNarration = factory(root.ScoringEngine);
  }
})(typeof self !== "undefined" ? self : this, function (engine) {
  "use strict";

  const fmt = (value, digits = 1) =>
    value === null || value === undefined || !Number.isFinite(value)
      ? "—"
      : engine.round(value, digits).toFixed(digits);

  function describeEntry(entry) {
    const sign = entry.delta >= 0 ? "+" : "";
    const rawText = entry.imputed
      ? `缺分代用 ${fmt(entry.effectiveRaw)}（百分制）`
      : `原始分 ${fmt(entry.raw)} / ${entry.maxScore}，折合 ${fmt(entry.effectiveRaw)}`;
    return `${entry.name}：等级「${entry.level.grade}」、${rawText}、` +
      `权重 ${entry.weight}%、贡献 ${fmt(entry.contribution)} 分（对总分${sign}${fmt(entry.delta)}）`;
  }

  function buildNarration(result, scheme) {
    if (result.total === null) {
      return {
        headline: "暂无法计算总分",
        lines: ["当前没有任何计入总分的已评分维度，请先补分或调整缺省策略。"]
      };
    }

    const lines = [];
    const termText = result.formulaTerms.join("；");
    lines.push(
      `总分 ${fmt(result.total)} 分，总评「${result.overallGrade}」（当前等级阈值 ${fmt(result.overallMin, 0)} 分）。`
    );
    lines.push(
      `计算式：（${termText}）÷ 计入权重 ${fmt(result.includedWeight, 0)}%；` +
      `方案总权重 ${fmt(result.totalWeight, 0)}%，已有分数覆盖 ${fmt(result.coverage * 100, 0)}%。`
    );

    if (result.highs.length) {
      const top = result.highs[0];
      lines.push(
        `主要拉高项是${result.highs.slice(0, 2).map((item) => item.name + "（" + fmt(item.delta) + "）").join("、")}，` +
        `其中「${top.name}」有效分 ${fmt(top.effectiveRaw)}。`
      );
    }
    if (result.lows.length) {
      const bottom = result.lows[0];
      lines.push(
        `主要拉低项是${result.lows.slice(0, 2).map((item) => item.name + "（" + fmt(item.delta) + "）").join("、")}，` +
        `其中「${bottom.name}」当前为「${bottom.level.grade}」。`
      );
    }

    const alone = result.blockers.filter((item) => item.canCrossAlone);
    if (alone.length) {
      lines.push(
        "触发降级的关键维度：" + alone.map((item) => {
          const missingText = item.missing ? "该维度缺分，补齐后" : "该项提升后";
          return `「${item.name}」按该维度 ${item.maxScore} 分制还差 ${fmt(item.rawGap)} 分（折合百分制 ${fmt(item.gap)} 分），${missingText}可使总分跨过「${result.nextGrade}」边界`;
        }).join("；") + "。"
      );
    } else if (result.nextGrade) {
      const topBlocker = result.blockers[0];
      lines.push(
        topBlocker
          ? `距「${result.nextGrade}」还差 ${fmt(result.nextMin - result.total)} 分；` +
            `差距最集中的维度是「${topBlocker.name}」，按该维度分制需补 ${fmt(topBlocker.rawGap)} 分，折合后最多可贡献 ${fmt(topBlocker.potentialGain)} 分，需多项协同提升。`
          : `所有计入维度均已达到「${result.nextGrade}」阈值。`
      );
    } else {
      lines.push("当前已位于最高总评等级，没有更高等级边界。");
    }

    const missing = result.entries.filter((entry) => entry.missing);
    if (missing.length) {
      missing.forEach((entry) => {
        if (entry.missingPolicy === "prorate") {
          lines.push(
            `缺分标记：「${entry.name}」按方案采用重新分摊，已从分母剔除 ${entry.weight}% 权重；` +
            `当前用其余 ${fmt(result.includedWeight, 0)}% 权重计分，补分后总分将随该维度表现变化。`
          );
        } else {
          const action = entry.missingPolicy === "zero" ? "按 0 分计入" :
            entry.missingPolicy === "full" ? "按满分 100 计入" : "按其他已评项均分计入";
          const impactText = entry.missingImpact === null
            ? "当前没有其他已评分项可对照"
            : `相对“剔除该维度并分摊”的算法影响${entry.missingImpact >= 0 ? "+" : ""}${fmt(entry.missingImpact)} 分`;
          lines.push(
            `缺分标记：「${entry.name}」${action}，有效分 ${fmt(entry.effectiveRaw)}、贡献 ${fmt(entry.contribution)} 分；${impactText}。`
          );
        }
      });
    }

    const detail = result.entries.map(describeEntry);
    return {
      headline: `${fmt(result.total)} 分 · ${result.overallGrade}`,
      lines,
      detail,
      schemeName: scheme.name
    };
  }

  function compareOutcomes(before, after) {
    if (!before || !after || before.overallGrade === after.overallGrade) return null;
    const upward = after.total > before.total;
    return {
      changed: true,
      upward,
      text: `权重调整触发等级变化：${before.overallGrade}（${engine.round(before.total, 1)} 分）→ ${after.overallGrade}（${engine.round(after.total, 1)} 分）`,
      before,
      after
    };
  }

  return { buildNarration, compareOutcomes, formatScore: fmt };
});
