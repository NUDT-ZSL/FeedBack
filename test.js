// 无头功能测试：直接驱动引擎
const fs = require("fs");
const html = fs.readFileSync("index.html", "utf-8");
const src = html.match(/<script>([\s\S]*)<\/script>/)[1];
const engine = src.split("// ---------- 渲染")[0] +
  src.match(/function catStats\(\)[\s\S]*?\n}\nfunction starvedCats\(\)[\s\S]*?\n}\n/)[0];
require("vm").runInThisContext(engine);
globalThis.log = () => {};

function step(dt) { S.simTime += dt; advanceTo(S.simTime); }
function run(until, dt = 0.25) { while (S.simTime < until) step(dt); }
const inflight = () => S.consumers.reduce((s, c) => s + c.batch.length, 0);
let pass = 0, fail = 0;
function check(name, cond) { cond ? pass++ : (fail++, console.log("FAIL: " + name)); console.log((cond ? "ok  " : "BAD ") + name); }

// 1. 装载示例，2 消费者，批量 1
S.upcoming = parseJobs(makeSample());
setConsumers(2);
const total = S.upcoming.length;
check("示例解析出作业 " + total + " 条", total > 100);

// 2. 生产 > 消费 => 积压增长
run(20);
check("t=20 出现积压 backlog=" + S.pending.length, S.pending.length > 5);
const b20 = S.pending.length;
run(35);
check("积压继续增长 " + b20 + " -> " + S.pending.length, S.pending.length > b20);
check("在途作业 > 0", inflight() > 0);
check("已有完成", S.completed > 0);

// 3. 暂停消费：进度连续，恢复后完成数不回退
S.consumePaused = true;
const doneAtPause = S.completed;
run(45);
check("暂停期间不再取新件", inflight() === 0 && S.completed >= doneAtPause);
S.consumePaused = false;
run(50);
check("恢复后继续推进", S.completed > doneAtPause);

// 4. 中途注入突发
const beforeBurst = S.upcoming.length + S.pending.length;
burst(30);
check("突发注入 30 件", S.upcoming.length + S.pending.length === beforeBurst + 30);

// 5. 增加消费者 + 批量 => 积压回落，统计不重置
const doneBefore = S.completed;
setConsumers(8);
S.batchSize = 3;
run(120);
check("加能力后积压回落 backlog=" + S.pending.length, S.pending.length < 10);
check("完成数连续累计", S.completed > doneBefore);

// 6. 饥饿检测：优先级策略下 C 类最低
S.upcoming = parseJobs("0,5,A\n0,5,B\n0,5,C\n1,5,A\n1,5,B\n2,5,A\n2,5,B\n3,5,A\n3,5,B\n4,5,A\n4,5,B");
S.pending = []; S.consumers = []; S.simTime = 0; S.completed = 0; S.perCat = {};
S.strategy = "priority"; S.prioOrder = ["A", "B", "C"]; S.batchSize = 1;
setConsumers(1);
run(45);
const sv = starvedCats().map(s => s.cat);
check("C 类触发饥饿提示 [" + sv + "]", sv.includes("C"));
// 调整优先级缓解
S.prioOrder = ["C", "A", "B"];
run(120);
check("提高 C 优先级后 C 全部完成", S.perCat["C"].done === 1);

// 7. 全部完成且无丢失
S.strategy = "fifo";
run(300);
const arrivedTotal = Object.values(S.perCat).reduce((s, c) => s + c.arrived, 0);
check("全部完成 " + S.completed + "/" + arrivedTotal, S.completed === arrivedTotal && S.pending.length === 0);

console.log("\n通过 " + pass + "，失败 " + fail);
process.exit(fail ? 1 : 0);
