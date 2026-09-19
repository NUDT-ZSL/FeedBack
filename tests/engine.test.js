import test from "node:test";
import assert from "node:assert/strict";

import { sampleData } from "../src/data/sampleData.js";
import { simulateBattle } from "../src/engine/engine.js";
import { commitReplayCache, createSimulationCache, replayIncrementally } from "../src/engine/incremental.js";
import { canonicalize } from "../src/engine/utils.js";

test("行动按顺序经过命中、修正、效果施加和状态结算", () => {
  const result = simulateBattle(sampleData);
  const actions = result.events.filter((event) => event.kind === "action");
  assert.equal(actions.length, sampleData.actions.length);
  for (const event of actions) {
    assert.ok(event.steps.some((step) => step.type === "hit-check"));
    if (!event.skipped && event.steps.some((step) => step.type === "damage-resolved")) {
      const damage = event.steps.find((step) => step.type === "damage-resolved");
      assert.ok(damage.stages.length >= 2);
    }
  }
  assert.ok(result.events.some((event) => event.kind === "turn-end"));
});

test("增伤、易伤、减伤和护盾逐项列出贡献", () => {
  const result = simulateBattle(sampleData);
  const damages = result.events
    .filter((event) => event.kind === "action")
    .flatMap((event) => event.steps.filter((step) => step.type === "damage-resolved"));
  const expectedNames = ["狂暴", "弱点联动", "易伤", "壁垒精研", "减伤", "护盾"];
  const damage = damages.find((candidate) => candidate.shielded > 0 && expectedNames.every((expected) =>
    candidate.stages.flatMap((stage) => stage.contributions.map((item) => item.source)).includes(expected)
  ));
  assert.ok(damage);
  const labels = damage.stages.map((stage) => stage.label);
  assert.deepEqual(labels, ["增伤", "易伤", "减伤", "护盾"]);
});

test("重复状态按叠加、刷新和到期规则处理", () => {
  const input = structuredClone(sampleData);
  input.effects.guard.stacking = "stack";
  input.effects.guard.maxStacks = 2;
  input.actions = [
    { turn: 1, actorId: "hero", targetId: "hero", skillId: "guard" },
    { turn: 1, actorId: "hero", targetId: "hero", skillId: "guard" },
    { turn: 1, actorId: "hero", targetId: "goblin", skillId: "flame" },
    { turn: 1, actorId: "hero", targetId: "goblin", skillId: "flame" },
    { turn: 2, actorId: "hero", targetId: "goblin", skillId: "slash" }
  ];
  const result = simulateBattle(input);
  const shield = result.events
    .filter((event) => event.kind === "action")
    .at(1)
    .state
    .units.find((unit) => unit.id === "hero")
    .statuses.find((status) => status.effectId === "guard");
  assert.equal(shield.stacks, 2);
  assert.equal(shield.remaining, 160);
  assert.ok(result.events.some((event) =>
    event.kind === "action" && event.steps.some((step) => step.type === "status-stacked")
  ));
  assert.ok(result.events.some((event) =>
    event.kind === "action" && event.steps.some((step) => step.type === "status-refreshed")
  ));
  const finalHero = result.finalState.units.find((unit) => unit.id === "hero");
  assert.equal(finalHero.statuses.some((status) => status.effectId === "mending"), false);
});

test("覆盖规则会移除旧状态实例并保留新的来源", () => {
  const input = structuredClone(sampleData);
  input.effects.burn.stacking = "replace";
  input.actions = [
    { turn: 1, actorId: "hero", targetId: "goblin", skillId: "flame" },
    { turn: 1, actorId: "hero", targetId: "goblin", skillId: "flame" }
  ];
  const result = simulateBattle(input);
  const burnStatuses = result.finalState.units
    .find((unit) => unit.id === "goblin")
    .statuses.filter((status) => status.effectId === "burn");
  assert.equal(burnStatuses.length, 1);
  assert.equal(burnStatuses[0].sourceActionIndex, 1);
});

test("持续伤害击杀后停止后续持续效果并清空状态", () => {
  const input = structuredClone(sampleData);
  input.units = input.units.map((unit) => unit.id === "goblin" ? { ...unit, hp: 20, maxHp: 260 } : unit);
  input.actions = [
    { turn: 1, actorId: "hero", targetId: "goblin", skillId: "flame" },
    { turn: 1, actorId: "hero", targetId: "goblin", skillId: "brace" }
  ];
  const result = simulateBattle(input);
  const goblin = result.finalState.units.find((unit) => unit.id === "goblin");
  assert.equal(goblin.hp, 0);
  assert.equal(goblin.statuses.length, 0);
});

test("缺失效果和循环规则被标出并跳过", () => {
  const result = simulateBattle(sampleData);
  assert.ok(result.validation.issues.some((issue) => issue.code === "MISSING_EFFECT"));
  assert.ok(result.validation.issues.some((issue) => issue.code === "RULE_CYCLE"));
  assert.ok(result.invalidRuleIds.includes("cycle-a"));
  assert.ok(result.invalidRuleIds.includes("cycle-b"));
  assert.ok(result.invalidRuleIds.includes("missing-link"));
});

test("不支持的叠加模式会在校验结果中明确标出", () => {
  const input = structuredClone(sampleData);
  input.effects.burn.stacking = "merge-randomly";
  const result = simulateBattle(input);
  assert.ok(result.validation.issues.some((issue) => issue.code === "EFFECT_STACKING"));
});

test("修改后续行动时增量结果与全量重算一致", () => {
  const cache = createSimulationCache(sampleData);
  const changed = structuredClone(sampleData);
  changed.actions[changed.actions.length - 1].skillId = "slash";
  const replay = replayIncrementally(cache, changed);
  assert.equal(replay.reusedActions, changed.actions.length - 1);
  assert.equal(replay.recomputedActions, 1);
  assert.equal(replay.verification.equal, true);
  assert.equal(replay.finalHash, replay.verification.hash);
});

test("修改早期规则会使最早受影响行动之后全部续算并保持一致", () => {
  const cache = createSimulationCache(sampleData);
  const changed = structuredClone(sampleData);
  changed.effects.rage.value = 40;
  const replay = replayIncrementally(cache, changed);
  assert.equal(replay.start, 1);
  assert.equal(canonicalize(replay.finalState), canonicalize(replay.fullFinalState));
});

test("在最后回合结算后追加行动不会重复衰减旧回合", () => {
  const cache = createSimulationCache(sampleData);
  const changed = structuredClone(sampleData);
  changed.actions.push({ turn: 4, actorId: "hero", targetId: "goblin", skillId: "slash" });
  const replay = replayIncrementally(cache, changed, { verify: true });
  assert.equal(replay.start, sampleData.actions.length);
  assert.equal(replay.verification.equal, true);

  const chainedInput = structuredClone(changed);
  chainedInput.actions.push({ turn: 4, actorId: "goblin", targetId: "hero", skillId: "slash" });
  const chainedCache = commitReplayCache(changed, replay);
  const chained = replayIncrementally(chainedCache, chainedInput, { verify: true });
  assert.equal(chained.reusedActions, changed.actions.length);
  assert.equal(chained.verification.equal, true);
});

test("每个修正来源都保留在完整事件轨迹中", () => {
  const result = simulateBattle(sampleData);
  const expectedNames = ["狂暴", "弱点联动", "易伤", "壁垒精研", "减伤", "护盾"];
  const damage = result.events
    .filter((event) => event.kind === "action")
    .flatMap((event) => event.steps)
    .find((step) => step.type === "damage-resolved" && step.shielded > 0 && expectedNames.every((expected) =>
      step.stages.flatMap((stage) => stage.contributions.map((item) => item.source)).includes(expected)
    ));
  assert.ok(damage);
  const names = damage.stages.flatMap((stage) => stage.contributions.map((item) => item.source));
  const vulnerability = damage.stages
    .find((stage) => stage.stage === "vulnerability")
    .contributions.find((item) => item.source === "易伤");
  assert.equal(vulnerability.sources.length, vulnerability.stacks);
  assert.ok(vulnerability.stacks >= 2);
  for (const expected of expectedNames) {
    assert.ok(names.includes(expected), `缺少来源：${expected}`);
  }
});
