const fs = require("fs");
const src = fs.readFileSync("app.js", "utf8");
const logic = src.slice(0, src.indexOf("// ---------- 渲染"));
eval(logic);

function P(id, name, request, priority, min, prereqs, locked, excluded) {
  return { id, name, request, priority, min, prereqs: prereqs || [], locked: locked === undefined ? null : locked, excluded: !!excluded };
}
let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log("FAIL:", name); } }

// 场景1：示例数据，预算1000，申请合计1300
let projs = [
  P("P1","核心平台",400,5,200),
  P("P2","数据中台",300,4,150,["P1"]),
  P("P3","移动端",250,3,100),
  P("P4","智能客服",200,2,80,["P2"]),
  P("P5","办公自动化",150,1,50),
];
let r = deriveAllocation(1000, projs);
check("P1足额", r.allocation.P1 === 400);
check("P2足额(前置已足额)", r.allocation.P2 === 300);
check("P3足额", r.allocation.P3 === 250);
check("P4最低80不够剩余50则为0", r.allocation.P4 === 0);
check("P4低于最低80被标冲突", r.conflicts.some(c => c.type === "unsatisfied" && c.projects.includes("P4")));
check("P5最低50刚好够则得50", r.allocation.P5 === 50);
check("总额不超预算", Object.values(r.allocation).reduce((a,b)=>a+b,0) <= 1000);

// 场景2：依赖闭环
let cyc = [ P("A","甲",100,5,50,["C"]), P("B","乙",100,4,50,["A"]), P("C","丙",100,3,50,["B"]) ];
let r2 = deriveAllocation(1000, cyc);
check("闭环被检出", r2.conflicts.some(c => c.type === "cycle" && c.projects.length === 3));
check("闭环项目均为0", r2.allocation.A === 0 && r2.allocation.B === 0 && r2.allocation.C === 0);

// 场景3：最低投入之和超预算
let over = [ P("X","x",500,5,400), P("Y","y",500,4,400), P("Z","z",500,3,400) ];
let r3 = deriveAllocation(1000, over);
check("最低投入超支被检出", r3.conflicts.some(c => c.type === "min-over"));

// 场景4：锁定语义 —— 锁定P1=350（低于申请400）后整体重推
let locked = projs.map(p => Object.assign({}, p));
locked[0].locked = 350;
let r4 = deriveAllocation(1000, locked);
check("锁定金额生效", r4.allocation.P1 === 350);
check("锁定低于申请额则前置未足额，P2被阻断", r4.allocation.P2 === 0 && r4.constraints.P2.type === "prereq");
check("锁定后总额<=1000", Object.values(r4.allocation).reduce((a,b)=>a+b,0) <= 1000);
// 一致性：分配是纯函数，同样输入反复推导结果完全一致（无增量残留状态）
let r4b = deriveAllocation(1000, locked);
check("重复推导结果确定一致", JSON.stringify(r4.allocation) === JSON.stringify(r4b.allocation));

// 场景5：排除项目后其前置依赖者不可分配
let excl = projs.map(p => Object.assign({}, p));
excl[0].excluded = true;
let r6 = deriveAllocation(1000, excl);
check("排除P1后P2不可分配", r6.allocation.P2 === 0 && r6.constraints.P2.type === "prereq");
check("排除项目约束标记", r6.constraints.P1.type === "excluded");

// 场景6：前置未足额阻断
let block = [ P("Q1","q1",400,5,100), P("Q2","q2",300,4,100,["Q1"]) ];
let r7 = deriveAllocation(300, block); // Q1只能拿300<400，Q2被阻断
check("前置未足额阻断下游", r7.allocation.Q2 === 0 && r7.constraints.Q2.type === "prereq");

console.log("PASS:", pass, "FAIL:", fail);
process.exit(fail ? 1 : 0);
