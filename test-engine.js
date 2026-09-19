/* test-engine.js — 推演内核验证：确定性 / 冲突保留 / 间距与基线 / 增量==全量 */
"use strict";
const E = require("./engine.js");

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log("  PASS " + name); }
  else { failed++; console.log("  FAIL " + name); }
}
function approx(a, b) { return Math.abs(a - b) < 1e-6; }

// 固定种子伪随机，保证测试本身可复现
function rng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const container = { width: 480, padL: 16, padR: 16, padT: 12, padB: 12, gapX: 10, gapY: 8 };
const blocks = [
  { id: "h1", name: "标题", width: 200, height: 36, grow: 1, shrink: 1, minW: 120, maxW: 400, canBreakBefore: false, baseline: 28 },
  { id: "tag", name: "标签", width: 80, height: 22, grow: 0, shrink: 1, minW: 60, maxW: 120, canBreakBefore: true, baseline: 17 },
  { id: "img", name: "图片", width: 180, height: 120, grow: 0, shrink: 1, minW: 100, maxW: 448, canBreakBefore: true, baseline: 120 },
  { id: "p1", name: "正文", width: 260, height: 60, grow: 1, shrink: 2, minW: 140, maxW: 448, canBreakBefore: true, baseline: 48 }
];

console.log("[1] 同一输入结果一致（确定性）");
{
  const r1 = E.solve(container, blocks);
  const r2 = E.solve(container, JSON.parse(JSON.stringify(blocks)));
  ok(JSON.stringify(r1) === JSON.stringify(r2), "两次全量求解输出完全相同");
}

console.log("[2] 间距、内边距、基线共同决定位置");
{
  const r = E.solve(container, blocks);
  const cw = 480 - 16 - 16;
  ok(approx(r.contentWidth, cw), "内容宽度 = 容器宽 - 左右内边距");
  const line0 = r.lines[0];
  ok(line0.blockIds.join(",") === "h1,tag", "第一行按可换行标记断行");
  const h1 = r.placements.h1, tag = r.placements.tag;
  ok(approx(h1.x, 16), "首块 x = 左内边距");
  ok(approx(tag.x, h1.x + h1.width + 10), "相邻块 x 由前块宽度 + gapX 决定");
  ok(approx(h1.width + tag.width + 10, cw), "行内宽度 + 间距 = 内容宽度");
  ok(approx(line0.baseline, 28), "行基线 = 行内最大基线");
  ok(approx(tag.y, line0.y + (28 - 17)), "标签按基线对齐纵向偏移");
  ok(approx(line0.height, 28 + (36 - 28)), "行高 = 基线上 + 基线下最大余量");
  const img = r.placements.img;
  ok(approx(img.y, line0.y + line0.height + 8), "下一行 y = 前行 y + 行高 + gapY");
}

console.log("[3] 冲突双方保留并标记溢出/挤压");
{
  const narrow = Object.assign({}, container, { width: 200 });
  const fixed = JSON.parse(JSON.stringify(blocks));
  fixed[2].pinned = true; fixed[2].pinnedWidth = 180; // img 固定 180，minW 100
  const r = E.solve(narrow, fixed);
  const overflow = r.conflicts.filter(c => c.type === "overflow");
  ok(overflow.length > 0, "装不下时产生 overflow 冲突");
  const c0 = overflow[0];
  ok(!!c0.keepA && !!c0.keepB, "冲突记录同时保留双方约束");
  const states = Object.keys(r.placements).map(id => r.placements[id].state);
  ok(states.indexOf("overflow") >= 0 || states.indexOf("squeezed") >= 0,
     "被挤压/溢出的块被标记状态");
  ok(approx(r.placements.img.width, 180), "固定块尺寸不被静默修改");
}

console.log("[4] 固定尺寸与自身边界冲突时双方保留");
{
  const bad = JSON.parse(JSON.stringify(blocks));
  bad[0].pinned = true; bad[0].pinnedWidth = 500; // 超过 maxW=400
  const r = E.solve(container, bad);
  const pin = r.conflicts.filter(c => c.type === "pin-vs-bounds" && c.blockIds[0] === "h1");
  ok(pin.length === 1, "记录 pin-vs-bounds 冲突");
  ok(approx(r.placements.h1.width, 500), "固定值保留不被钳制");
}

console.log("[5] 手动固定后增量重推 == 整链全量重推");
{
  const rand = rng(20260920);
  let allOk = true;
  for (let t = 0; t < 200; t++) {
    const n = 3 + Math.floor(rand() * 6);
    const bs = [];
    for (let i = 0; i < n; i++) {
      bs.push({
        id: "b" + i, name: "b" + i,
        width: 40 + Math.floor(rand() * 200),
        height: 20 + Math.floor(rand() * 80),
        grow: Math.floor(rand() * 3),
        shrink: Math.floor(rand() * 3),
        minW: 20 + Math.floor(rand() * 60),
        maxW: rand() < 0.3 ? 150 + Math.floor(rand() * 200) : Infinity,
        canBreakBefore: rand() < 0.5,
        baseline: 10 + Math.floor(rand() * 40)
      });
    }
    const c = {
      width: 240 + Math.floor(rand() * 400),
      padL: Math.floor(rand() * 24), padR: Math.floor(rand() * 24),
      padT: 8, padB: 8,
      gapX: Math.floor(rand() * 16), gapY: Math.floor(rand() * 12)
    };
    const before = E.solve(c, bs);
    const idx = Math.floor(rand() * n);
    const after = JSON.parse(JSON.stringify(bs));
    after[idx].pinned = true;
    after[idx].pinnedWidth = 30 + Math.floor(rand() * 300);
    const inc = E.solveIncremental(before, c, after, ["b" + idx]);
    const full = E.solve(c, after);
    if (!inc.consistentWithFull || !E.resultsEqual(inc.result, full)) allOk = false;
  }
  ok(allOk, "200 组随机场景：增量结果与全量逐块一致");
}

console.log("[6] 修改单块属性只重推受影响行");
{
  const many = [];
  for (let i = 0; i < 12; i++) {
    many.push({ id: "m" + i, width: 90, height: 30, grow: 0, shrink: 1,
                minW: 50, maxW: Infinity, canBreakBefore: i % 3 === 0, baseline: 24 });
  }
  const before = E.solve(container, many);
  const after = JSON.parse(JSON.stringify(many));
  after[9].pinned = true; after[9].pinnedWidth = 140;
  const inc = E.solveIncremental(before, container, after, ["m9"]);
  ok(inc.consistentWithFull, "结果与全量一致");
  ok(inc.resolvedFromLine > 0, "前缀行被复用（从第 " + inc.resolvedFromLine + " 行起重推）");
  ok(inc.resolvedFromLine === before.placements.m9.line, "重推起点 = 被改块所在行");
}

console.log("");
console.log("通过 " + passed + " 项，失败 " + failed + " 项");
process.exit(failed ? 1 : 0);
