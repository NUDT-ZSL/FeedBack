const test = require("node:test");
const assert = require("node:assert/strict");
const { ResumeEngine, recomputeAll } = require("../js/engine.js");
const createSeedState = require("../js/seed.js");

const fixedNow = "2026-09-22T08:00:00.000Z";

test("时效和依赖共同决定可恢复活动的续接顺序", () => {
  const state = createSeedState(fixedNow);
  const result = new ResumeEngine().analyze(state, "a-launch", fixedNow);

  assert.equal(result.status, "ready");
  assert.equal(result.trusted, true);
  assert.ok(result.resume);
  assert.deepEqual(
    result.resume.map((step) => step.entryId),
    ["e-launch-material", "e-launch-todo", "e-launch-progress"]
  );
  assert.equal(result.resume[1].dependencyTitles[0], "新版功能截图包");
});

test("未裁决冲突保留双方，并且不输出续接结论", () => {
  const state = createSeedState(fixedNow);
  const result = new ResumeEngine().analyze(state, "a-research", fixedNow);

  assert.equal(result.status, "blocked");
  assert.equal(result.trusted, true);
  assert.equal(result.canResume, false);
  assert.equal(result.resume, null);
  assert.equal(result.openConflictCount, 1);
  assert.deepEqual(result.blockedEntryIds.sort(), ["e-interview-a", "e-interview-b"]);
  const titles = result.entries.map((entry) => entry.title);
  assert.ok(titles.includes("访谈口径：导出 PDF 最常用"));
  assert.ok(titles.includes("访谈口径：只需要 Markdown"));
});

test("缺失依赖和闭环会显式标记活动与涉及条目不可信", () => {
  const state = createSeedState(fixedNow);
  const result = new ResumeEngine().analyze(state, "a-integration", fixedNow);

  assert.equal(result.status, "untrusted");
  assert.equal(result.trusted, false);
  assert.equal(result.canResume, false);
  assert.deepEqual(result.untrustedEntryIds.sort(), ["e-integration-progress", "e-integration-todo"]);
  const codes = result.issues.map((issue) => issue.code);
  assert.ok(codes.includes("missing-dependency"));
  assert.ok(codes.includes("dependency-cycle"));
  assert.ok(result.issues.every((issue) => issue.involvedEntryIds.length > 0));
});

test("裁决冲突后保留原条目，但只有有效条目参与续接", () => {
  const state = createSeedState(fixedNow);
  const result = new ResumeEngine().analyze(state, "a-resolved", fixedNow);

  assert.equal(result.status, "ready");
  assert.deepEqual(
    result.resume.map((step) => step.entryId),
    ["e-weekly-b", "e-weekly-todo"]
  );
  const superseded = result.entries.find((entry) => entry.id === "e-weekly-a");
  assert.equal(superseded.status, "superseded");
  assert.equal(superseded.auditState, "superseded");
});

test("修正后只重推受影响活动，且结果与整体重推一致", () => {
  const state = createSeedState(fixedNow);
  const engine = new ResumeEngine();
  const original = new Map(state.activities.map((activity) => [
    activity.id,
    engine.analyze(state, activity.id, fixedNow)
  ]));
  const baselineCount = engine.computeCount;

  const target = state.entries.find((entry) => entry.id === "e-launch-material");
  target.expiresAt = "2026-09-22T07:30:00.000Z";
  target.updatedAt = "2026-09-22T07:59:00.000Z";
  const affected = engine.invalidateEntries(state, ["e-launch-material"]);

  assert.deepEqual(affected, ["a-launch"]);
  const incremental = new Map();
  state.activities.forEach((activity) => {
    incremental.set(activity.id, engine.analyze(state, activity.id, fixedNow));
  });
  assert.equal(engine.computeCount, baselineCount + 1);

  const full = recomputeAll(state, fixedNow);
  for (const activity of state.activities) {
    assert.deepEqual(incremental.get(activity.id), full.get(activity.id));
  }
  assert.equal(original.get("a-launch").resume[0].entryId, "e-launch-material");
  assert.equal(incremental.get("a-launch").resume[0].freshness, "已过期，需先复核");
});
