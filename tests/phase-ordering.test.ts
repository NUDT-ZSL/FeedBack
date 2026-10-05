import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { predictEclipse } from "../src/eclipse/index.ts";
import type { EclipseKind, Observer } from "../src/eclipse/index.ts";

const OBSERVERS: Record<string, Observer> = {
  dadu: { latitudeDeg: 39.9, longitudeDeg: 116.4, utcOffsetHours: 8 },
  westEdge: { latitudeDeg: 35, longitudeDeg: -179.5, utcOffsetHours: -12 },
  eastEdge: { latitudeDeg: 35, longitudeDeg: 179.5, utcOffsetHours: 14 },
  crossMidnight: { latitudeDeg: 42.8, longitudeDeg: 93.5, utcOffsetHours: 6 },
  northPolar: { latitudeDeg: 89, longitudeDeg: 0, utcOffsetHours: 0 },
  southPolar: { latitudeDeg: -89, longitudeDeg: 120, utcOffsetHours: 8 },
};

function localParts(date: Date, utcOffsetHours: number) {
  const shifted = new Date(date.getTime() + utcOffsetHours * 3_600_000);
  return {
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function assertPhaseOrdering(
  dateISO: string,
  kind: EclipseKind,
  observer?: Observer,
) {
  const prediction = predictEclipse({
    date: new Date(dateISO),
    kind,
    observer,
  });
  if (prediction.type === "none") return prediction;
  assert.ok(prediction.phases, `${dateISO} ${kind}: phases must exist`);
  const { firstContact, maximum, lastContact } = prediction.phases!;
  assert.ok(
    firstContact.getTime() <= maximum.getTime(),
    `初亏必须不晚于食甚: ${firstContact.toISOString()} vs ${maximum.toISOString()}`,
  );
  assert.ok(
    maximum.getTime() <= lastContact.getTime(),
    `食甚必须不晚于复圆: ${maximum.toISOString()} vs ${lastContact.toISOString()}`,
  );
  assert.ok(
    lastContact.getTime() > firstContact.getTime(),
    "复圆必须严格晚于初亏",
  );
  return prediction;
}

describe("阶段时刻先后关系", () => {
  const eclipseDates: Array<[string, EclipseKind]> = [
    ["1311-07-24T18:00:00.000Z", "solar"],
    ["1282-08-12T03:37:00.000Z", "solar"],
    ["1319-03-01T00:40:00.000Z", "solar"],
    ["1284-01-11T12:34:00.000Z", "lunar"],
    ["1299-09-18T10:52:00.000Z", "lunar"],
    ["1286-11-09T22:30:00.000Z", "lunar"],
  ];

  for (const [dateISO, kind] of eclipseDates) {
    it(`${kind} ${dateISO} 初亏<=食甚<=复圆`, () => {
      assertPhaseOrdering(dateISO, kind);
    });
  }

  it("跨日：本地跨午夜时先后关系仍成立", () => {
    let crossedMidnight = 0;
    for (const observer of Object.values(OBSERVERS)) {
      const prediction = assertPhaseOrdering(
        "1311-07-24T18:00:00.000Z",
        "solar",
        observer,
      );
      const phases = prediction.phases!;
      const first = localParts(phases.firstContact, observer.utcOffsetHours);
      const last = localParts(phases.lastContact, observer.utcOffsetHours);
      if (first.day !== last.day || first.hour > last.hour) {
        assert.ok(
          phases.firstContact.getTime() < phases.lastContact.getTime(),
          "跨午夜时仍须初亏早于复圆",
        );
        crossedMidnight += 1;
      }
    }
    assert.ok(crossedMidnight > 0, "用例集必须实际覆盖跨午夜情形");
  });

  it("跨时区：同一事件在不同 utcOffset 下时刻不变", () => {
    const offsets = [-12, -5, 0, 8, 14];
    const isoStrings: string[] = [];
    for (const offset of offsets) {
      const prediction = predictEclipse({
        date: new Date("1284-01-11T12:34:00.000Z"),
        kind: "lunar",
        observer: {
          latitudeDeg: 30,
          longitudeDeg: offset * 15,
          utcOffsetHours: offset,
        },
      });
      isoStrings.push(prediction.phases!.firstContact.toISOString());
      isoStrings.push(prediction.phases!.lastContact.toISOString());
    }
    const unique = new Set(isoStrings);
    assert.equal(unique.size, 2, "时刻不应随观测时区变化");
  });

  it("极区观测：相位时刻依然有序且食分不变", () => {
    for (const observer of [OBSERVERS.northPolar, OBSERVERS.southPolar]) {
      const prediction = assertPhaseOrdering(
        "1284-01-11T12:34:00.000Z",
        "lunar",
        observer,
      );
      assert.ok(prediction.magnitude > 1, "月全食食分应大于1");
    }
  });
});

describe("阶段时刻单调性扫描", () => {
  it("1280-1380 年间所有可检测事件相位有序", () => {
    const start = Date.UTC(1280, 0, 1);
    const end = Date.UTC(1381, 0, 1);
    let checked = 0;
    for (const kind of ["solar", "lunar"] as const) {
      for (let t = start; t < end; t += 13.5 * 86_400_000) {
        const prediction = predictEclipse({ date: new Date(t), kind });
        if (prediction.type === "none") continue;
        const { firstContact, maximum, lastContact } = prediction.phases!;
        assert.ok(firstContact.getTime() <= maximum.getTime());
        assert.ok(maximum.getTime() <= lastContact.getTime());
        const durationHours =
          (lastContact.getTime() - firstContact.getTime()) / 3_600_000;
        assert.ok(
          durationHours > 0 && durationHours < 24,
          `持续时长异常: ${durationHours}h @ ${maximum.toISOString()}`,
        );
        checked += 1;
      }
    }
    assert.ok(checked > 50, `扫描样本过少: ${checked}`);
  });
});
