const engine = require("../js/engine.js");
const result = engine.createPlan({
  settings: { horizonDays: 7, distanceCostPerUnitKm: 0.6, timeCostPerUnitDay: 3 },
  locations: [
    { id: "A", name: "华东中心仓", stock: 130, inbound: 0, safety: 20, demand: 100 },
    { id: "B", name: "华南仓", stock: 10, inbound: 0, safety: 20, demand: 80 },
    { id: "C", name: "华北仓", stock: 25, inbound: 0, safety: 10, demand: 50 },
    { id: "D", name: "西南仓", stock: 5, inbound: 0, safety: 10, demand: 40 }
  ],
  lanes: [
    { from: "A", to: "B", distanceKm: 100, unitFreight: 2, leadTimeDays: 1 },
    { from: "A", to: "C", distanceKm: 200, unitFreight: 2, leadTimeDays: 2 },
    { from: "A", to: "D", distanceKm: 50, unitFreight: 1, leadTimeDays: 5 }
  ]
});
console.log(JSON.stringify(result.summary, null, 2));
console.log(result.shipments.map(s => `${s.from}->${s.to}:${s.quantity}@${s.totalCost}`).join("\n"));
if (result.summary.fulfilledGap !== 10 || result.summary.unresolvedGap !== 160) process.exit(1);
if (result.priorities[0].id !== "B" || result.priorities[1].id !== "D" || result.priorities[2].id !== "C") process.exit(2);
