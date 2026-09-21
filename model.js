/* 长期资产直线折旧与价值调整模型（浏览器和 Node 共用） */
(function (root) {
  const DEFAULT_WARNING_RATIO = 0.3;

  function uid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
  }

  function finiteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function addError(errors, field, message, ref) {
    errors.push(Object.assign({ field, message }, ref || {}));
  }

  function validateWarningRatio(value) {
    const ratio = Number(value);
    if (!finiteNumber(ratio) || ratio < 0 || ratio > 1) {
      return "警戒比例必须是 0% 到 100% 之间的数字。";
    }
    return null;
  }

  function validateAsset(asset, adjustments) {
    const errors = [];
    adjustments = adjustments || [];
    asset = asset || {};

    if (!asset.name || !String(asset.name).trim()) {
      addError(errors, "name", "资产名称不能为空。");
    }
    if (!finiteNumber(asset.cost) || asset.cost <= 0) {
      addError(errors, "cost", "初始投入必须大于 0。");
    }
    if (!Number.isInteger(asset.startYear) || asset.startYear < 1900 || asset.startYear > 2200) {
      addError(errors, "startYear", "启用年份必须是 1900 到 2200 之间的整数。");
    }
    if (!Number.isInteger(asset.lifeYears) || asset.lifeYears < 1 || asset.lifeYears > 100) {
      addError(errors, "lifeYears", "预计使用年限必须是 1 到 100 之间的整数年。");
    }
    if (!finiteNumber(asset.salvageRate) || asset.salvageRate < 0 || asset.salvageRate >= 1) {
      addError(errors, "salvageRate", "残值率必须大于等于 0% 且小于 100%。");
    }

    const coreValid = errors.length === 0;
    const usedYears = new Map();
    adjustments.forEach(function (adj, index) {
      const ref = { adjustmentId: adj.id, adjustmentIndex: index };
      if (!Number.isInteger(adj.yearIndex)) {
        addError(errors, "adjustments", "价值调整年份必须是整数年。", ref);
        return;
      }
      if (coreValid && (adj.yearIndex < 1 || adj.yearIndex > asset.lifeYears)) {
        addError(errors, "adjustments",
          "调整发生在第 " + adj.yearIndex + " 年，超出 1 到 " + asset.lifeYears + " 年的使用周期。", ref);
      }
      if (usedYears.has(adj.yearIndex)) {
        addError(errors, "adjustments", "同一年只能保留一条价值调整；请撤销后再修改。", ref);
      }
      usedYears.set(adj.yearIndex, true);
      if (!finiteNumber(adj.amount) || adj.amount === 0) {
        addError(errors, "adjustments", "价值调整金额必须是非零数字。", ref);
      }
    });

    if (coreValid) {
      const trialRows = simulateRows(asset, adjustments, DEFAULT_WARNING_RATIO);
      trialRows.forEach(function (row) {
        if (row.endingBook < 0) {
          const adj = adjustments.find(item => item.yearIndex === row.yearIndex);
          addError(errors, "adjustments",
            "第 " + row.yearIndex + " 年末调整后账面价值为负，调整金额不能低于调整前账面价值。",
            { adjustmentId: adj && adj.id });
        }
      });
    }
    return errors;
  }

  function simulateRows(asset, adjustments, warningRatio) {
    const byYear = new Map();
    adjustments.forEach(adj => byYear.set(adj.yearIndex, adj));
    const salvageValue = asset.cost * asset.salvageRate;
    let beginning = asset.cost;
    const rows = [];
    for (let yearIndex = 1; yearIndex <= asset.lifeYears; yearIndex += 1) {
      const remaining = asset.lifeYears - yearIndex + 1;
      const depreciation = beginning > salvageValue ? (beginning - salvageValue) / remaining : 0;
      const preAdjustment = beginning - depreciation;
      const adj = byYear.get(yearIndex);
      const ending = preAdjustment + (adj ? adj.amount : 0);
      rows.push({
        yearIndex,
        calendarYear: asset.startYear + yearIndex - 1,
        beginningBook: beginning,
        depreciation,
        preAdjustmentBook: preAdjustment,
        adjustment: adj ? adj.amount : 0,
        adjustmentId: adj ? adj.id : null,
        endingBook: ending,
        bookRatio: ending / asset.cost,
        thresholdValue: asset.cost * warningRatio,
        warning: ending < asset.cost * warningRatio,
        firstWarning: false,
        cause: ending < asset.cost * warningRatio
          ? (preAdjustment >= asset.cost * warningRatio ? "adjustment" : "scheduled")
          : null
      });
      beginning = ending;
    }
    return rows;
  }

  function calculateAsset(asset, adjustments, warningRatio) {
    adjustments = adjustments || [];
    warningRatio = finiteNumber(Number(warningRatio)) ? Number(warningRatio) : DEFAULT_WARNING_RATIO;
    const errors = validateAsset(asset, adjustments);
    const result = {
      id: asset.id,
      isValid: errors.length === 0,
      errors,
      rows: [],
      firstWarningRow: null,
      salvageValue: 0,
      finalBookValue: 0,
      lowestRatio: null
    };
    if (errors.length) return result;

    const rows = simulateRows(asset, adjustments, warningRatio);
    const firstWarningRow = rows.find(row => row.warning);
    if (firstWarningRow) firstWarningRow.firstWarning = true;
    result.rows = rows;

    result.salvageValue = asset.cost * asset.salvageRate;
    result.finalBookValue = rows[rows.length - 1].endingBook;
    result.lowestRatio = Math.min.apply(null, result.rows.map(row => row.bookRatio));
    result.firstWarningRow = firstWarningRow;
    return result;
  }

  function calculatePortfolio(assets, adjustmentsByAssetId, warningRatio) {
    const results = assets.map(asset =>
      calculateAsset(asset, adjustmentsByAssetId[asset.id] || [], warningRatio));
    const validResults = results.filter(result => result.isValid);
    const validAssets = assets.filter(asset =>
      validResults.some(result => result.id === asset.id));
    const timeline = [];
    if (validAssets.length) {
      const firstYear = Math.min.apply(null, validAssets.map(asset => asset.startYear));
      const lastYear = Math.max.apply(null,
        validAssets.map(asset => asset.startYear + asset.lifeYears - 1));
      for (let year = firstYear; year <= lastYear; year += 1) {
        let endingBook = 0;
        let includedCount = 0;
        validResults.forEach(result => {
          const availableRows = result.rows.filter(item => item.calendarYear <= year);
          const latestRow = availableRows[availableRows.length - 1];
          if (latestRow) {
            endingBook += latestRow.endingBook;
            includedCount += 1;
          }
        });
        if (includedCount) timeline.push({ year, endingBook, includedCount });
      }
    }
    return {
      results,
      timeline,
      validCount: validResults.length,
      invalidCount: results.length - validResults.length,
      totalInitialCost: validAssets.reduce((sum, asset) => sum + asset.cost, 0),
      totalCurrentValue: timeline.length ? timeline[timeline.length - 1].endingBook : 0
    };
  }

  const api = {
    DEFAULT_WARNING_RATIO,
    uid,
    validateAsset,
    validateWarningRatio,
    calculateAsset,
    calculatePortfolio
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.AssetModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
