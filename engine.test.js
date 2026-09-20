import test from "node:test";
import assert from "node:assert/strict";
import { createState, registerDevice, addEvent, resolveConflict, correctRecord, recompute, STATUS } from "./engine.js";
const ev = (id, event) => ({ id, ...event });

test("conflicting duplicate values are retained and force untrusted", () => {
  const state = createState();
  registerDevice(state, "P1", { defaultPolicy: { mode: "count", count: 3 } });
  const t = Date.parse("2026-09-21T01:00:00Z");
  addEvent(state, ev("s1", { type: "sample", deviceId: "P1", seq: 1, sampleAt: t, receivedAt: t + 1000, value: 10 }));
  addEvent(state, ev("s2", { type: "sample", deviceId: "P1", seq: 3, sampleAt: t + 20000, receivedAt: t + 2000, value: 30 }));
  addEvent(state, ev("s3", { type: "sample", deviceId: "P1", seq: 1, sampleAt: t, receivedAt: t + 3000, value: 11 }));
  const batch = state.lastPush.snapshot.batches[0];
  assert.equal(batch.status, STATUS.UNTRUSTED);
  assert.equal(batch.slots.find(s => s.seq === 1).duplicateRecordIds.length, 2);
  assert.equal(state.lastPush.snapshot.conflicts[0].status, "open");
});

test("resolution changes batch; backfill reaches complete", () => {
  const state = createState();
  registerDevice(state, "P1", { defaultPolicy: { mode: "count", count: 3 } });
  const t = Date.parse("2026-09-21T02:00:00Z");
  addEvent(state, ev("s1", { type: "sample", deviceId: "P1", seq: 1, sampleAt: t, receivedAt: t + 1000, value: 10 }));
  addEvent(state, ev("s2", { type: "sample", deviceId: "P1", seq: 3, sampleAt: t + 20000, receivedAt: t + 2000, value: 30 }));
  addEvent(state, ev("s3", { type: "sample", deviceId: "P1", seq: 1, sampleAt: t, receivedAt: t + 3000, value: 11 }));
  resolveConflict(state, { deviceId: "P1", seq: 1, resolution: "a", at: t + 4000 });
  let batch = state.lastPush.snapshot.batches[0];
  assert.equal(batch.status, STATUS.PARTIAL);
  assert.equal(batch.missingCount, 1);
  addEvent(state, ev("s4", { type: "sample", deviceId: "P1", seq: 2, sampleAt: t + 10000, receivedAt: t + 5000, value: 20 }));
  batch = state.lastPush.snapshot.batches[0];
  assert.equal(batch.status, STATUS.COMPLETE);
  assert.equal(batch.deliveredCount, 3);
});

test("disconnect marks physical batch and recommends next sequence", () => {
  const state = createState();
  registerDevice(state, "P2", { defaultPolicy: { mode: "count", count: 5 } });
  const t = Date.parse("2026-09-21T03:00:00Z");
  for (const seq of [1, 2, 3]) addEvent(state, ev(`s${seq}`, { type: "sample", deviceId: "P2", seq, sampleAt: t + seq * 1000, receivedAt: t + seq * 1000 + 500, value: seq }));
  addEvent(state, ev("d1", { type: "connection", deviceId: "P2", at: t + 4000, status: "disconnected", reason: "offline" }));
  addEvent(state, ev("c1", { type: "connection", deviceId: "P2", at: t + 30000, status: "connected" }));
  const resume = state.lastPush.snapshot.resume[0];
  assert.equal(resume.anchorSeq, 3);
  assert.equal(resume.resumeSeq, 4);
  const batch = state.lastPush.snapshot.batches[0];
  assert.equal(batch.status, STATUS.PARTIAL);
  assert.equal(batch.interruptedBy, "d1");
});

test("count threshold change closes old physical batch and starts a new one", () => {
  const state = createState();
  registerDevice(state, "P3", { defaultPolicy: { mode: "count", count: 2 } });
  const t = Date.parse("2026-09-21T04:00:00Z");
  for (let seq = 1; seq <= 4; seq += 1) {
    addEvent(state, ev(`s${seq}`, { type: "sample", deviceId: "P3", seq, sampleAt: t + seq * 1000, receivedAt: t + seq * 1000, value: seq }));
  }
  addEvent(state, ev("p1", { type: "policy", deviceId: "P3", at: t + 4500, mode: "count", count: 3 }));
  for (let seq = 5; seq <= 7; seq += 1) {
    addEvent(state, ev(`s${seq}`, { type: "sample", deviceId: "P3", seq, sampleAt: t + seq * 1000, receivedAt: t + seq * 1000, value: seq }));
  }
  const batches = state.lastPush.snapshot.batches;
  assert.deepEqual(batches.map(b => [b.startSeq, b.endSeq]), [[1, 2], [3, 4], [5, 7]]);
  assert.deepEqual(state.lastPush.changedBatchIds, [batches[2].id]);
});

test("correction reassigns sequence slot and invalid record remains explicit", () => {
  const state = createState();
  registerDevice(state, "P4", {
    defaultPolicy: { mode: "time", windowMs: 60000 },
    expectedIntervalMs: 10000
  });
  const t = Date.parse("2026-09-21T05:00:00Z");
  addEvent(state, ev("s1", { type: "sample", deviceId: "P4", seq: 1, sampleAt: t + 5000, receivedAt: t + 6000, value: 1 }));
  addEvent(state, ev("s3", { type: "sample", deviceId: "P4", seq: 3, sampleAt: t + 65000, receivedAt: t + 66000, value: 3 }));
  addEvent(state, ev("bad", { type: "sample", deviceId: "P4", seq: "bad", sampleAt: t, receivedAt: t, value: 9 }));
  assert.equal(state.lastPush.snapshot.unassignable.some(u => u.recordId === "bad"), true);
  correctRecord(state, { recordId: "s3", sampleAt: t + 25000, at: t + 90000 });
  const first = state.lastPush.snapshot.batches.find(b => b.slots.some(s => s.seq === 3));
  assert.equal(first.slots.some(s => s.seq === 2 && s.status === "missing"), true);
  assert.ok(first.evidence.some(e => e.kind === "correction"));
  const full = createState();
  full.events = state.events.map(e => ({ ...e }));
  full.devices = structuredClone(state.devices);
  full.deviceExpectedIntervalMs = structuredClone(state.deviceExpectedIntervalMs);
  recompute(full);
  assert.equal(JSON.stringify(full.batches), JSON.stringify(state.batches));
});

test("custom adjudication value becomes the accepted canonical value", () => {
  const state = createState();
  registerDevice(state, "P5", { defaultPolicy: { mode: "count", count: 1 } });
  const t = Date.parse("2026-09-21T06:00:00Z");
  addEvent(state, ev("x1", { type: "sample", deviceId: "P5", seq: 1, sampleAt: t, receivedAt: t, value: 1 }));
  addEvent(state, ev("x2", { type: "sample", deviceId: "P5", seq: 1, sampleAt: t, receivedAt: t + 1000, value: 2 }));
  resolveConflict(state, { deviceId: "P5", seq: 1, resolution: "custom", value: 42, at: t + 2000 });
  assert.equal(state.batches[0].slots[0].delivered.value, 42);
  assert.deepEqual(state.batches[0].slots[0].duplicateRecordIds, ["x1", "x2"]);
  assert.equal(state.batches[0].status, STATUS.COMPLETE);
});
