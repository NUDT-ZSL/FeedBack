const test = require("node:test");
const assert = require("node:assert/strict");
const schema = require("../js/schema.js");

test("不同满分维度可按百分制并入总评", () => {
  const base = {
    name: "非百分制",
    overallBands: [
      { grade: "合格", min: 60 },
      { grade: "复训", min: 0 }
    ],
    dimensions: [
      { id: "a", name: "A", maxScore: 50, missingPolicy: "prorate",
        levels: [{ grade: "高", min: 60 }, { grade: "低", min: 0 }] },
      { id: "b", name: "B", maxScore: 100, missingPolicy: "zero",
        levels: [{ grade: "高", min: 60 }, { grade: "低", min: 0 }] }
    ],
    weights: { a: 50, b: 50 }
  };
  const engine = require("../js/engine.js");
  const result = engine.evaluate(base, { a: 40, b: 80 });
  assert.equal(result.entries[0].effectiveRaw, 80);
  assert.equal(result.total, 80);
});

test("从零权重维度分出权重时保持总和 100", () => {
  assert.deepEqual(
    schema.allocateIntegerWeights({ a: 100, b: 0 }, "b", 20),
    { a: 80, b: 20 }
  );
});
