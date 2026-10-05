import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compareWithRecord,
  DEFAULT_THRESHOLDS,
  findClosestRecord,
  loadRecords,
  predictEclipse,
} from "../src/eclipse/index.ts";
import type { HistoricalRecord } from "../src/eclipse/index.ts";

function makeRecord(overrides: Partial<HistoricalRecord>): HistoricalRecord {
  return {
    id: "test-record",
    source: "测试历",
    calendarYear: 1311,
    kind: "solar",
    type: "solar-total",
    date: new Date("1311-07-24T18:00:00.000Z"),
    magnitude: 1.02,
    ...overrides,
  };
}

function totalSolarPrediction() {
  return predictEclipse({
    date: new Date("1311-07-24T18:00:00.000Z"),
    kind: "solar",
  });
}

describe("记录比对结论", () => {
  it("食分与时刻都在容差内时判定吻合", () => {
    const comparison = compareWithRecord(
      totalSolarPrediction(),
      makeRecord({}),
    );
    assert.equal(comparison.conclusion, "record-match");
    assert.equal(comparison.typeMatches, true);
    assert.ok(
      Math.abs(comparison.magnitudeDelta!) <=
        DEFAULT_THRESHOLDS.magnitudeDelta,
    );
  });

  it("食分偏差恰好等于阈值时仍判吻合（边界含端点）", () => {
    const prediction = totalSolarPrediction();
    const comparison = compareWithRecord(
      prediction,
      makeRecord({
        magnitude:
          prediction.magnitude - DEFAULT_THRESHOLDS.magnitudeDelta,
      }),
    );
    assert.equal(comparison.conclusion, "record-match");
  });

  it("食分偏差略超阈值时判定食分偏差", () => {
    const prediction = totalSolarPrediction();
    const comparison = compareWithRecord(
      prediction,
      makeRecord({
        magnitude:
          prediction.magnitude - DEFAULT_THRESHOLDS.magnitudeDelta - 1e-9,
      }),
    );
    assert.equal(comparison.conclusion, "magnitude-deviation");
  });

  it("时刻类型不一致时优先判定类型不符", () => {
    const comparison = compareWithRecord(
      totalSolarPrediction(),
      makeRecord({ type: "solar-annular", magnitude: 99 }),
    );
    assert.equal(comparison.conclusion, "type-mismatch");
    assert.equal(comparison.typeMatches, false);
  });

  it("无食事件直接给出 none-event 结论", () => {
    const prediction = predictEclipse({
      date: new Date("1335-07-15T00:00:00.000Z"),
      kind: "solar",
    });
    const comparison = compareWithRecord(prediction, makeRecord({}));
    assert.equal(comparison.conclusion, "none-event");
    assert.equal(comparison.recordId, null);
  });

  it("关联窗口之外的历史记录视为无记录", () => {
    const prediction = predictEclipse({
      date: new Date("1365-03-01T12:00:00.000Z"),
      kind: "solar",
    });
    assert.notEqual(prediction.type, "none");
    assert.equal(findClosestRecord(prediction), null);
    const comparison = compareWithRecord(prediction);
    assert.equal(comparison.conclusion, "no-record");
  });

  it("关联窗口边界：恰好 24 小时内可关联", () => {
    const prediction = totalSolarPrediction();
    const edgeDate = new Date(
      prediction.maximum.getTime() +
        DEFAULT_THRESHOLDS.associationWindowMinutes * 60_000,
    );
    const inside = findClosestRecord(
      prediction,
      [makeRecord({ date: edgeDate })],
    );
    assert.ok(inside, "窗口端点应可关联");
    const outside = findClosestRecord(
      prediction,
      [
        makeRecord({
          date: new Date(edgeDate.getTime() + 60_000),
        }),
      ],
    );
    assert.equal(outside, null, "超出窗口不应关联");
  });

  it("比对只匹配同类事件（日食不配月食记录）", () => {
    const prediction = totalSolarPrediction();
    const lunarOnly = makeRecord({
      kind: "lunar",
      type: "lunar-total",
    });
    assert.equal(findClosestRecord(prediction, [lunarOnly]), null);
  });

  it("本地固化的授时历记录集结构完整", () => {
    const records = loadRecords();
    assert.ok(records.length >= 8);
    for (const record of records) {
      assert.ok(record.id.length > 0);
      assert.ok(Number.isFinite(record.date.getTime()));
      assert.ok(record.magnitude >= 0);
      assert.ok(
        record.calendarYear >= 1280 && record.calendarYear <= 1380,
        `记录年份超出历法范围: ${record.id}`,
      );
    }
  });
});
