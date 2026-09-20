const test = require("node:test");
const assert = require("node:assert/strict");
const {
  analyzeFlow,
  createIncrementalAnalyzer,
} = require("../src/analyzer.js");

const definition = {
  name: "Keyboard checkout",
  steps: [
    {
      id: "account",
      name: "Account",
      controls: [
        { id: "email", type: "textbox", label: "Email" },
        { id: "continue", type: "button", label: "Continue" },
      ],
      completion: { mode: "all", controls: ["email", "continue"] },
    },
    {
      id: "delivery",
      name: "Delivery",
      controls: [
        { id: "method", type: "radio", label: "Standard delivery" },
        { id: "confirm", type: "checkbox", label: "Confirm delivery" },
      ],
      completion: { mode: "all", controls: ["method", "confirm"] },
    },
    {
      id: "payment",
      name: "Payment",
      controls: [
        { id: "card", type: "textbox", label: "Card number" },
        { id: "pay", type: "button", label: "Pay" },
      ],
      completion: { mode: "all", controls: ["card", "pay"] },
    },
  ],
};

test("derives sequential path and blocks successors until predecessor is completed", () => {
  const analysis = analyzeFlow(definition);
  assert.equal(analysis.steps[0].enterable, true);
  assert.equal(analysis.steps[1].enterable, false);
  assert.match(analysis.steps[1].blockedReasons[0], /Account/);
  assert.deepEqual(analysis.firstBlockedStep, 1);
});

test("opens a later step after its predecessor completion is recorded", () => {
  const session = {
    steps: {
      account: { values: { email: "a@example.com" }, actions: ["continue"] },
    },
  };
  const analysis = analyzeFlow(definition, session);
  assert.equal(analysis.steps[0].completed, true);
  assert.equal(analysis.steps[1].enterable, true);
  assert.equal(analysis.steps[2].enterable, false);
});

test("identifies missing labels, focus traps, and order cycles", () => {
  const broken = {
    steps: [
      {
        id: "trapped",
        name: "Trapped",
        order: ["open", "unlabeled", "save"],
        controls: [
          { id: "open", type: "button", label: "Open custom editor", trap: true },
          { id: "unlabeled", type: "textbox" },
          { id: "save", type: "button", label: "Save" },
        ],
        completion: { mode: "all", controls: ["unlabeled", "save"] },
      },
      {
        id: "cycle",
        name: "Cycle",
        relations: [{ from: "a", to: "b" }],
        controls: [
          { id: "a", type: "button", label: "A", after: "b" },
          { id: "b", type: "button", label: "B" },
        ],
        completion: { mode: "all", controls: ["a", "b"] },
      },
    ],
  };
  const analysis = analyzeFlow(broken);
  const first = analysis.steps[0].structure;
  assert.deepEqual(first.missingLabelControlIds, ["unlabeled"]);
  assert.deepEqual(first.trapControlIds, ["open"]);
  assert.equal(first.unreachableControls.some((item) => item.id === "unlabeled"), true);
  assert.deepEqual(analysis.steps[1].structure.orderConflictControlIds.sort(), ["a", "b"]);
});

test("a skip ruling releases the next step while keeping its conclusion marked as ruling", () => {
  const rulings = { delivery: { skipped: true } };
  const session = {
    steps: {
      account: { values: { email: "a@example.com" }, actions: ["continue"] },
    },
  };
  const analysis = analyzeFlow(definition, session, rulings);
  assert.equal(analysis.steps[1].completed, true);
  assert.equal(analysis.steps[1].completionBasis, "ruling");
  assert.equal(analysis.steps[2].enterable, true);
});

test("forced entry exposes a blocked step but does not classify it as derived reachable", () => {
  const rulings = { delivery: { forced: true } };
  const analysis = analyzeFlow(definition, undefined, rulings);
  assert.equal(analysis.steps[1].enterable, true);
  assert.equal(analysis.steps[1].naturallyEnterable, false);
  assert.equal(analysis.steps[1].pathConclusion, "forced-entry");
  assert.equal(analysis.steps[1].entryBasis, "ruling");
  assert.equal(analysis.steps[2].enterable, false);
});

test("a skipped broken step does not release a later natural path", () => {
  const broken = {
    steps: [
      {
        id: "broken",
        controls: [{ id: "nameless", type: "textbox" }],
        completion: { mode: "all", controls: ["nameless"] },
      },
      {
        id: "after",
        controls: [{ id: "ok", type: "checkbox", label: "OK" }],
        completion: { mode: "all", controls: ["ok"] },
      },
    ],
  };
  const analysis = analyzeFlow(broken, undefined, { broken: { skipped: true } });
  assert.equal(analysis.steps[0].completed, true);
  assert.equal(analysis.steps[0].effectivePathReachable, false);
  assert.equal(analysis.steps[1].naturallyEnterable, false);
  assert.equal(analysis.steps[1].effectivePathReachable, false);
});

test("optional controls with missing labels remain visible defects without blocking required completion", () => {
  const definition = {
    steps: [{
      id: "optional-label",
      controls: [
        { id: "required", type: "checkbox", label: "Required" },
        { id: "optional-note", type: "textbox", optional: true },
      ],
      completion: { mode: "all", controls: ["required"] },
    }],
  };
  const analysis = analyzeFlow(definition, {
    steps: { "optional-label": { values: { required: true } } },
  });
  assert.equal(analysis.steps[0].completed, true);
  assert.equal(analysis.steps[0].definitionBlocked, false);
  assert.deepEqual(analysis.steps[0].structure.missingLabelControlIds, ["optional-note"]);
});

test("a none completion condition is satisfied only when referenced controls are inactive", () => {
  const definition = {
    steps: [{
      id: "none-mode",
      controls: [{ id: "opt-out", type: "checkbox", label: "Opt out" }],
      completion: { mode: "none", controls: ["opt-out"] },
    }],
  };
  assert.equal(analyzeFlow(definition).steps[0].completed, true);
  assert.equal(analyzeFlow(definition, {
    steps: { "none-mode": { values: { "opt-out": true } } },
  }).steps[0].completed, false);
});

test("incremental recomputation matches a full derivation", () => {
  const engine = createIncrementalAnalyzer();
  engine.analyze(definition);
  const changed = JSON.parse(JSON.stringify(definition));
  changed.steps[1].controls[0].label = "Pickup delivery";
  const incremental = engine.analyze(changed, undefined, undefined, { fromIndex: 1 });
  const full = analyzeFlow(changed);
  assert.deepEqual(incremental.incremental.recomputedIndexes, [1, 2]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(incremental, (key, value) =>
      key === "incremental" ? undefined : value)),
    JSON.parse(JSON.stringify(full))
  );
});
