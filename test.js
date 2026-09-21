/* 引擎行为测试：node test.js */
"use strict";
const E = require("./engine.js");
let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log("  PASS " + name); }
  else { failed++; console.log("  FAIL " + name); }
}
function near(a, b) { return Math.abs(a - b) < 1e-6; }
function baseAsset(extra) {
  return Object.assign({
    id: "A1", name: "测试资产", cost: 12000, start: "2026-01",
    lifeYears: 1, salvage: 2000,
    disposalTime: "", disposalProceeds: null, adjustments: [],
  }, extra || {});
}
console.log("[1] 直线折旧逐期推导");
{
  const r = E.computeAsset(baseAsset());
  ok(r.ok && r.periods.length === 12, "共 12 期");
  ok(near(r.periods[0].dep, 10000 / 12), "月折旧额 = (成本-残值)/12");
  ok(near(r.finalValue, 2000), "期末账面价值 = 残值");
  ok(r.trustworthy, "数据齐全时结论可信");
}
console.log("[2] 调整改变后续折旧路径");
{
  const r = E.computeAsset(baseAsset({ adjustments: [
    { id: "j1", time: "2026-07", type: "impairment", amount: 3000, seq: 1 },
  ] }));
  const p6 = r.periods[6]; // 2026-07
  ok(near(p6.adjDelta, -3000), "减值当月调整额 -3000");
  // 7月期初 = 12000 - 6*833.333 = 7000；减值后 4000；剩余6期折旧 (4000-2000)/6
  ok(near(p6.dep, (4000 - 2000) / 6), "减值后按剩余期间重算折旧");
  ok(near(r.finalValue, 2000), "期末仍收敛到残值");
  ok(r.periods[6].adjDetails[0].label === "减值", "区分折旧与调整变化");
}
console.log("[3] 重估 = 设为指定价值");
{
  const r = E.computeAsset(baseAsset({ adjustments: [
    { id: "j1", time: "2026-07", type: "revaluation", amount: 9000, seq: 1 },
  ] }));
  ok(near(r.periods[6].openValue + r.periods[6].adjDelta, 9000), "重估后期初价值变为 9000");
  ok(r.trustworthy, "重估允许超过成本，不判越界");
}
console.log("[4] 同时点冲突：全部保留并标记，不静默择一");
{
  const asset = baseAsset({ adjustments: [
    { id: "j1", time: "2026-06", type: "impairment", amount: 1000, seq: 1 },
    { id: "j2", time: "2026-06", type: "appreciation", amount: 500, seq: 2 },
  ] });
  const r = E.computeAsset(asset);
  ok(r.conflicts.length === 1 && r.conflicts[0].time === "2026-06", "检出冲突时点");
  ok(r.conflicts[0].adjustmentIds.join(",") === "j1,j2", "两条来源都保留");
  ok(r.periods[5].conflict === true, "对应期间标记冲突");
  ok(r.trustworthy === false, "冲突未裁决时结论不可信");
  asset.adjustments[1].excluded = true; // 裁决：排除 j2
  const r2 = E.computeAsset(asset);
  ok(r2.conflicts.length === 0 && r2.trustworthy, "裁决后冲突消除、结论恢复可信");
  ok(near(r2.periods[5].adjDelta, -1000), "裁决后仅应用被保留的调整");
}
console.log("[5] 增量重推与整体重推一致");
{
  const assets = [
    baseAsset({ id: "A1" }),
    baseAsset({ id: "A2", cost: 50000, lifeYears: 2, salvage: 5000, adjustments: [
      { id: "x1", time: "2026-06", type: "impairment", amount: 8000, seq: 1 },
    ] }),
    baseAsset({ id: "A3", cost: 8000, lifeYears: 0.5, salvage: 0 }),
  ];
  const full1 = E.computeAll(assets);
  assets[1].adjustments[0].amount = 6000; // 修改 A2 的调整，仅增量重推 A2
  const inc = { A1: full1.A1, A2: E.computeAsset(assets[1]), A3: full1.A3 };
  const full2 = E.computeAll(assets);
  ok(JSON.stringify(inc) === JSON.stringify(full2), "增量结果与整体重推逐字节一致");
  ok(JSON.stringify(full1.A1) === JSON.stringify(full2.A1), "未受影响资产结果不变");
}
console.log("[6] 依据不足与越界标记");
{
  const r1 = E.computeAsset(baseAsset({ start: "" }));
  ok(!r1.ok && !r1.trustworthy &&
     r1.issues.some(i => i.code === "MISSING_START"), "缺启用时刻 -> 不可信并说明原因");
  const r2 = E.computeAsset(baseAsset({ lifeYears: null }));
  ok(r2.issues.some(i => i.code === "MISSING_LIFE"), "缺年限 -> 标出");
  const r3 = E.computeAsset(baseAsset({ salvage: undefined }));
  ok(r3.issues.some(i => i.code === "MISSING_SALVAGE"), "缺残值 -> 标出");
  const r4 = E.computeAsset(baseAsset({ adjustments: [
    { id: "j1", time: "2026-03", type: "impairment", amount: 99999, seq: 1 },
  ] }));
  ok(!r4.trustworthy && r4.issues.some(i => i.code === "OUT_OF_BOUNDS"),
     "调整导致价值为负 -> 越界不可信");
  ok(r4.periods[2].flags.some(f => f.code === "OUT_OF_BOUNDS"), "越界期间有标记");
  const r5 = E.computeAsset(baseAsset({ adjustments: [
    { id: "j1", time: "2026-03", type: "appreciation", amount: 99999, seq: 1 },
  ] }));
  ok(!r5.trustworthy, "增值超过成本 -> 越界不可信");
}
console.log("[7] 待核实与处置损益");
{
  const r = E.computeAsset(baseAsset({
    disposalTime: "2026-07", disposalProceeds: 6000,
    adjustments: [
      { id: "j1", time: "2026-05", type: "impairment", amount: 1000, pending: true, seq: 1 },
    ],
  }));
  ok(r.periods.length === 7, "处置当月截断（1-7月）");
  ok(r.hasPending && r.periods[4].pending, "待核实调整被标记");
  // 5月期初 = 12000-4*833.333=8666.667，减值后 7666.667，剩余8期折旧 (7666.667-2000)/8
  const depAfter = (12000 - 4 * (10000 / 12) - 1000 - 2000) / 8;
  const bookJul = 12000 - 4 * (10000 / 12) - 1000 - 3 * depAfter;
  ok(near(r.disposal.bookValue, bookJul), "处置时点账面价值正确");
  ok(near(r.disposal.gainLoss, 6000 - bookJul), "处置损益 = 处置收入 - 账面价值");
  const r2 = E.computeAsset(baseAsset({ disposalTime: "2026-07", disposalProceeds: null }));
  ok(r2.disposal.gainLoss === null &&
     r2.issues.some(i => i.code === "MISSING_PROCEEDS"), "缺处置收入 -> 标出原因");
}
console.log("[8] 已排除调整不参与推导与冲突");
{
  const r = E.computeAsset(baseAsset({ adjustments: [
    { id: "j1", time: "2026-06", type: "impairment", amount: 1000, seq: 1 },
    { id: "j2", time: "2026-06", type: "impairment", amount: 2000, seq: 2, excluded: true },
  ] }));
  ok(r.conflicts.length === 0, "被排除的调整不构成冲突");
  ok(near(r.periods[5].adjDelta, -1000), "被排除的调整不影响金额");
}
console.log("");
console.log("通过 " + passed + " 项，失败 " + failed + " 项");
process.exit(failed ? 1 : 0);
