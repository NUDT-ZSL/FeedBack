const test = require("node:test");
const assert = require("node:assert");

global.window = global.window || {};
require("./js/core.js");
require("./js/pack.js");
require("./js/planner.js");

function smallData() {
  return {
    containers: [
      { id:"B", name:"箱", l:100, w:100, h:100, maxWeight:1000, count:1 }
    ],
    cargos: [
      { id:"A", name:"甲", l:50, w:50, h:50, weight:10, loadCapacity:100, stackable:true, rotatable:true, flippable:true },
      { id:"D", name:"丁", l:40, w:40, h:40, weight:20, loadCapacity:0, stackable:false, rotatable:true, flippable:false }
    ],
    relations: [],
    supportRatio:0.9
  };
}

test("可在单个容器中生成无碰撞可行方案", () => {
  const result = window.DemoPlanner.planLoading(smallData());
  assert.equal(result.success, true);
  assert.equal(result.usedBins, 1);
  assert.equal(result.bins[0].placements.length, 2);
  assert.deepEqual(result.unplaced, []);
});

test("互斥货物不能放入同一容器", () => {
  const data = smallData();
  data.containers[0].count = 1;
  data.relations = [{ id:"R", a:"A", b:"D", type:"incompatible" }];
  const result = window.DemoPlanner.planLoading(data);
  assert.equal(result.success, false);
  assert.match(result.issues.join(";"), /不可同放|未安置/);
  const recommend = window.DemoPlanner.recommendExtraContainers(data, result);
  assert.equal(recommend.count, 1);
});

test("相邻货物必须同箱且接触面相邻", () => {
  const data = smallData();
  data.containers[0].count = 2;
  data.relations = [{ id:"R", a:"A", b:"D", type:"adjacent" }];
  const result = window.DemoPlanner.planLoading(data);
  assert.equal(result.success, true);
  const binsWithGoods = result.bins.filter(b => b.placements.length);
  assert.equal(binsWithGoods.length, 1);
  const pA = binsWithGoods[0].placements.find(p => p.id === "A");
  const pD = binsWithGoods[0].placements.find(p => p.id === "D");
  assert.equal(window.DemoPlanner.isAdjacent(pA, pD), true);
});

test("下层不可堆叠时不得承托上层", () => {
  const p1 = { id:"D", name:"丁", x:0, y:0, z:0, l:50, w:50, h:20 };
  const p2 = { id:"A", name:"甲", x:0, y:0, z:20, l:40, w:40, h:20 };
  const cargoById = new Map([
    ["D", { name:"丁", weight:10, loadCapacity:0, stackable:false }],
    ["A", { name:"甲", weight:10, loadCapacity:100, stackable:true }]
  ]);
  const analysis = window.DemoPlanner.analyzeStack([p1,p2], cargoById);
  assert.match(analysis.violations.join(";"), /不可堆叠/);
});

test("上层重量按支撑接触分配并能发现承重超限", () => {
  const lower = { id:"L", name:"底箱", x:0, y:0, z:0, l:40, w:40, h:20 };
  const upper = { id:"U", name:"重箱", x:0, y:0, z:20, l:40, w:40, h:20 };
  const cargoById = new Map([
    ["L", { name:"底箱", weight:10, loadCapacity:30, stackable:true }],
    ["U", { name:"重箱", weight:60, loadCapacity:0, stackable:true }]
  ]);
  const analysis = window.DemoPlanner.analyzeStack([lower, upper], cargoById);
  assert.equal((analysis.load.get("L") || 0), 60);
  assert.match(analysis.violations.join(";"), /承重超限/);
});
