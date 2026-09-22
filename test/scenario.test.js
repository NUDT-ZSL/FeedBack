// 场景级测试：用 samples/track-jitter.csv + 应用内置示例围栏跑完整推演。
// node test/scenario.test.js
const fs = require("fs");
const path = require("path");
const Geo = require("../js/geo.js");
const Engine = require("../js/engine.js");

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log("  PASS " + name);
  else { failures++; console.log("  FAIL " + name + (extra ? " -> " + extra : "")); }
}

// 与 app.js 示例场景一致的两个重叠围栏
const fenceA = {
  id: "F1", name: "仓库区", priority: 1, color: "#fff",
  polygon: [[-150, -80], [60, -80], [60, 100], [-150, 100]],
  minDwellSec: 10, minGapSec: 6,
  rules: { enter: { enabled: true }, exit: { enabled: true },
    dwell: { enabled: true, seconds: 40 }, overspeed: { enabled: true, maxKmh: 30 } }
};
const fenceB = {
  id: "F2", name: "装卸区", priority: 2, color: "#fff",
  polygon: [[0, -40], [200, -40], [200, 140], [0, 140]],
  minDwellSec: 12, minGapSec: 6,
  rules: { enter: { enabled: true }, exit: { enabled: true },
    dwell: { enabled: true, seconds: 30 }, overspeed: { enabled: false, maxKmh: 50 } }
};

// 解析 CSV（含脏数据行时跳过）
function loadCsv(file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(l => l.trim());
  const pts = [], skipped = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",").map(s => s.trim());
    const t = Geo.parseTime(c[0]);
    const x = parseFloat(c[1]), y = parseFloat(c[2]);
    if (t == null || !isFinite(x) || !isFinite(y)) { skipped.push(i + 1); continue; }
    pts.push({ t, x, y, speed: isFinite(parseFloat(c[3])) ? parseFloat(c[3]) : null });
  }
  pts.sort((a, b) => a.t - b.t);
  return { pts, skipped };
}

const { pts } = loadCsv(path.join(__dirname, "../samples/track-jitter.csv"));
check("track loaded", pts.length === 61, "n=" + pts.length);

const r = Engine.simulate([fenceA, fenceB], pts);
const ev = (type, fid) => r.events.filter(e => e.type === type && e.fenceId === fid);

check("A: exactly 1 enter", ev("enter", "F1").length === 1, "n=" + ev("enter", "F1").length);
check("A: exactly 1 exit", ev("exit", "F1").length === 1, "n=" + ev("exit", "F1").length);
check("A: dwell fired (65s stay > 40s)", ev("dwell", "F1").length === 1);
check("A: overspeed fired (55km/h > 30)", ev("overspeed", "F1").length >= 1);
// 轨迹在 A/B 重叠区内进入 B，B 的进入候选被高优先级的 A 压制
check("B: enter suppressed by overlap priority", ev("enter", "F2").length === 0,
  "n=" + ev("enter", "F2").length);
check("B: dwell fired (55s stay > 30s)", ev("dwell", "F2").length === 1);
check("B: exactly 1 exit", ev("exit", "F2").length === 1, "n=" + ev("exit", "F2").length);

// 边界抖动（10:00:45 出界 5s < minGap 6s）被过滤
check("jitter suppressed recorded",
  r.suppressed.some(s => s.fenceId === "F1" && /抖动/.test(s.reason)));
// 短暂穿越 B 北缘（10:02:50 与 10:03:00 各 5s < minDwell 12s）被过滤
check("brief crossing suppressed recorded",
  r.suppressed.filter(s => s.fenceId === "F2" && /短暂穿越/.test(s.reason)).length >= 1);
// 重叠区（x 0..60）内 B 的候选被 A（优先级更高）压制
check("overlap: B candidates suppressed by A",
  r.suppressed.some(s => s.fenceId === "F2" && /压制/.test(s.reason)));
// 事件时间轴严格按时间排序
check("events sorted by time",
  r.events.every((e, i) => i === 0 || r.events[i - 1].t <= e.t));

// 脏数据：无效行被跳过且不影响其余点推演
const bad = loadCsv(path.join(__dirname, "../samples/track-invalid.csv"));
check("invalid rows skipped", bad.skipped.length === 4 && bad.pts.length === 3,
  `skipped=${bad.skipped.length} valid=${bad.pts.length}`);
const r2 = Engine.simulate([fenceA], bad.pts);
check("simulation continues with valid points",
  r2.events.some(e => e.type === "enter") && r2.events.length >= 1);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
