const fs = require("fs");
const src = fs.readFileSync("app.js", "utf8");
const cut = src.indexOf("/* ---------- 渲染与交互");
if (cut < 0) throw new Error("marker not found");
const engine = src.slice(0, cut).replace(/let state = loadState\(\);[\s\S]*?function saveState[^\n]*\n/, "");
eval(engine);

// 固定“今天”以便可重复：直接构造日期
const start = new Date(2026, 0, 1), end = new Date(2026, 11, 31);

// 1) 展开：按月 / 按季 / 一次性
const monthly = expandEntry({id:1,name:"工资",kind:"income",amount:1000,start:"2026-01-31",recur:"monthly",end:""}, start, end);
console.log("monthly count:", monthly.length, "feb date:", monthly[1].date); // 12, 2026-02-28 (月末收敛)
const quarterly = expandEntry({id:2,name:"保险",kind:"expense",amount:600,start:"2026-01-15",recur:"quarterly",end:""}, start, end);
console.log("quarterly count:", quarterly.length, quarterly.map(e=>e.date).join(","));
const once = expandEntry({id:3,name:"家电",kind:"expense",amount:800,start:"2026-03-10",recur:"once",end:""}, start, end);
console.log("once count:", once.length, once[0].date);
const ended = expandEntry({id:4,name:"短租",kind:"expense",amount:100,start:"2026-01-05",recur:"monthly",end:"2026-03-31"}, start, end);
console.log("ended count:", ended.length); // 3

// 2) 情景叠加：延迟+提前+上浮同时生效
const sc = {incomeDelay:10, expenseAdvance:5, amountUplift:20, upliftTarget:"expense"};
const evs = applyScenario([
  {date:"2026-02-01",name:"工资",kind:"income",amount:1000,entryId:1},
  {date:"2026-02-10",name:"房租",kind:"expense",amount:500,entryId:2}
], sc);
console.log("income shifted:", evs[0].date, evs[0].amount); // 2026-02-11, 1000
console.log("expense shifted:", evs[1].date, evs[1].amount); // 2026-02-05, 600

// 3) 逐日推演 + 首次跌破 + 追溯
const events = [
  {date:"2026-01-05",name:"房租",kind:"expense",amount:800,entryId:2},
  {date:"2026-01-08",name:"生活费",kind:"expense",amount:300,entryId:3},
  {date:"2026-01-10",name:"工资",kind:"income",amount:2000,entryId:1}
];
const r = simulate(events, 1000, 500, start, end);
console.log("breach:", r.breach.date, r.breach.balance, "lastSafe:", r.breach.lastSafeDate);
console.log("contributors:", r.breach.contributors.map(c=>c.name+"@"+c.date).join(" | "));
console.log("cumGap>0:", r.cumGap > 0);

// 4) 确定性：同输入两次结果一致
const r2 = simulate(events, 1000, 500, start, end);
console.log("deterministic:", JSON.stringify(r) === JSON.stringify(r2));

// 5) 无缺口场景
const r3 = simulate([{date:"2026-01-02",name:"工资",kind:"income",amount:5000,entryId:1}], 1000, 500, start, end);
console.log("no breach:", r3.breach === null, "cumGap:", r3.cumGap);

