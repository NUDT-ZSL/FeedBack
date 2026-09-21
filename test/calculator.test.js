const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateAll, calculateAsset } = require('../src/calculator.js');

const settings = { warningRatio: 0.2 };

test('straight-line asset reaches residual value at the final year', () => {
  const result = calculateAsset({
    id: 'a',
    name: 'A',
    initialCost: 100000,
    startYear: 2026,
    lifeYears: 5,
    residualRate: 0.1,
    adjustments: []
  }, settings);

  assert.equal(result.valid, true);
  assert.equal(result.rows[0].depreciation, 18000);
  assert.equal(result.rows[0].closing, 82000);
  assert.equal(result.rows.at(-1).closing, 10000);
});

test('an adjustment changes only that asset and subsequent trajectory', () => {
  const unaffected = {
    id: 'stable',
    name: '不受影响资产',
    initialCost: 50000,
    startYear: 2026,
    lifeYears: 5,
    residualRate: 0,
    adjustments: []
  };
  const adjustable = {
    id: 'adjusted',
    name: '调整资产',
    initialCost: 100000,
    startYear: 2026,
    lifeYears: 5,
    residualRate: 0,
    adjustments: []
  };
  const before = calculateAll([unaffected, adjustable], settings);

  adjustable.adjustments.push({ id: 'x', lifeYear: 2, amount: -20000, revoked: false });
  const after = calculateAll([unaffected, adjustable], settings);

  const beforeStable = before.results.find((item) => item.id === 'stable');
  const afterStable = after.results.find((item) => item.id === 'stable');
  assert.deepEqual(beforeStable.rows, afterStable.rows);
  const changed = after.results.find((item) => item.id === 'adjusted');
  assert.equal(changed.rows[0].closing, 80000);
  assert.equal(changed.rows[1].adjustmentAmount, -20000);
  assert.equal(changed.rows[1].adjustedOpening, 60000);
  assert.equal(changed.rows[1].depreciation, 15000);
  assert.equal(changed.rows[1].closing, 45000);
});

test('revoking an adjustment restores the trajectory while keeping other years', () => {
  const asset = {
    id: 'a',
    name: 'A',
    initialCost: 100000,
    startYear: 2026,
    lifeYears: 4,
    residualRate: 0,
    adjustments: [
      { id: 'one', lifeYear: 2, amount: -20000, revoked: false },
      { id: 'two', lifeYear: 3, amount: 10000, revoked: false }
    ]
  };
  const withBoth = calculateAsset(asset, settings).rows;
  asset.adjustments[0].revoked = true;
  const afterRevocation = calculateAsset(asset, settings).rows;

  assert.equal(withBoth[1].adjustmentAmount, -20000);
  assert.equal(afterRevocation[1].adjustmentAmount, 0);
  assert.equal(afterRevocation[1].closing, 50000);
  assert.equal(afterRevocation[2].adjustmentAmount, 10000);
});

test('warning rows identify year, threshold and reason', () => {
  const result = calculateAsset({
    id: 'warn',
    name: 'Warning',
    initialCost: 100000,
    startYear: 2026,
    lifeYears: 10,
    residualRate: 0,
    adjustments: []
  }, { warningRatio: 0.25 });

  const firstWarning = result.rows.find((row) => row.warning);
  assert.equal(firstWarning.calendarYear, 2033);
  assert.equal(firstWarning.threshold, 25000);
  assert.match(firstWarning.warningReason, /低于警戒比例/);
});

test('invalid adjustment year and residual rate exclude only that asset', () => {
  const good = {
    id: 'good', name: 'Good', initialCost: 100, startYear: 2026,
    lifeYears: 2, residualRate: 0, adjustments: []
  };
  const bad = {
    id: 'bad', name: 'Bad', initialCost: 100, startYear: 2026,
    lifeYears: 2, residualRate: 1.2,
    adjustments: [{ id: 'bad-adj', lifeYear: 5, amount: -1, revoked: false }]
  };
  const analysis = calculateAll([good, bad], settings);

  assert.equal(analysis.validAssetCount, 1);
  assert.equal(analysis.excludedAssetCount, 1);
  assert.deepEqual(analysis.validResults.map((item) => item.id), ['good']);
  const badResult = analysis.invalidResults[0];
  assert.ok(badResult.errors.some((error) => error.code === 'RESIDUAL_RATE_INVALID'));
  assert.ok(badResult.errors.some((error) => error.code === 'ADJUSTMENT_YEAR_OUT_OF_RANGE'));
});

test('an adjustment that drives value below residual is rejected', () => {
  const result = calculateAsset({
    id: 'low', name: 'Low', initialCost: 100000, startYear: 2026,
    lifeYears: 5, residualRate: 0.1,
    adjustments: [{ id: 'x', lifeYear: 2, amount: -95000, revoked: false }]
  }, settings);

  assert.equal(result.valid, false);
  assert.equal(result.errors[0].code, 'ADJUSTMENT_BELOW_RESIDUAL');
});
