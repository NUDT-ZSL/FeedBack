import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { predictEclipse } from "../src/eclipse/index.ts";
import type { EclipseKind, Observer } from "../src/eclipse/index.ts";

const SWEEP_OBSERVERS: Observer[] = [
  { latitudeDeg: 39.9, longitudeDeg: 116.4, utcOffsetHours: 8 },
  { latitudeDeg: 0, longitudeDeg: 0, utcOffsetHours: 0 },
  { latitudeDeg: -33.9, longitudeDeg: 151.2, utcOffsetHours: 10 },
  { latitudeDeg: 64.1, longitudeDeg: -21.9, utcOffsetHours: 0 },
  { latitudeDeg: 85, longitudeDeg: -45, utcOffsetHours: -3 },
  { latitudeDeg: -85, longitudeDeg: 60, utcOffsetHours: 4 },
];

describe("食分与可见性自洽", () => {
  it("无食事件：食分必为零、无相位、不可见", () => {
    const prediction = predictEclipse({
      date: new Date("1335-07-15T00:00:00.000Z"),
      kind: "solar",
      observer: SWEEP_OBSERVERS[0],
    });
    assert.equal(prediction.type, "none");
    assert.equal(prediction.magnitude, 0);
    assert.equal(prediction.phases, null);
    assert.ok(prediction.visibility);
    assert.equal(prediction.visibility!.visible, false);
    assert.equal(prediction.visibility!.reason, "no-eclipse");
  });

  it("判定可见的事件：食分必须为正且类型非 none", () => {
    const start = Date.UTC(1280, 0, 1);
    const end = Date.UTC(1381, 0, 1);
    let visibleChecked = 0;
    for (const kind of ["solar", "lunar"] as const) {
      for (let t = start; t < end; t += 27 * 86_400_000) {
        for (const observer of SWEEP_OBSERVERS) {
          const prediction = predictEclipse({
            date: new Date(t),
            kind,
            observer,
          });
          const visibility = prediction.visibility!;
          if (!visibility.visible) continue;
          visibleChecked += 1;
          assert.ok(
            prediction.magnitude > 0,
            `可见但食分为零: ${kind} @ ${prediction.maximum.toISOString()}`,
          );
          assert.notEqual(prediction.type, "none");
          assert.ok(
            visibility.maxAltitudeDeg > 0,
            "可见时最大高度角必须为正",
          );
          assert.ok(
            visibility.visibleFrom!.getTime() <=
              visibility.visibleUntil!.getTime(),
            "可见起止时刻必须有序",
          );
        }
      }
    }
    assert.ok(visibleChecked > 20, `可见样本过少: ${visibleChecked}`);
  });

  it("不可见判定必须给出 below-horizon 原因且高度角非正", () => {
    const prediction = predictEclipse({
      date: new Date("1311-07-24T18:00:00.000Z"),
      kind: "solar",
      observer: { latitudeDeg: 39.9, longitudeDeg: 116.4, utcOffsetHours: 8 },
    });
    assert.ok(prediction.magnitude > 1, "该事件为食分>1的全食");
    assert.equal(prediction.visibility!.visible, false);
    assert.equal(prediction.visibility!.reason, "below-horizon");
    assert.ok(prediction.visibility!.maxAltitudeDeg <= 0);
  });

  it("同一事件不同观测点：食分一致，可见性可不同", () => {
    const magnitudes = new Set<number>();
    const visibilities = new Set<boolean>();
    for (const observer of SWEEP_OBSERVERS) {
      const prediction = predictEclipse({
        date: new Date("1284-01-11T12:34:00.000Z"),
        kind: "lunar",
        observer,
      });
      magnitudes.add(Number(prediction.magnitude.toFixed(9)));
      visibilities.add(prediction.visibility!.visible);
    }
    assert.equal(magnitudes.size, 1, "食分不应随观测点变化");
    assert.ok(
      visibilities.size === 2,
      "扫描观测点应同时覆盖可见与不可见两种结论",
    );
  });

  it("可见窗口必须落在食象持续区间内", () => {
    const prediction = predictEclipse({
      date: new Date("1284-01-11T12:34:00.000Z"),
      kind: "lunar",
      observer: { latitudeDeg: 39.9, longitudeDeg: 116.4, utcOffsetHours: 8 },
    });
    const visibility = prediction.visibility!;
    assert.equal(visibility.visible, true);
    const { firstContact, lastContact } = prediction.phases!;
    assert.ok(visibility.visibleFrom!.getTime() >= firstContact.getTime() - 1);
    assert.ok(visibility.visibleUntil!.getTime() <= lastContact.getTime() + 1);
  });
});
