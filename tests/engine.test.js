const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../engine.js");

function model(overrides = {}) {
  const base = {
    resources: [
      { id: "drill", initialStock: 0 },
      { id: "motor", initialStock: 2 },
      { id: "gear", initialStock: 4 },
      { id: "shaft", initialStock: 1 },
      { id: "body", initialStock: 3 },
      { id: "plate", initialStock: 10 },
      { id: "bar", initialStock: 10 },
      { id: "raw", initialStock: 1 }
    ],
    recipes: [
      { id: "r_drill", outputId: "drill", outputQty: 1, enabled: true, inputs: [
        { resourceId: "motor", qty: 1 },
        { resourceId: "gear", qty: 2 },
        { resourceId: "body", qty: 1 }
      ]},
      { id: "r_motor", outputId: "motor", outputQty: 1, enabled: true, inputs: [
        { resourceId: "shaft", qty: 2 }
      ]},
      { id: "r_gear", outputId: "gear", outputQty: 2, enabled: true, inputs: [
        { resourceId: "plate", qty: 1 }
      ]},
      { id: "r_body", outputId: "body", outputQty: 1, enabled: true, inputs: [
        { resourceId: "plate", qty: 3 }
      ]},
      { id: "r_shaft", outputId: "shaft", outputQty: 1, enabled: true, inputs: [
        { resourceId: "bar", qty: 2 }
      ]}
    ]
  };
  return { resources: base.resources, recipes: base.recipes, ...overrides };
}

test("沿层级计算需求、库存抵扣、缺口来源与放大倍数", () => {
  const result = engine.project(model(), { targetId: "drill", targetQty: 5 });
  assert.equal(result.feasible, true);
  const drill = result.groups.find((item) => item.resourceId === "drill");
  const motor = result.groups.find((item) => item.resourceId === "motor");
  const shaft = result.groups.find((item) => item.resourceId === "shaft");
  assert.equal(drill.requested, 5);
  assert.equal(drill.produced, 5);
  assert.equal(motor.requested, 5);
  assert.equal(motor.stockUsed, 2);
  assert.equal(motor.produced, 3);
  assert.equal(shaft.requested, 6);
  assert.equal(shaft.stockUsed, 1);
  assert.equal(shaft.produced, 5);
  assert.equal(shaft.amplification, 1.2);
});

test("拒绝重复标识、非正用量、未知引用和环，并指出位置", () => {
  const duplicate = engine.validateModel({
    resources: [
      { id: "a", initialStock: 1, source: "s" },
      { id: "a", initialStock: 2, source: "s" }
    ],
    recipes: [{ id: "r", outputId: "a", outputQty: 1, inputs: [{ resourceId: "a", qty: 1 }] }]
  });
  assert.equal(duplicate.valid, false);
  assert.match(duplicate.errors[0].location, /资源第 2 行/);
  const badQty = engine.validateModel({
    resources: [{ id: "a", initialStock: 1 }],
    recipes: [{ id: "r", outputId: "a", outputQty: 1, inputs: [{ resourceId: "a", qty: 0 }] }]
  });
  assert.equal(badQty.errors.some((item) => item.code === "INVALID_INPUT_QTY"), true);
  const unknown = engine.validateModel({
    resources: [{ id: "a", initialStock: 1 }],
    recipes: [{ id: "r", outputId: "a", outputQty: 1, inputs: [{ resourceId: "missing", qty: 1 }] }]
  });
  assert.deepEqual(unknown.errors[0].chain, ["r", "missing"]);
  const cycle = engine.validateModel({
    resources: [{ id: "a", initialStock: 1 }, { id: "b", initialStock: 1 }],
    recipes: [
      { id: "ra", outputId: "a", outputQty: 1, inputs: [{ resourceId: "b", qty: 1 }] },
      { id: "rb", outputId: "b", outputQty: 1, inputs: [{ resourceId: "a", qty: 1 }] }
    ]
  });
  assert.equal(cycle.errors[0].code, "CYCLE");
});

test("库存冲突保留双方且未解决时在最早层级停止", () => {
  const conflicted = model({
    resources: [
      ...model().resources
        .filter((item) => item.id !== "bar" && item.id !== "raw")
        .concat([
          { id: "raw", initialStock: 10 },
          { id: "bar", initialStock: 10, source: "warehouse" },
          { id: "bar", initialStock: 0, source: "excel" }
        ])
    ]
  });
  const result = engine.project(conflicted, { targetId: "drill", targetQty: 5 });
  assert.equal(result.feasible, false);
  assert.equal(result.earliestShortage.resourceId, "bar");
  assert.equal(result.earliestShortage.level, 3);
  assert.equal(result.conflicts.some((item) => item.id === "resource:bar"), true);
});

test("配方冲突保留双方并暂停冲突配方", () => {
  const conflicted = model({
    resources: model().resources.map((item) => item.id === "raw" ? { ...item, initialStock: 10 } : item),
    recipes: [
      ...model().recipes,
      {
        id: "r_shaft_safe",
        source: "safe",
        outputId: "shaft",
        outputQty: 1,
        inputs: [{ resourceId: "raw", qty: 1 }]
      },
      {
        id: "r_shaft",
        source: "second",
        outputId: "shaft",
        outputQty: 1,
        inputs: [{ resourceId: "bar", qty: 9 }]
      }
    ]
  });
  const result = engine.project(conflicted, { targetId: "drill", targetQty: 5 });
  assert.equal(result.feasible, true);
  assert.equal(result.conflicts[0].kind, "recipe");
  assert.equal(result.production.some((item) => item.recipeId === "r_shaft"), false);
});

test("无可补齐来源时标出最早断供，不继续把缺口视为已满足", () => {
  const noSupply = model({
    resources: [
      ...model().resources.filter((item) => item.id !== "bar"),
      { id: "bar", initialStock: 2 }
    ]
  });
  const result = engine.project(noSupply, { targetId: "drill", targetQty: 5 });
  assert.equal(result.feasible, false);
  assert.equal(result.earliestShortage.level, 3);
  assert.equal(result.earliestShortage.resourceId, "bar");
});

test("停用配方后只重推受影响节点，且与全量结果一致", () => {
  const original = model();
  const baseline = engine.projectIncremental(original, { targetId: "drill", targetQty: 5 }, null);
  assert.equal(baseline.feasible, true);
  const changed = model({
    recipes: original.recipes.map((recipe) => recipe.id === "r_shaft" ? { ...recipe, enabled: false } : recipe)
  });
  const incremental = engine.projectIncremental(changed, { targetId: "drill", targetQty: 5 }, {
    ...baseline,
    change: { recipeId: "r_shaft", reason: "配方停用" }
  });
  const full = engine.project(changed, { targetId: "drill", targetQty: 5 });
  assert.equal(incremental.feasible, false);
  assert.equal(incremental.earliestShortage.resourceId, "shaft");
  assert.deepEqual(engine.comparableProjection(incremental), engine.comparableProjection(full));
  assert.equal(incremental.stats.affectedResourceIds.includes("drill"), true);
});

test("独立上游库存修正可复用未受影响分支", () => {
  const withBranch = model({
    resources: [
      ...model().resources,
      { id: "paint", initialStock: 1 },
      { id: "pigment", initialStock: 100 }
    ],
    recipes: [
      ...model().recipes.map((recipe) => recipe.id === "r_body"
        ? { ...recipe, inputs: recipe.inputs.concat([{ resourceId: "paint", qty: 1 }]) }
        : recipe),
      { id: "r_paint", outputId: "paint", outputQty: 1, inputs: [{ resourceId: "pigment", qty: 1 }] },
    ]
  });
  const baseline = engine.projectIncremental(withBranch, { targetId: "drill", targetQty: 5 }, null);
  const changed = JSON.parse(JSON.stringify(withBranch));
  changed.resources.find((item) => item.id === "bar").initialStock = 20;
  const incremental = engine.projectIncremental(changed, { targetId: "drill", targetQty: 5 }, {
    ...baseline,
    change: { resourceIds: ["bar"], reason: "库存修正" }
  });
  const full = engine.project(changed, { targetId: "drill", targetQty: 5 });
  assert.deepEqual(engine.comparableProjection(incremental), engine.comparableProjection(full));
  assert.equal(incremental.stats.cacheHits.some((item) => item.resourceId === "body"), true);
});

test("替代配方可补齐缺口，并记录尝试路径", () => {
  const withAlternative = model();
  withAlternative.recipes = [
      ...model().recipes.filter((recipe) => recipe.id !== "r_shaft"),
      { id: "r_shaft_alt", outputId: "shaft", outputQty: 1, inputs: [{ resourceId: "raw", qty: 0.5 }] },
    ];
  withAlternative.resources = withAlternative.resources.map((item) => item.id === "raw" ? { ...item, initialStock: 10 } : item);
  const result = engine.project(withAlternative, { targetId: "drill", targetQty: 5 });
  assert.equal(result.feasible, true);
  assert.equal(result.production.some((item) => item.recipeId === "r_shaft_alt"), true);
});
