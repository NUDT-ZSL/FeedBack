const assert = require("node:assert/strict");
const test = require("node:test");
const engine = require("../js/engine.js");

const settings = {
  horizonDays: 7,
  distanceCostPerUnitKm: 0.6,
  timeCostPerUnitDay: 3
};

test("优先使用综合单位代价最低的路径完全消解缺口", () => {
  const result = engine.createPlan({
    settings,
    locations: [
      { id: "A", name: "A", stock: 120, inbound: 0, safety: 20, demand: 80 },
      { id: "B", name: "B", stock: 0, inbound: 0, safety: 0, demand: 20 }
    ],
    lanes: [
      { from: "A", to: "B", distanceKm: 100, unitFreight: 2, leadTimeDays: 1 }
    ]
  });
  assert.equal(result.summary.balanced, true);
  assert.equal(result.shipments[0].quantity, 20);
  assert.equal(result.shipments[0].totalCost, 20 * (2 + 60 + 3));
});

test("实际缺货优先于仅低于安全库存的地点", () => {
  const result = engine.createPlan({
    settings,
    locations: [
      { id: "S", name: "S", stock: 110, inbound: 0, safety: 0, demand: 100 },
      { id: "STOCKOUT", name: "实际缺货", stock: 0, inbound: 0, safety: 0, demand: 10 },
      { id: "SAFETY", name: "安全库存缺口", stock: 95, inbound: 0, safety: 20, demand: 100 }
    ],
    lanes: [
      { from: "S", to: "STOCKOUT", distanceKm: 1000, unitFreight: 100, leadTimeDays: 10 },
      { from: "S", to: "SAFETY", distanceKm: 1, unitFreight: 0, leadTimeDays: 0 }
    ]
  });
  assert.deepEqual(result.priorities.map((item) => item.id), ["STOCKOUT", "SAFETY"]);
  assert.equal(result.shipments[0].to, "STOCKOUT");
  assert.equal(result.summary.fulfilledGap, 10);
  assert.equal(result.summary.unresolvedGap, 25);
});

test("余量不足时明确报告未平衡缺口", () => {
  const result = engine.createPlan({
    settings,
    locations: [
      { id: "A", name: "A", stock: 105, inbound: 0, safety: 0, demand: 100 },
      { id: "B", name: "B", stock: 0, inbound: 0, safety: 0, demand: 20 }
    ],
    lanes: [{ from: "A", to: "B", distanceKm: 10, unitFreight: 1, leadTimeDays: 1 }]
  });
  assert.equal(result.summary.totalGap, 20);
  assert.equal(result.summary.fulfilledGap, 5);
  assert.equal(result.summary.unresolvedGap, 15);
  assert.match(result.warnings[0], /尚缺 15/);
});

test("缺少线路时与总量不足区分提示", () => {
  const result = engine.createPlan({
    settings,
    locations: [
      { id: "A", name: "A", stock: 200, inbound: 0, safety: 0, demand: 100 },
      { id: "B", name: "B", stock: 0, inbound: 0, safety: 0, demand: 10 }
    ],
    lanes: []
  });
  assert.equal(result.shipments.length, 0);
  assert.match(result.warnings[0], /连通性限制/);
  assert.match(result.warnings[1], /B 没有配置/);
});
