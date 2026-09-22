// 引擎单元测试：node test/engine.test.js
const Engine = require("../js/engine.js");

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log("  PASS " + name);
  else { failures++; console.log("  FAIL " + name + (extra ? " -> " + extra : "")); }
}
function mkFence(over) {
  return Object.assign({
    id: "F1", name: "A", priority: 1, color: "#fff",
    polygon: [[0, 0], [100, 0], [100, 100], [0, 100]],
    minDwellSec: 10, minGapSec: 5,
    rules: {
      enter: { enabled: true }, exit: { enabled: true },
      dwell: { enabled: true, seconds: 60 },
      overspeed: { enabled: true, maxKmh: 50 }
    }
  }, over);
}
function track(spec) { // spec: [[dtSec, x, y, speed?], ...]
  let t = 1000000;
  return spec.map(([dt, x, y, v]) => ({ t: (t += dt), x, y, speed: v ?? null }));
}

// 1. 基本进入/停留/离开
{
  const pts = track([[-60, -50, 50], [10, 10, 50], [30, 50, 50], [40, 60, 50], [40, 150, 50]]);
  const r = Engine.simulate([mkFence()], pts);
  const types = r.events.map(e => e.type);
  check("enter+exit", types.includes("enter") && types.includes("exit"), types.join());
  check("dwell after 60s", types.includes("dwell"), types.join());
  check("enter before dwell before exit",
    types.indexOf("enter") < types.indexOf("dwell") && types.indexOf("dwell") < types.indexOf("exit"));
}

// 2. 边界抖动：短暂出界 < minGapSec 不产生离开/再进入
{
  const pts = track([[-60, -50, 50], [10, 50, 50], [3, 120, 50], [2, 50, 50], [30, 60, 50], [40, 150, 50]]);
  const r = Engine.simulate([mkFence()], pts);
  const enters = r.events.filter(e => e.type === "enter").length;
  const exits = r.events.filter(e => e.type === "exit").length;
  check("jitter filtered: 1 enter 1 exit", enters === 1 && exits === 1,
    `enter=${enters} exit=${exits}`);
  check("jitter recorded as suppressed",
    r.suppressed.some(s => /抖动/.test(s.reason)));
}

// 3. 短暂穿越 < minDwellSec 不产生进入/离开
{
  const pts = track([[-60, -50, 50], [10, -30, 50], [3, 50, 50], [2, -30, 50], [10, -50, 50]]);
  const r = Engine.simulate([mkFence()], pts);
  check("brief crossing filtered", r.events.length === 0, JSON.stringify(r.events.map(e => e.type)));
  check("brief crossing recorded", r.suppressed.some(s => /短暂穿越/.test(s.reason)));
}

// 4. 超速事件与限速阈值
{
  const pts = track([[-60, 10, 10, 30], [10, 20, 20, 80], [10, 30, 30, 90], [10, 40, 40, 20]]);
  const r = Engine.simulate([mkFence()], pts);
  const os = r.events.filter(e => e.type === "overspeed");
  check("overspeed grouped to one event", os.length === 1, "n=" + os.length);
  check("overspeed peak speed", os.length && Math.abs(os[0].speed - 90) < 1e-6);
}

// 5. 重叠围栏优先级消解：低优先级候选被压制
{
  const lo = mkFence({ id: "F2", name: "B", priority: 2,
    polygon: [[50, 0], [150, 0], [150, 100], [50, 100]] });
  const pts = track([[-60, -50, 50], [10, 75, 50], [30, 80, 50], [10, 200, 50]]);
  const r = Engine.simulate([mkFence(), lo], pts);
  check("only high-priority fence events in overlap",
    r.events.every(e => e.fenceId === "F1"), JSON.stringify(r.events.map(e => e.fenceId)));
  check("low-priority candidate suppressed",
    r.suppressed.some(s => s.fenceId === "F2" && /压制/.test(s.reason)));
}

// 6. 规则关闭后不产生对应事件
{
  const f = mkFence();
  f.rules.dwell.enabled = false; f.rules.overspeed.enabled = false;
  const pts = track([[-60, 10, 10, 200], [120, 50, 50, 200], [10, 150, 50, 10]]);
  const r = Engine.simulate([f], pts);
  check("disabled rules produce no events",
    !r.events.some(e => e.type === "dwell" || e.type === "overspeed"));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
