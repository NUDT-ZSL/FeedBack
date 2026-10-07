/**
 * 场景一：途中多次遭遇同一类事件时，
 * 货物损耗与队伍状态必须按次累积，而不是互相覆盖。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEncounters } from "../events.ts";
import { createCargo, createConvoy } from "../factory.ts";
import { runEscortSimulation } from "../simulate.ts";
import type { EncounterEvent, RouteGraph } from "../types.ts";

const bandit: EncounterEvent = {
  kind: "bandit_ambush",
  cargoLossRate: 0.1,
  moraleDelta: -5,
  staminaDelta: -10,
  guardLoss: 1,
  silverDelta: -20,
};

test("同一类事件连续遭遇三次，状态在现值上逐次累积", () => {
  const convoy = createConvoy({
    id: "convoy-1",
    cargo: [createCargo({ id: "c1", name: "丝绸", quantity: 100, unitValue: 10 })],
    silver: 100,
  });

  const after = applyEncounters(convoy, [bandit, bandit, bandit], "官道");

  // 货物按当前存量复利损耗：100 -> 90 -> 81 -> 72.9（覆盖式实现会得到 90）
  assert.ok(Math.abs(after.cargo[0].quantity - 72.9) < 1e-9);
  // 士气 / 体力 / 人数 / 银两逐次叠加（覆盖式实现只会生效一次）
  assert.equal(after.morale, 85);
  assert.equal(after.stamina, 70);
  assert.equal(after.guards, 2);
  assert.equal(after.silver, 40);
  // 每次遭遇都留下可追溯记录
  assert.equal(after.trace.length, 3);
  assert.deepEqual(
    after.trace.map((line) => line.includes("bandit_ambush")),
    [true, true, true],
  );
});

test("完整推演中两条路段遭遇同一类事件，损耗累积并体现在结算中", () => {
  const storm: EncounterEvent = { kind: "storm", cargoLossRate: 0.2, staminaDelta: -15 };
  const route: RouteGraph = {
    nodes: [
      { id: "A", kind: "waypoint" },
      { id: "B", kind: "waypoint" },
      { id: "C", kind: "destination" },
    ],
    edges: [
      { from: "A", to: "B", distance: 100, encounters: [storm] },
      { from: "B", to: "C", distance: 100, encounters: [storm] },
    ],
    start: "A",
    destination: "C",
  };
  const convoy = createConvoy({
    id: "convoy-2",
    cargo: [createCargo({ id: "c1", name: "瓷器", quantity: 50, unitValue: 20 })],
  });

  const result = runEscortSimulation({ convoy, route, arrivalId: "arr-1" });

  assert.equal(result.ok, true);
  // 50 -> 40 -> 32，两次风暴都生效
  assert.ok(Math.abs(result.finalState.cargo[0].quantity - 32) < 1e-9);
  assert.equal(result.finalState.stamina, 70);
  assert.equal(result.finalState.distance, 200);
  // 结算损耗 = (50 - 32) * 20 = 360，交付价值 = 32 * 20 = 640
  assert.equal(result.settlement?.cargoValueLost, 360);
  assert.equal(result.settlement?.cargoValueDelivered, 640);
});
