/* 内置演示数据：无需联网或服务端。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SamplePlan = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  return {
    periods: ["2024H1", "2024H2", "2025H1", "2025H2", "2026H1", "2026H2"],
    phases: [
      {
        id: "P1",
        name: "设备能效提升",
        target: 1200,
        startPeriod: "2024H1",
        endPeriod: "2024H2",
        prerequisites: []
      },
      {
        id: "P2",
        name: "燃料结构优化",
        target: 1500,
        startPeriod: "2025H1",
        endPeriod: "2025H2",
        prerequisites: ["P1"]
      },
      {
        id: "P3",
        name: "工艺与余热利用",
        target: 1800,
        startPeriod: "2026H1",
        endPeriod: "2026H2",
        prerequisites: ["P2"]
      }
    ],
    measures: [
      { id: "M1", name: "高效电机替换", phaseId: "P1", planned: 700, actuals: { "2024H1": 320, "2024H2": 390 } },
      { id: "M2", name: "空压站联控", phaseId: "P1", planned: 500, actuals: { "2024H1": 210, "2024H2": 300 } },
      { id: "M3", name: "天然气替代", phaseId: "P2", planned: 900, actuals: { "2025H1": 430, "2025H2": 500 } },
      { id: "M4", name: "锅炉燃烧优化", phaseId: "P2", planned: 600, actuals: { "2025H1": 260, "2025H2": 340 } },
      { id: "M5", name: "余热回收", phaseId: "P3", planned: 1000, actuals: { "2026H1": 420, "2026H2": 480 } },
      { id: "M6", name: "生产工艺参数优化", phaseId: "P3", planned: 800, actuals: { "2026H1": 310, "2026H2": 400 } }
    ]
  };
});
