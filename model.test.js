const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("./model");

function asset(overrides = {}) {
  return Object.assign({
    id: "a1",
    name: "设备",
    cost: 100000,
    startYear: 2026,
    lifeYears: 5,
    salvageRate: 0.1
  }, overrides);
}

test("直线法按剩余年限折旧到预计残值", () => {
  const result = model.calculateAsset(asset(), [], 0.3);
  assert.equal(result.isValid, true);
  assert.equal(result.rows[0].depreciation, 18000);
  assert.equal(result.rows[0].endingBook, 82000);
  assert.equal(result.rows[4].endingBook, 10000);
  assert.equal(result.rows[4].depreciation, 18000);
});

test("年末调整成为新账面价值并影响后续年度", () => {
  const adjustments = [{ id: "j1", yearIndex: 2, amount: -20000 }];
  const result = model.calculateAsset(asset(), adjustments, 0.3);
  assert.equal(result.rows[1].preAdjustmentBook, 64000);
  assert.equal(result.rows[1].endingBook, 44000);
  assert.equal(result.rows[2].depreciation, (44000 - 10000) / 3);
  assert.equal(result.rows[4].endingBook, 10000);
});

test("撤销调整后轨迹完全恢复，其他年份调整保留", () => {
  const before = model.calculateAsset(asset(),
    [{ id: "j1", yearIndex: 2, amount: -20000 }, { id: "j2", yearIndex: 4, amount: 5000 }]);
  const after = model.calculateAsset(asset(),
    [{ id: "j2", yearIndex: 4, amount: 5000 }]);
  assert.equal(after.rows[1].endingBook, 64000);
  assert.equal(after.rows[3].endingBook, 33000);
  assert.equal(after.rows[3].adjustment, 5000);
  assert.notDeepEqual(before.rows, after.rows);
});

test("跌破警戒比例时标记首次触发年份和依据", () => {
  const result = model.calculateAsset(asset({ cost: 100000, salvageRate: 0.05 }), [], 0.3);
  assert.equal(result.firstWarningRow.yearIndex, 4);
  assert.equal(result.firstWarningRow.endingBook, 24000);
  assert.equal(result.firstWarningRow.cause, "scheduled");
  const adjusted = model.calculateAsset(asset(),
    [{ id: "j1", yearIndex: 1, amount: -60000 }], 0.3);
  assert.equal(adjusted.firstWarningRow.yearIndex, 1);
  assert.equal(adjusted.firstWarningRow.cause, "adjustment");
});

test("调整年份越界、残值率不合理和负账面价值都会被指出", () => {
  assert.equal(model.validateAsset(asset({ salvageRate: 1 }))[0].field, "salvageRate");
  const outOfRange = model.validateAsset(asset(), [{ id: "bad", yearIndex: 6, amount: -100 }]);
  assert.match(outOfRange[0].message, /超出/);
  const negative = model.validateAsset(asset(), [{ id: "bad", yearIndex: 1, amount: -90000 }]);
  assert.match(negative[0].message, /账面价值为负/);
});

test("汇总仅纳入有效资产，参数变化可独立重算", () => {
  const a = asset();
  const b = asset({ id: "b2", name: "车辆", cost: 50000, lifeYears: 4 });
  const bad = asset({ id: "bad", name: "错误设备", salvageRate: 1 });
  const summary = model.calculatePortfolio([a, b, bad], {
    a1: [],
    b2: [],
    bad: []
  }, 0.3);
  assert.equal(summary.validCount, 2);
  assert.equal(summary.invalidCount, 1);
  assert.equal(summary.totalInitialCost, 150000);
  const changedA = model.calculateAsset(asset({ cost: 120000 }), [], 0.3);
  const unchangedB = model.calculateAsset(b, [], 0.3);
  assert.equal(changedA.rows[0].endingBook, 98400);
  assert.equal(unchangedB.rows[0].endingBook, 38750);
});
