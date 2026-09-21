const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeActivity } = require("../js/engine.js");

const fixedNow = "2026-09-22T08:00:00.000Z";

test("跨活动依赖被显式标记为不可信，而不是静默忽略", () => {
  const state = {
    activities: [{ id: "a1", name: "活动一" }],
    entries: [
      {
        id: "a1-entry",
        activityId: "a1",
        type: "todo",
        title: "活动一待办",
        status: "active",
        dependsOn: ["a2-entry"],
        updatedAt: fixedNow
      },
      {
        id: "a2-entry",
        activityId: "a2",
        type: "material",
        title: "活动二素材",
        status: "active",
        dependsOn: [],
        updatedAt: fixedNow
      }
    ],
    conflicts: []
  };

  const result = analyzeActivity(state, "a1", fixedNow);
  assert.equal(result.status, "untrusted");
  assert.deepEqual(result.issues.map((issue) => issue.code), ["cross-activity-dependency"]);
  assert.ok(result.untrustedEntryIds.includes("a1-entry"));
});

test("已过时效的上下文仍保留在续接线索中，但提示先复核", () => {
  const state = {
    activities: [{ id: "a1", name: "活动一" }],
    entries: [
      {
        id: "stale-material",
        activityId: "a1",
        type: "material",
        title: "旧版报价单",
        source: "共享文件夹",
        status: "active",
        expiresAt: "2026-09-22T07:00:00.000Z",
        updatedAt: "2026-09-22T06:00:00.000Z",
        dependsOn: []
      }
    ],
    conflicts: []
  };

  const result = analyzeActivity(state, "a1", fixedNow);
  assert.equal(result.status, "ready");
  assert.equal(result.resume[0].freshness, "已过期，需先复核");
  assert.match(result.resume[0].action, /先复核时效/);
});
