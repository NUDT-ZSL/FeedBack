/*
 * 长期资产直线折旧与价值调整计算核心。
 * 浏览器与 Node 共用本文件，界面状态变化时只重算被修改的资产。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AssetWorkbench = factory();
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const MAX_LIFE_YEARS = 100;

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function activeAdjustments(asset) {
    return Array.isArray(asset.adjustments)
      ? asset.adjustments.filter((item) => item && item.revoked !== true)
      : [];
  }

  function addError(errors, code, field, message, extra) {
    errors.push(Object.assign({ code, field, message }, extra || {}));
  }

  function displayName(asset) {
    return String(asset.name || '').trim() || `资产 ${asset.id || ''}`;
  }

  function validateBaseAsset(asset) {
    const errors = [];
    if (!asset || typeof asset !== 'object') {
      addError(errors, 'ASSET_INVALID', 'asset', '资产数据格式不正确。');
      return errors;
    }

    if (!isFiniteNumber(asset.initialCost) || asset.initialCost <= 0) {
      addError(errors, 'INITIAL_COST_INVALID', 'initialCost', '初始投入必须为大于 0 的数字。');
    }

    if (!Number.isSafeInteger(asset.startYear)) {
      addError(errors, 'START_YEAR_INVALID', 'startYear', '启用年份必须为整数年份。');
    }

    if (!Number.isSafeInteger(asset.lifeYears) || asset.lifeYears < 1 || asset.lifeYears > MAX_LIFE_YEARS) {
      addError(errors, 'LIFE_YEARS_INVALID', 'lifeYears', `预计使用年限必须为 1 至 ${MAX_LIFE_YEARS} 年的整数。`);
    }

    if (!isFiniteNumber(asset.residualRate) || asset.residualRate < 0 || asset.residualRate > 1) {
      addError(errors, 'RESIDUAL_RATE_INVALID', 'residualRate', '残值率必须介于 0% 与 100% 之间。');
    }

    if (Array.isArray(asset.adjustments)) {
      asset.adjustments.forEach((item) => {
        if (!item || item.revoked === true) return;
        if (!isFiniteNumber(item.amount) || item.amount === 0) {
          addError(errors, 'ADJUSTMENT_AMOUNT_INVALID', 'adjustmentAmount',
            `第 ${item.lifeYear || '?'} 年的价值调整必须为非零金额（正数为增值，负数为减值）。`,
            { adjustmentId: item.id, lifeYear: item.lifeYear });
        }
        if (!Number.isSafeInteger(item.lifeYear) ||
            !Number.isSafeInteger(asset.lifeYears) ||
            item.lifeYear < 1 || item.lifeYear > asset.lifeYears) {
          addError(errors, 'ADJUSTMENT_YEAR_OUT_OF_RANGE', 'adjustmentYear',
            `价值调整年份必须位于第 1 年至第 ${asset.lifeYears || '?'} 年之间。`,
            { adjustmentId: item.id, lifeYear: item.lifeYear });
        }
      });
    } else {
      addError(errors, 'ADJUSTMENTS_INVALID', 'adjustments', '价值调整记录格式不正确。');
    }

    return errors;
  }

  function validateSettings(settings) {
    const warnings = [];
    const ratio = settings && settings.warningRatio;
    if (!isFiniteNumber(ratio) || ratio < 0 || ratio > 1) {
      warnings.push({
        code: 'WARNING_RATIO_INVALID',
        field: 'warningRatio',
        message: '警戒比例必须介于 0% 与 100% 之间，已暂时使用 20%。'
      });
    }
    return warnings;
  }

  function money(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  function calculateAsset(asset, settings) {
    const errors = validateBaseAsset(asset);
    if (errors.length > 0) {
      return {
        id: asset && asset.id,
        name: asset ? displayName(asset) : '未知资产',
        valid: false,
        errors,
        rows: []
      };
    }

    const warningRatio = isFiniteNumber(settings && settings.warningRatio) &&
      settings.warningRatio >= 0 && settings.warningRatio <= 1
      ? settings.warningRatio
      : 0.2;
    const threshold = asset.initialCost * warningRatio;
    const salvage = asset.initialCost * asset.residualRate;
    const grouped = new Map();
    activeAdjustments(asset).forEach((item) => {
      const list = grouped.get(item.lifeYear) || [];
      list.push(item);
      grouped.set(item.lifeYear, list);
    });

    let opening = asset.initialCost;
    const rows = [];
    const sequentialErrors = [];

    for (let lifeYear = 1; lifeYear <= asset.lifeYears; lifeYear += 1) {
      const yearAdjustments = grouped.get(lifeYear) || [];
      const adjustmentAmount = yearAdjustments.reduce((sum, item) => sum + item.amount, 0);
      const adjustedOpening = opening + adjustmentAmount;
      if (adjustedOpening < salvage) {
        sequentialErrors.push({
          code: 'ADJUSTMENT_BELOW_RESIDUAL',
          field: 'adjustmentAmount',
          message: `第 ${lifeYear} 年调整后账面价值 ${money(adjustedOpening)} 元低于残值 ${money(salvage)} 元。`,
          lifeYear,
          adjustmentIds: yearAdjustments.map((item) => item.id)
        });
      }

      const remainingYears = asset.lifeYears - lifeYear + 1;
      const depreciation = lifeYear === asset.lifeYears
        ? adjustedOpening - salvage
        : (adjustedOpening - salvage) / remainingYears;
      const closing = adjustedOpening - depreciation;
      rows.push({
        lifeYear,
        calendarYear: asset.startYear + lifeYear - 1,
        opening: money(opening),
        adjustmentAmount: money(adjustmentAmount),
        adjustments: yearAdjustments.map((item) => ({
          id: item.id,
          amount: item.amount,
          note: item.note || ''
        })),
        adjustedOpening: money(adjustedOpening),
        depreciation: money(depreciation),
        closing: money(closing),
        threshold: money(threshold),
        warning: closing < threshold,
        warningReason: closing < threshold
          ? `年末账面价值 ${money(closing)} 元，占初始投入 ${(closing / asset.initialCost * 100).toFixed(2)}%，低于警戒比例 ${(warningRatio * 100).toFixed(2)}%（警戒线 ${money(threshold)} 元）。`
          : ''
      });
      opening = closing;
    }

    if (sequentialErrors.length > 0) {
      return {
        id: asset.id,
        name: displayName(asset),
        valid: false,
        errors: sequentialErrors,
        rows: []
      };
    }

    const warningRows = rows.filter((row) => row.warning);
    return {
      id: asset.id,
      name: displayName(asset),
      valid: true,
      errors: [],
      salvage: money(salvage),
      threshold: money(threshold),
      warningRatio,
      firstWarningYear: warningRows.length > 0 ? warningRows[0].calendarYear : null,
      warningCount: warningRows.length,
      endYear: asset.startYear + asset.lifeYears - 1,
      rows
    };
  }

  function calculateAll(assets, settings) {
    const settingWarnings = validateSettings(settings || {});
    const effectiveSettings = settingWarnings.length > 0
      ? Object.assign({}, settings, { warningRatio: 0.2 })
      : settings;
    const results = (Array.isArray(assets) ? assets : []).map((asset) =>
      calculateAsset(asset, effectiveSettings));
    const validResults = results.filter((result) => result.valid);
    const invalidResults = results.filter((result) => !result.valid);
    const years = [];

    if (validResults.length > 0) {
      const minYear = Math.min(...validResults.map((item) => item.rows[0].calendarYear));
      const maxYear = Math.max(...validResults.map((item) => item.endYear));
      for (let calendarYear = minYear; calendarYear <= maxYear; calendarYear += 1) {
        let totalBookValue = 0;
        validResults.forEach((result) => {
          const source = (assets.find((asset) => asset.id === result.id));
          if (calendarYear < source.startYear) return;
          const row = result.rows.find((item) => item.calendarYear === calendarYear);
          totalBookValue += row ? row.closing : result.salvage;
        });
        years.push({ calendarYear, totalBookValue: money(totalBookValue) });
      }
    }

    return {
      settingsWarnings: settingWarnings,
      results,
      validResults,
      invalidResults,
      years,
      validAssetCount: validResults.length,
      excludedAssetCount: invalidResults.length
    };
  }

  return {
    MAX_LIFE_YEARS,
    validateBaseAsset,
    validateSettings,
    calculateAsset,
    calculateAll,
    money
  };
});
