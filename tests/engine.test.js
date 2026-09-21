const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../js/engine.js");
const schema = require("../js/schema.js");
const narration = require("../js/narration.js");

function scheme(overrides = {}) {
  const dimensions = [
    { id: "a", name: "A", weight: 60, maxScore: 100, missingPolicy: "prorate",
      levels: [{ grade: "高", min: 80 }, { grade: "低", min: 0 }] },
    { id: "b", name: "B", weight: 40, maxScore: 100, missingPolicy: "zero",
      levels: [{ grade: "高", min: 80 }, { grade: "低", min: 0 }] }
  ];
  return Object.assign({
    name: "测试方案",
    dimensions,
    weights: { a: 60, b: 40 },
    overallBands: [
      { grade: "优秀", min: 90 },
      { grade: "合格", min: 60 },
      { grade: "复训", min: 0 }
    ]
  }, overrides);
}

test("按权重计算总分、等级和贡献", () => {
  const result = engine.evaluate(scheme(), { a: 90, b: 50 });
  assert.equal(result.total, 74);
  assert.equal(result.overallGrade, "合格");
  assert.equal(result.entries[0].contribution, 54);
  assert.equal(result.entries[1].contribution, 20);
  assert.equal(result.highs[0].id, "a");
  assert.equal(result.lows[0].id, "b");
});

test("缺省策略为重新分摊时排除该维度", () => {
  const custom = scheme();
  custom.dimensions[1].missingPolicy = "prorate";
  const result = engine.evaluate(custom, { a: 80 });
  assert.equal(result.total, 80);
  assert.equal(result.includedWeight, 60);
  assert.equal(result.entries[1].included, false);
  const text = narration.buildNarration(result, custom).lines.join("");
  assert.match(text, /重新分摊/);
  assert.match(text, /从分母剔除 40%/);
});

test("缺省策略为零分、满分和均分时影响明确", () => {
  const zero = engine.evaluate(scheme(), { a: 80 });
  assert.equal(zero.total, 48);
  assert.equal(zero.overallGrade, "复训");
  assert.equal(zero.entries[1].missingImpact, -32);

  const full = scheme();
  full.dimensions[1].missingPolicy = "full";
  const fullResult = engine.evaluate(full, { a: 80 });
  assert.equal(fullResult.total, 88);
  assert.equal(fullResult.entries[1].missingImpact, 8);

  const average = scheme();
  average.dimensions[1].missingPolicy = "average";
  const averageResult = engine.evaluate(average, { a: 80 });
  assert.equal(averageResult.total, 80);
  assert.equal(averageResult.entries[1].imputed, true);
});

test("识别补齐后可单独跨越等级边界的关键维度", () => {
  const result = engine.evaluate(scheme(), { a: 98, b: 70 });
  assert.equal(result.nextGrade, "优秀");
  const blocker = result.blockers.find((item) => item.id === "b");
  assert.equal(blocker.canCrossAlone, true);
  const text = narration.buildNarration(result, scheme()).lines.join("");
  assert.match(text, /触发降级的关键维度/);
  assert.match(text, /B/);
});

test("权重调整后可检测总评等级变化", () => {
  const before = engine.evaluate(scheme(), { a: 92, b: 50 });
  const changed = scheme({ weights: { a: 20, b: 80 } });
  const after = engine.evaluate(changed, { a: 92, b: 50 });
  assert.equal(before.total, 75.2);
  assert.equal(engine.round(after.total, 1), 58.4);
  const comparison = narration.compareOutcomes(before, after);
  assert.equal(comparison.changed, true);
  assert.equal(comparison.upward, false);
  assert.match(comparison.text, /合格.*复训/);
});

test("调整任一权重时整数化并始终保持合计 100", () => {
  assert.deepEqual(
    schema.allocateIntegerWeights({ a: 60, b: 40 }, "a", 70),
    { a: 70, b: 30 }
  );
  const three = schema.allocateIntegerWeights({ a: 50, b: 30, c: 20 }, "a", 33);
  assert.equal(Object.values(three).reduce((sum, value) => sum + value, 0), 100);
  assert.deepEqual(three, { a: 33, b: 40, c: 27 });
});

test("默认方案通过校验", () => {
  assert.equal(schema.validateScheme(schema.defaultScheme()).valid, true);
});
