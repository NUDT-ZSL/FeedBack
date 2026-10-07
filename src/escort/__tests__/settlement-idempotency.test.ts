/**
 * 场景二：同一镖队的同一次到达被重复提交结算时，
 * 最终结果必须保持一致，不能被二次结算改写。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCargo, createConvoy } from "../factory.ts";
import { BASE_REWARD, SettlementError, SettlementLedger } from "../settlement.ts";
import { runEscortSimulation } from "../simulate.ts";
import type { RouteGraph } from "../types.ts";

const route: RouteGraph = {
  nodes: [
    { id: "A", kind: "waypoint" },
    { id: "B", kind: "destination" },
  ],
  edges: [{ from: "A", to: "B", distance: 300 }],
  start: "A",
  destination: "B",
};

const makeConvoy = () =>
  createConvoy({
    id: "convoy-9",
    cargo: [createCargo({ id: "c1", name: "茶叶", quantity: 40, unitValue: 5 })],
    silver: 10,
  });

test("同一到达重复提交，结算记录与最终银两保持一致", () => {
  const ledger = new SettlementLedger();

  const first = runEscortSimulation({ convoy: makeConvoy(), route, arrivalId: "arr-1", ledger });
  const second = runEscortSimulation({ convoy: makeConvoy(), route, arrivalId: "arr-1", ledger });
  const third = runEscortSimulation({ convoy: makeConvoy(), route, arrivalId: "arr-1", ledger });

  assert.equal(first.ok, true);
  // 赏金 = 50 + 40*5 = 250，最终银两 = 10 + 250 = 260，只入账一次
  assert.equal(first.settlement?.reward, BASE_REWARD + 200);
  assert.equal(first.settlement?.finalSilver, 260);
  // 重复提交返回同一份记录，最终状态收敛一致，不二次加赏
  assert.deepEqual(second.settlement, first.settlement);
  assert.deepEqual(third.settlement, first.settlement);
  assert.equal(second.finalState.silver, 260);
  assert.equal(third.finalState.silver, 260);
  assert.equal(ledger.has("convoy-9", "arr-1"), true);
});

test("账本上直接重复结算同一到达，幂等返回且不改写", () => {
  const ledger = new SettlementLedger();
  const arrived = { ...makeConvoy(), status: "arrived" as const };

  const first = ledger.settle(arrived, "arr-1");
  const again = ledger.settle(arrived, "arr-1");

  assert.equal(first.record.finalSilver, 260);
  assert.deepEqual(again.record, first.record);
  assert.equal(again.silver, first.record.finalSilver);
});

test("不同的到达标识视为新的一单，允许独立结算", () => {
  const ledger = new SettlementLedger();
  const arrived = { ...makeConvoy(), status: "arrived" as const };

  ledger.settle(arrived, "arr-1");
  const next = ledger.settle(arrived, "arr-2");

  assert.notEqual(next.record.arrivalId, "arr-1");
  assert.equal(ledger.has("convoy-9", "arr-2"), true);
});

test("未抵达的镖队提交结算，给出明确失败而非静默通过", () => {
  const ledger = new SettlementLedger();
  assert.throws(() => ledger.settle(makeConvoy(), "arr-1"), SettlementError);

  const result = runEscortSimulation({
    convoy: { ...makeConvoy(), status: "en_route" },
    route: { ...route, edges: [] }, // 起点即非目的地时会先报路线失败
    arrivalId: "arr-1",
    ledger,
  });
  assert.equal(result.ok, false);
  assert.equal(result.settlement, undefined);
});
