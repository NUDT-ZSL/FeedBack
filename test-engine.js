// 引擎逻辑自测：node test-engine.js
const fs = require("fs");
const src = fs.readFileSync("app.js", "utf8");
const cut = src.indexOf("// ---------- 渲染：组件切换");
if (cut < 0) throw new Error("marker not found");
// 只加载引擎部分（不含 DOM 渲染与启动）；去掉严格模式以便函数注入本作用域
eval(src.slice(0, cut).replace('"use strict";', ""));

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; } else { fail++; console.error("FAIL:", label, "=>", JSON.stringify(actual), "期望", JSON.stringify(expected)); }
}

// 构造组件：尺寸{小,大} 状态{默认,禁用} 主题{浅,深}
const dS = "dSize", dSt = "dState", dT = "dTheme";
const comp = {
  id: "c1", name: "测试",
  dims: [
    { id: dS, name: "尺寸", values: ["小", "大"] },
    { id: dSt, name: "状态", values: ["默认", "禁用"] },
    { id: dT, name: "主题", values: ["浅", "深"] },
  ],
  constraints: [
    { id: "k1", type: "mutex", a: { dimId: dS, value: "大" }, b: { dimId: dSt, value: "禁用" }, ignored: false },
    { id: "k2", type: "requires", a: { dimId: dSt, value: "禁用" }, b: { dimId: dT, value: "浅" }, ignored: false },
  ],
};

// 1) 互斥命中
let r = recompute(comp, { full: true });
eq(r.cache.get(comboKeyOf(comp, { [dS]: "大", [dSt]: "禁用", [dT]: "浅" })).status, "invalid", "互斥命中应无效");
// 2) 依赖未满足
const r2 = r.cache.get(comboKeyOf(comp, { [dS]: "小", [dSt]: "禁用", [dT]: "深" }));
eq(r2.status, "invalid", "依赖未满足应无效");
eq(r2.verdicts[0].kind, "unmet", "依据类型为 unmet");
// 3) 有效组合
eq(r.cache.get(comboKeyOf(comp, { [dS]: "小", [dSt]: "默认", [dT]: "深" })).status, "valid", "无命中应有效");
// 4) 多依据保留：大+禁用+深 同时违反互斥与依赖
const r4 = r.cache.get(comboKeyOf(comp, { [dS]: "大", [dSt]: "禁用", [dT]: "深" }));
eq(r4.verdicts.length, 2, "应保留两条判定依据");
// 5) 裁决忽略后收敛
comp.constraints[0].ignored = true;
comp.constraints[1].ignored = true;
r = recompute(comp, { full: true });
eq(r.cache.get(comboKeyOf(comp, { [dS]: "大", [dSt]: "禁用", [dT]: "深" })).status, "valid", "全部忽略后应收敛为有效");
comp.constraints.forEach((c) => (c.ignored = false));

// 6) 失效引用 -> 不可信
comp.constraints.push({ id: "k3", type: "mutex", a: { dimId: dS, value: "小" }, b: { dimId: dT, value: "不存在" }, ignored: false });
r = recompute(comp, { full: true });
eq(r.cache.get(comboKeyOf(comp, { [dS]: "小", [dSt]: "默认", [dT]: "浅" })).status, "untrusted", "触及失效引用应不可信");
eq(r.cache.get(comboKeyOf(comp, { [dS]: "大", [dSt]: "默认", [dT]: "浅" })).status, "valid", "未触及失效引用不受影响");
comp.constraints.pop();

// 7) 依赖闭环 -> 不可信
comp.constraints.push({ id: "k4", type: "requires", a: { dimId: dT, value: "浅" }, b: { dimId: dSt, value: "禁用" }, ignored: false });
// k2: 禁用->浅, k4: 浅->禁用 构成闭环
r = recompute(comp, { full: true });
eq(r.cache.get(comboKeyOf(comp, { [dS]: "小", [dSt]: "禁用", [dT]: "浅" })).status, "untrusted", "闭环节点组合应不可信");
eq(r.cache.get(comboKeyOf(comp, { [dS]: "小", [dSt]: "默认", [dT]: "深" })).status, "valid", "闭环外组合不受影响");
comp.constraints.pop();

// 8) 增量：新增约束只重评触及组合
r = recompute(comp, { full: true }); // 基线 8 组合
const con = { id: "k5", type: "mutex", a: { dimId: dS, value: "小" }, b: { dimId: dT, value: "深" }, ignored: false };
comp.constraints.push(con);
r = recompute(comp, { constraint: con });
eq(r.info.reevaluated, 6, "新增约束应只重评 6 个组合（含「小」4 个 ∪ 含「深」4 个，交集 2）");
eq(r.info.total, 8, "组合总数 8");
eq(r.cache.get(comboKeyOf(comp, { [dS]: "小", [dSt]: "默认", [dT]: "深" })).status, "invalid", "新约束生效");
comp.constraints.pop();

// 9) 维度取值删除 -> 失效键清理
comp.dims[2].values = ["浅"];
r = recompute(comp, {});
eq(r.info.total, 4, "删取值后组合数 4");
eq(r.cache.size, 4, "缓存同步清理");

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
