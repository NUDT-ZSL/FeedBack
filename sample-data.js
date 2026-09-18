/* sample-data.js — 内置示例：某投资项目财务方案评审
 * 通过核心 API 登记，演示：分段响应、非单调、平台、多来源冲突。
 * 浏览器与 Node 均可用。
 */
(function (global) {
'use strict';

function buildSampleModel(FinReview) {
  const model = FinReview.createModel();
  const S1 = '财务部', S2 = '业务线';

  // ---- 指标：决策线 ----
  FinReview.registerMetric(model, {
    id: 'npv', name: '净现值 NPV', unit: '万元',
    baseValue: 1200, threshold: 0, limit: 'min', // 低于 0 越线
  });
  FinReview.registerMetric(model, {
    id: 'payback', name: '动态回收期', unit: '年',
    baseValue: 4.5, threshold: 6, limit: 'max', // 高于 6 年越线
  });

  // ---- 假设（来源：财务部）----
  const A = [
    { id: 'sales', name: '销量增长率', unit: '%', base: 5, min: -10, max: 20 },
    { id: 'price', name: '产品单价', unit: '元', base: 100, min: 80, max: 130 },
    { id: 'cost', name: '单位变动成本', unit: '元', base: 60, min: 40, max: 90 },
    { id: 'rate', name: '折现率', unit: '%', base: 8, min: 4, max: 15 },
    { id: 'capex', name: '初始投资', unit: '万元', base: 5000, min: 4000, max: 7000 },
  ];
  A.forEach(a => FinReview.registerAssumption(model, a, S1));

  // ---- 响应（来源：财务部）：y = 仅该假设取 x（其余取基准）时的指标值 ----
  const R = (m, a, segs) => FinReview.registerResponse(model, m, a,
    segs.map(s => ({ x0: s[0], y0: s[1], x1: s[2], y1: s[3] })), S1);

  // NPV 响应
  R('npv', 'sales', [[-10, -800, 0, 200], [0, 200, 10, 1800], [10, 1800, 20, 2600]]);
  R('npv', 'price', [[80, 400, 105, 1900], [105, 1900, 115, 1500], [115, 1500, 130, 200]]); // 非单调：过度提价销量崩塌
  R('npv', 'cost', [[40, 2600, 60, 1200], [60, 1200, 75, 200], [75, 200, 90, -900]]);
  R('npv', 'rate', [[4, 1700, 8, 1200], [8, 1200, 11, 1200], [11, 1200, 15, 700]]); // 平台 [8,11]
  R('npv', 'capex', [[4000, 2200, 5000, 1200], [5000, 1200, 7000, -800]]);
  // 回收期响应
  R('payback', 'sales', [[-10, 7.5, 0, 5.5], [0, 5.5, 10, 3.8], [10, 3.8, 20, 3.2]]);
  R('payback', 'price', [[80, 6.2, 100, 4.6], [100, 4.6, 115, 4.0], [115, 4.0, 130, 5.0]]); // 非单调
  R('payback', 'cost', [[40, 3.4, 60, 4.5], [60, 4.5, 90, 6.8]]);
  R('payback', 'capex', [[4000, 3.6, 5000, 4.5], [5000, 4.5, 6000, 5.4], [6000, 5.4, 7000, 6.4]]);

  // ---- 第二来源（业务线）的矛盾登记：双方保留，生成冲突记录 ----
  FinReview.registerAssumption(model,
    { id: 'cost', name: '单位变动成本', unit: '元', base: 63, min: 45, max: 88 }, S2);
  FinReview.registerResponse(model, 'npv', 'sales',
    [{ x0: -10, y0: -500, x1: 0, y1: 400 }, { x0: 0, y0: 400, x1: 10, y1: 1600 }, { x0: 10, y0: 1600, x1: 20, y1: 3000 }], S2);

  // 冲突项默认采用「财务部」口径（用户可在冲突面板切换）
  FinReview.setActiveSource(model, 'A:cost', S1);
  FinReview.setActiveSource(model, 'R:npv/sales', S1);

  // ---- 默认扰动方向：成本上行 + 销量走弱（不利组合）----
  FinReview.setDirection(model, 'cost', 8);
  FinReview.setDirection(model, 'sales', -3);

  return model;
}

const api = { buildSampleModel };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
global.FinReviewSample = api;
})(typeof window !== 'undefined' ? window : globalThis);
