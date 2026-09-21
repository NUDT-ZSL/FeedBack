/* Node 逻辑验证：node test/engine.test.js */
const Engine = require("../js/engine.js");
const fs = require("fs");
const path = require("path");

// 从 js/data.js 提取 makeSampleData（在沙盒中执行）
const dataSrc = fs.readFileSync(path.join(__dirname, "../js/data.js"), "utf8");
const makeSampleData = new Function(dataSrc + "; return makeSampleData;")();

Engine.clock = () => new Date("2026-09-22T10:00:00");

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS " + name);
  else { failures++; console.log("FAIL " + name, extra || ""); }
}

// --- 1. 全量推导基本结论 ---
{
  const eng = new Engine(makeSampleData());
  eng.fullDerive();
  const r = id => eng.results.get(id);
  check("H-01 完整可信", r("H-01").status === "complete" && r("H-01").completeness === 100);
  check("H-02 因来源冲突被阻塞", r("H-02").status === "blocked" && r("H-02").conflicts.length === 1);
  check("H-03 因上游冲突被阻塞", r("H-03").status === "blocked");
  check("H-04 依赖缺失不可信", r("H-04").status === "untrusted");
  check("H-05/H-06 依赖成环不可信", r("H-05").status === "untrusted" && r("H-06").status === "untrusted");
  check("H-07 事项与上下文均过期不可信", r("H-07").status === "untrusted");
  check("H-03 过期上下文被标记", eng.results.get("H-03").contextStates["C-05"].trusted === false);
}

// --- 2. 裁决冲突后增量重推 == 全量重推 ---
{
  const state = makeSampleData();
  const eng = new Engine(state);
  eng.fullDerive();
  // 裁决 H-02 的发布窗口：采用 C-03，弃用 C-04
  state.contexts.find(c => c.id === "C-04").status = "superseded";
  const inc = eng.incrementalDerive(["H-02"]);
  check("增量影响链 = H-02,H-03", JSON.stringify([...inc.affected].sort()) === JSON.stringify(["H-02", "H-03"]), JSON.stringify(inc.affected));
  const v = eng.verifyConsistency();
  check("裁决后增量与全量一致", v.consistent, JSON.stringify(v));
  check("H-02 裁决后变为完整", eng.results.get("H-02").status === "complete");
  check("H-03 裁决后变为部分(上下文过期)", eng.results.get("H-03").status === "partial");
}

// --- 3. 修改上下文（改过期时间）后增量 == 全量 ---
{
  const state = makeSampleData();
  const eng = new Engine(state);
  eng.fullDerive();
  state.contexts.find(c => c.id === "C-05").expiresAt = "2026-12-31T00:00";
  eng.incrementalDerive(["H-03"]);
  const v = eng.verifyConsistency();
  check("修改时效后增量与全量一致", v.consistent, JSON.stringify(v));
}

// --- 4. 修改上下文值制造新冲突 ---
{
  const state = makeSampleData();
  const eng = new Engine(state);
  eng.fullDerive();
  state.contexts.find(c => c.id === "C-01").value = "周日 03:00-05:00";
  state.contexts.push({ id: "C-09", itemId: "H-01", key: "切换窗口", value: "周六 02:00-04:00", source: "运维群消息", expiresAt: null, status: "active" });
  eng.incrementalDerive(["H-01"]);
  const v = eng.verifyConsistency();
  check("新增冲突后增量与全量一致", v.consistent, JSON.stringify(v));
  check("H-01 出现冲突被阻塞", eng.results.get("H-01").status === "blocked");
  check("下游 H-02 仍被阻塞(上游冲突)", eng.results.get("H-02").status === "blocked");
}

// --- 5. 打破依赖环后恢复 ---
{
  const state = makeSampleData();
  const eng = new Engine(state);
  eng.fullDerive();
  state.items.find(i => i.id === "H-06").dependsOn = [];
  eng.incrementalDerive(["H-06"]);
  const v = eng.verifyConsistency();
  check("破环后增量与全量一致", v.consistent, JSON.stringify(v));
  check("H-05 破环后恢复完整", eng.results.get("H-05").status === "complete");
}

console.log(failures === 0 ? "\n全部通过" : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
