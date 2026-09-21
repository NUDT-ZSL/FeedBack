// End-to-end test of the offline sync protocol against a running server.
// Run: node test/e2e.js   (server must be listening on :3000)
const BASE = "http://localhost:3000";

async function api(path, body) {
  const res = await fetch(BASE + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(path + " -> " + res.status);
  return res.json();
}

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS  " + name);
  else {
    failures++;
    console.log("FAIL  " + name + (extra ? "  " + JSON.stringify(extra) : ""));
  }
}

(async () => {
  await api("/api/reset", {});
  const init = await api("/api/workorders");
  const wo = init.workorders.find((w) => w.id === "WO-1001");

  // 1. offline edits: title twice, assignee once, body once
  const ops = [
    { seq: 1, workorderId: "WO-1001", field: "title", oldValue: wo.title, newValue: "标题改A" },
    { seq: 2, workorderId: "WO-1001", field: "title", oldValue: "标题改A", newValue: "标题改B" },
    { seq: 3, workorderId: "WO-1001", field: "assignee", oldValue: wo.assignee, newValue: "王强" },
    { seq: 4, workorderId: "WO-1001", field: "body", oldValue: wo.body, newValue: "正文补充：已更换轴承" },
  ];

  // 2. meanwhile another terminal changes title on the server
  await api("/api/server-edit", {
    workorderId: "WO-1001",
    field: "title",
    value: "标题（服务端复核版）",
  });

  // 3. reconnect: submit ops in order
  const sync = await api("/api/sync", { ops });
  const byField = Object.fromEntries(sync.results.map((r) => [r.field, r]));

  check("title collapses to final intent", byField.title.newValue === "标题改B" && byField.title.opCount === 2);
  check("title conflicts with server change", byField.title.status === "conflict");
  check("assignee applies safely", byField.assignee.status === "applied");
  check("body applies safely", byField.body.status === "applied");

  const after = sync.workorders.find((w) => w.id === "WO-1001");
  check("assignee persisted", after.assignee === "王强");
  check("body persisted", after.body === "正文补充：已更换轴承");
  check("conflicted title untouched", after.title === "标题（服务端复核版）");
  check("version bumped once", after.version === wo.version + 2); // 1 server-edit + 1 sync
  check("conflict payload carries both sides",
    sync.conflicts.length === 1 &&
    sync.conflicts[0].localValue === "标题改B" &&
    sync.conflicts[0].serverValue === "标题（服务端复核版）");

  // 4. arbitrate: manual merge for title
  const res = await api("/api/resolve", {
    decisions: [{
      workorderId: "WO-1001",
      field: "title",
      value: "标题改B + 服务端复核",
      expectedServerValue: "标题（服务端复核版）",
    }],
  });
  check("resolution applied", res.applied[0].status === "resolved");
  const final = res.workorders.find((w) => w.id === "WO-1001");
  check("manual merge persisted", final.title === "标题改B + 服务端复核");
  check("unrelated fields kept", final.assignee === "王强" && final.body === "正文补充：已更换轴承");

  // 5. stale guard: resolve against an outdated server value
  const stale = await api("/api/resolve", {
    decisions: [{
      workorderId: "WO-1001",
      field: "title",
      value: "过期裁决",
      expectedServerValue: "不存在的旧值",
    }],
  });
  check("stale resolution rejected", stale.applied[0].status === "stale");

  // 6. no-op detection: submit value identical to server
  const noop = await api("/api/sync", {
    ops: [{ seq: 9, workorderId: "WO-1001", field: "assignee", oldValue: "张伟", newValue: "王强" }],
  });
  check("identical value is a no-op", noop.results[0].status === "noop");

  console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
