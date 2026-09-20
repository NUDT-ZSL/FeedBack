import { createState, registerDevice, addEvent } from "./engine.js";

const minute = 60_000;

export function createDemoState() {
  const state = createState();
  registerDevice(state, "PUMP-A", {
    name: "一号注聚泵",
    defaultPolicy: { mode: "count", count: 4 },
    expectedIntervalMs: 10_000
  });
  registerDevice(state, "TEMP-B", {
    name: "井口温度仪",
    defaultPolicy: { mode: "time", windowMs: minute },
    expectedIntervalMs: 10_000
  });

  const t0 = Date.parse("2026-09-21T08:00:00+08:00");
  const samplesA = [
    ["a01", 1, 0, 18.1],
    ["a02", 2, 10_000, 18.2],
    ["a03", 3, 20_000, 18.3],
    ["a04", 4, 30_000, 18.4],
    ["a05", 5, 40_000, 18.5],
    ["a06", 6, 50_000, 18.6],
    ["a07", 6, 50_000, 19.6],
    ["a08", 8, 70_000, 18.8]
  ];
  for (const [id, seq, offset, value] of samplesA) {
    addEvent(state, {
      id,
      type: "sample",
      deviceId: "PUMP-A",
      seq,
      sampleAt: t0 + offset,
      receivedAt: t0 + offset + 1000,
      value,
      source: "离线演示流"
    });
  }
  addEvent(state, {
    id: "a-disconnect",
    type: "connection",
    deviceId: "PUMP-A",
    at: t0 + 72_000,
    status: "disconnected",
    reason: "井口网关信号丢失"
  });
  addEvent(state, {
    id: "a-reconnect",
    type: "connection",
    deviceId: "PUMP-A",
    at: t0 + 180_000,
    status: "connected",
    reason: "人工恢复网关"
  });
  addEvent(state, {
    id: "a-policy",
    type: "policy",
    deviceId: "PUMP-A",
    at: t0 + 190_000,
    mode: "count",
    count: 3,
    note: "恢复后改为每 3 条一批"
  });
  for (const [id, seq, offset, value] of [["a09", 9, 195000, 18.9], ["a10", 10, 205000, 19.0]]) {
    addEvent(state, {
      id, type: "sample", deviceId: "PUMP-A", seq,
      sampleAt: t0 + offset,
      receivedAt: t0 + offset + 1000,
      value,
      source: "续采补传"
    });
  }

  const b0 = Date.parse("2026-09-21T09:00:00+08:00");
  for (const [id, seq, offset, value] of [
    ["b01", 1, 5000, 61.2],
    ["b02", 2, 15_000, 61.3],
    ["b03", 3, 25_000, 61.4],
    ["b04", 4, 35_000, 61.5],
    ["b05", 6, 65_000, 61.7],
    ["b06", 7, 75_000, 61.8]
  ]) {
    addEvent(state, {
      id, type: "sample", deviceId: "TEMP-B", seq,
      sampleAt: b0 + offset,
      receivedAt: b0 + offset + 1000,
      value,
      source: "时间窗演示流"
    });
  }
  addEvent(state, {
    id: "b-disconnect",
    type: "connection",
    deviceId: "TEMP-B",
    at: b0 + 85_000,
    status: "disconnected",
    reason: "采集链路抖动"
  });
  addEvent(state, {
    id: "b-reconnect",
    type: "connection",
    deviceId: "TEMP-B",
    at: b0 + 150_000,
    status: "connected",
    reason: "链路自动恢复"
  });
  addEvent(state, {
    id: "bad-time",
    type: "sample",
    deviceId: "TEMP-B",
    seq: "不是序号",
    sampleAt: b0,
    receivedAt: b0,
    value: 0,
    source: "坏记录"
  });
  return state;
}
