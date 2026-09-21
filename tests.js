/* Node 回归测试：node tests.js */
global.window = global;
const fs = require("fs");
for (const f of ["data.js", "engine.js"]) eval(fs.readFileSync(__dirname + "/" + f, "utf8"));
const E = window.Engine;
function state(){
  const s = E.clone(window.DEFAULTS);
  s.preferences = {eco:50,safe:30,peak:20};
  s.locks = {};
  return s;
}
function assert(ok,msg){ if(!ok) throw new Error(msg); }
function approx(a,b,t=2){ return Math.abs(a-b)<=t; }

const base = state();
const baseResults = E.rank(base).results;
assert(baseResults.every(r=>r.feasible), "默认参数下所有示例方案应可行");
assert(baseResults[0].plan.name === "削峰优先", "默认综合排序第一应为削峰优先");
baseResults.forEach(r=>{
  const rebuilt = r.arb + r.demandBenefit - r.degradationCost;
  assert(approx(r.netBenefit,rebuilt,.01), `${r.plan.name} 净收益分解不一致`);
});

const lowSoh = state();
lowSoh.settings.soh = .65;
const lowResults = E.rank(lowSoh).results;
assert(lowResults.some(r=>!r.feasible && r.violations.some(v=>v.includes("功率")||v.includes("SOC"))), "低 SOH 应暴露功率或 SOC 越界");

const lowLoad = state();
lowLoad.load[18] = 50;
lowLoad.settings.peakLoad = Math.max(...lowLoad.load);
const lowLoadResults = E.rank(lowLoad).results;
assert(lowLoadResults.some(r=>!r.feasible && r.violations.some(v=>v.includes("超过本地负荷"))), "低负荷情景应识别反送/负荷不足约束");

const demand = E.summarizeSensitivity(base,"demandCharge");
const crossing = demand.leaderIntervals.find(x=>x.leaderName==="削峰优先");
assert(crossing && crossing.lo > 15 && crossing.lo < 25, `需量电价翻转阈值异常：${crossing&&crossing.lo}`);
const deg = E.summarizeSensitivity(base,"degradationCost");
assert(deg.pairFlips.some(f=>f.intervals.some(i=>i.lo>.30&&i.lo<.35)), "衰减成本翻转阈值应约为 0.32 元/kWh");

const locked = state();
locked.locks.demandCharge = true;
const before = locked.settings.demandCharge;
locked.settings.demandCharge = 99;
const sens = E.summarizeSensitivity(locked,"demandCharge");
assert(sens.locked === true && sens.current === 99, "锁定参数应跳过敏感性扫描");
assert(before === 38, "内置锁定状态不应被测试对象污染");

const edited = state();
edited.basePrice[18] = 5;
const highEvening = E.rank(edited).results.find(r=>r.plan.id==="p4");
const normalEvening = baseResults.find(r=>r.plan.id==="p4");
assert(highEvening.arb > normalEvening.arb, "提高放电时段电价应增加套利收益");

console.log(`通过 ${8} 项回归检查`);
