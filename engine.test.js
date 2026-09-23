const test = require("node:test");
const assert = require("node:assert/strict");
const { FormDeduction } = require("./engine");

const fields = [
  { id: "a", label: "A", required: true, acceptedInputs: ["keyboard", "voice"] },
  { id: "b", label: "B", type: "email", required: true, dependencies: ["a"], acceptedInputs: ["keyboard", "paste"] },
  { id: "c", label: "C", required: false, dependencies: ["b"], acceptedInputs: ["keyboard"] }
];

test("agreed events produce one trusted current value and source", () => {
  const engine = new FormDeduction({
    fields,
    events: [
      { id: "a1", fieldId: "a", source: "keyboard", raw: "hello", sequence: 1 },
      { id: "a2", fieldId: "a", source: "voice", raw: " hello ", sequence: 2 }
    ]
  });
  const result = engine.getResult("a");
  assert.equal(result.status, "ready");
  assert.equal(result.value, "hello");
  assert.equal(result.canConfirm, true);
  assert.equal(result.rawAttempts.length, 2);
});

test("contradicting valid events retain both sources and require adjudication", () => {
  const engine = new FormDeduction({
    fields,
    events: [
      { id: "a1", fieldId: "a", source: "keyboard", raw: "one", sequence: 1 },
      { id: "a2", fieldId: "a", source: "voice", raw: "two", sequence: 2 }
    ]
  });
  const result = engine.getResult("a");
  assert.equal(result.status, "conflict");
  assert.equal(result.canConfirm, false);
  assert.deepEqual(result.issues[0].eventIds.sort(), ["a1", "a2"]);
  assert.deepEqual(result.issues[0].sources.sort(), ["keyboard", "voice"]);

  engine.adjudicate("a", { mode: "event", selectedEventId: "a1", at: 3 });
  const resolved = engine.getResult("a");
  assert.equal(resolved.value, "one");
  assert.equal(resolved.canConfirm, true);
  assert.deepEqual(resolved.evidence.rejectedEvents, ["a2"]);
});

test("a later event invalidates an existing adjudication but preserves the old decision reason", () => {
  const engine = new FormDeduction({ fields, events: [{ id: "a1", fieldId: "a", source: "keyboard", raw: "one", sequence: 1 }] });
  engine.adjudicate("a", { mode: "custom", raw: "manual", at: 2, reason: "manual fix" });
  engine.addEvent({ fieldId: "a", source: "voice", raw: "later" });
  const result = engine.getResult("a");
  assert.equal(result.status, "conflict");
  assert.equal(result.staleDecision.reason, "manual fix");
});

test("format failures are attributed to the exact event and source", () => {
  const engine = new FormDeduction({ fields, events: [{ id: "b1", fieldId: "b", source: "keyboard", raw: "bad-email", sequence: 1 }] });
  const a = engine.getResult("a");
  const b = engine.getResult("b");
  assert.equal(a.canConfirm, false);
  assert.equal(b.status, "blocked");
  engine.addEvent({ fieldId: "a", source: "keyboard", raw: "ok" });
  const invalid = engine.getResult("b");
  assert.equal(invalid.status, "invalid");
  assert.equal(invalid.issues.find((x) => x.code === "invalid_input").eventIds[0], "b1");
});

test("unsupported input is explicitly untrusted and does not silently win", () => {
  const engine = new FormDeduction({ fields, events: [
    { id: "a1", fieldId: "a", source: "keyboard", raw: "ok", sequence: 1 },
    { id: "b1", fieldId: "b", source: "keyboard", raw: "x@example.com", sequence: 2 },
    { id: "b2", fieldId: "b", source: "voice", raw: "voice@example.com", sequence: 3 }
  ]});
  const result = engine.getResult("b");
  assert.equal(result.status, "unsupported");
  assert.equal(result.trusted, false);
  assert.equal(result.value, "x@example.com");
  assert.deepEqual(result.issues[0].sources, ["voice"]);
});

test("a disabled client input capability is retained but marked unavailable", () => {
  const engine = new FormDeduction({
    fields: [{ id: "a", acceptedInputs: ["keyboard", "voice"] }],
    events: [{ id: "a1", fieldId: "a", source: "voice", raw: "spoken", sequence: 1 }],
    capabilities: { voice: false }
  });
  const result = engine.getResult("a");
  assert.equal(result.status, "unavailable");
  assert.equal(result.trusted, false);
  assert.equal(result.issues[0].code, "input_unavailable");
  assert.equal(result.rawAttempts[0].raw, "spoken");
});

test("missing dependency and dependency cycles are surfaced as untrusted conclusions", () => {
  const engine = new FormDeduction({
    fields: [
      { id: "x", dependencies: ["missing", "y"] },
      { id: "y", dependencies: ["z"] },
      { id: "z", dependencies: ["y"] }
    ]
  });
  assert.equal(engine.getResult("x").status, "blocked");
  assert.ok(engine.getResult("x").dependencyIssues.some((i) => i.code === "missing_dependency"));
  assert.equal(engine.getResult("y").status, "cycle");
  assert.equal(engine.getResult("z").status, "cycle");
  assert.equal(engine.getResult("y").trusted, false);
});

test("shared prerequisites in a diamond dependency are not misreported as a cycle", () => {
  const engine = new FormDeduction({
    fields: [
      { id: "root", dependencies: [], required: false },
      { id: "left", dependencies: ["root"], required: false },
      { id: "right", dependencies: ["root"], required: false },
      { id: "leaf", dependencies: ["left", "right"], required: false }
    ]
  });
  ["root", "left", "right", "leaf"].forEach((id) => {
    assert.notEqual(engine.getResult(id).status, "cycle");
    assert.equal(engine.getResult(id).trusted, true);
    assert.equal(engine.getResult(id).canConfirm, true);
  });
});

test("dependency changes recompute affected fields with the same result as a full recompute", () => {
  const engine = new FormDeduction({ fields: [
    { id: "a", acceptedInputs: ["keyboard"] },
    { id: "b", dependencies: [], acceptedInputs: ["keyboard"] },
    { id: "c", dependencies: ["a"], required: false, acceptedInputs: ["keyboard"] }
  ], events: [
    { id: "a1", fieldId: "a", source: "keyboard", raw: "A", sequence: 1 },
    { id: "b1", fieldId: "b", source: "keyboard", raw: "B", sequence: 2 }
  ]});
  engine.updateField("c", { dependencies: ["b"] });
  const incremental = simplify(engine.getState().results);
  engine.recompute();
  const full = simplify(engine.getState().results);
  assert.deepEqual(incremental, full);
  assert.equal(engine.getResult("c").blockedBy.length, 0);

  engine.updateField("b", { dependencies: ["a"] });
  const chained = simplify(engine.getState().results);
  engine.recompute();
  assert.deepEqual(chained, simplify(engine.getState().results));
});

test("incremental event and user correction sequence remains consistent with full recompute", () => {
  const engine = new FormDeduction({
    fields: [
      { id: "a", acceptedInputs: ["keyboard", "voice"] },
      { id: "b", dependencies: ["a"], required: false, acceptedInputs: ["keyboard"] }
    ]
  });
  engine.addEvent({ fieldId: "a", source: "keyboard", raw: "first" });
  engine.addEvent({ fieldId: "a", source: "voice", raw: "second" });
  engine.adjudicate("a", { mode: "event", selectedEventId: engine.getState().events[0].id });
  engine.addEvent({ fieldId: "b", source: "keyboard", raw: "child" });
  const incremental = simplify(engine.getState().results);
  engine.recompute();
  assert.deepEqual(incremental, simplify(engine.getState().results));
  assert.equal(engine.getResult("a").value, "first");
  assert.equal(engine.getResult("b").value, "child");
});

test("a clear event removes prior errors and prior values from the current conclusion", () => {
  const engine = new FormDeduction({
    fields: [{ id: "a", type: "email", required: true, acceptedInputs: ["keyboard"] }],
    events: [
      { id: "bad", fieldId: "a", source: "keyboard", raw: "not-mail", sequence: 1 },
      { id: "cleared", fieldId: "a", source: "keyboard", action: "clear", raw: "", sequence: 2 }
    ]
  });
  assert.equal(engine.getResult("a").status, "required");
  assert.deepEqual(engine.getResult("a").issues.map((x) => x.code), ["required"]);
});

function simplify(results) {
  return Object.fromEntries(Object.entries(results).map(([id, result]) => [id, {
    value: result.value,
    status: result.status,
    trusted: result.trusted,
    canConfirm: result.canConfirm,
    blockedBy: result.blockedBy,
    issues: result.issues.map((i) => i.code),
    dependencyIssues: result.dependencyIssues.map((i) => i.code)
  }]));
}
