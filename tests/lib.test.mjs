import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const L = require("../public/lib.js");

// splitParagraphs
assert.deepEqual(L.splitParagraphs("一段。\n\n二段。"), ["一段。", "二段。"]);
assert.deepEqual(L.splitParagraphs("a\r\n\r\nb\r\nc"), ["a", "b c"]);
assert.deepEqual(L.splitParagraphs("  \n\n  "), []);

// splitSentences：保留标点、覆盖中英文
assert.deepEqual(L.splitSentences("你好。世界！"), ["你好。", "世界！"]);
assert.deepEqual(
  L.splitSentences("他问：“走吗？”她答：“走。”"),
  ["他问：“走吗？”", "她答：“走。”"]
);
assert.deepEqual(L.splitSentences("Hello world. Bye!"), ["Hello world.", "Bye!"]);
assert.deepEqual(L.splitSentences("没有标点"), ["没有标点"]);

// computeColumns：确定性、边界、单调性
assert.equal(L.computeColumns(0, 30), 1);
assert.equal(L.computeColumns(400, 30), 1);
assert.equal(L.computeColumns(1200, 30), 2);
assert.equal(L.computeColumns(10000, 16), L.MAX_COLS);
assert.equal(L.computeColumns(1200, 30), L.computeColumns(1200, 30)); // 幂等
let prev = 1;
for (let w = 200; w <= 3000; w += 50) {
  const c = L.computeColumns(w, 24);
  assert.ok(c >= prev, "栏数随宽度单调不减");
  prev = c;
}
// 字号越大栏数越少
assert.ok(L.computeColumns(1200, 60) <= L.computeColumns(1200, 20));

// restoreScrollTop：frac 语义与下界钳制
assert.equal(L.restoreScrollTop(1000, 0.25, 800), 800);
assert.equal(L.restoreScrollTop(100, 0.5, 800), 0);

// clamp
assert.equal(L.clamp(5, 1, 3), 3);
assert.equal(L.clamp(-1, 0, 3), 0);

console.log("lib tests: all passed");
