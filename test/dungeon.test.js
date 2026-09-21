import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAccessibility, generateDungeon, TILE } from "../src/dungeon.js";

const base = {
  seed: "deterministic-test",
  width: 42,
  height: 28,
  roomCount: 9,
  minRoomSize: 4,
  maxRoomSize: 7,
  corridorWidth: 2,
  targetCount: 5,
  floorPercent: 72,
  grassPercent: 20,
  waterPercent: 8,
};

test("same seed and parameters produce an identical dungeon", () => {
  const a = generateDungeon(base);
  const b = generateDungeon({ ...base });
  assert.deepEqual(b.tiles, a.tiles);
  assert.deepEqual(b.targets, a.targets);
  assert.equal(b.numericSeed, a.numericSeed);
});

test("generated map satisfies room, corridor and terrain-count constraints", () => {
  const d = generateDungeon(base);
  assert.equal(d.rooms.length, base.roomCount);
  assert.equal(d.corridors.length, base.roomCount - 1);
  assert.equal(d.targets.length, base.targetCount);
  const terrain = d.summary.terrain;
  assert.equal(
    terrain.floorCount + terrain.grassCount + terrain.waterCount,
    terrain.openCount
  );
  assert.equal(terrain.floorPercent + terrain.grassPercent + terrain.waterPercent, 100);
});

test("all targets are reachable without blocking water", () => {
  const d = generateDungeon({ ...base, floorPercent: 80, grassPercent: 20, waterPercent: 0 });
  assert.deepEqual(d.violations, []);
  assert.equal(d.reachableTargetCount, d.targets.length);
  assert.equal(d.unreachableTiles.length, 0);
});

test("reachability policy either rejects or reports the violated constraint", () => {
  const blockingParams = {
    seed: "blocking-policy-test",
    width: 48,
    height: 32,
    roomCount: 9,
    minRoomSize: 8,
    maxRoomSize: 10,
    corridorWidth: 1,
    targetCount: 6,
    floorPercent: 20,
    grassPercent: 31,
    waterPercent: 49,
  };
  assert.throws(
    () => generateDungeon({ ...blockingParams, ensureReachable: true }),
    /可达性约束被破坏/
  );
  const diagnostic = generateDungeon({ ...blockingParams, ensureReachable: false });
  assert.equal(diagnostic.reachableTargetCount, 0);
  assert.ok(diagnostic.unreachableTiles.length > 0);
  assert.ok(diagnostic.violations[0].includes("可达性约束被破坏"));
});

test("BFS reports exact coordinates of targets blocked by water", () => {
  // # . T forms a walkable target island separated from spawn by water.
  const tiles = [
    [TILE.WALL, TILE.WALL, TILE.WALL, TILE.WALL, TILE.WALL],
    [TILE.SPAWN, TILE.FLOOR, TILE.WATER, TILE.FLOOR, TILE.TARGET],
    [TILE.WALL, TILE.WALL, TILE.WALL, TILE.WALL, TILE.WALL],
  ];
  const spawn = { x: 0, y: 1 };
  const targets = [{ id: "T1", x: 4, y: 1 }];
  const result = analyzeAccessibility(tiles, spawn, targets);
  assert.equal(result.reachableTargetCount, 0);
  assert.deepEqual(result.targets[0], { id: "T1", x: 4, y: 1, reachable: false });
  assert.deepEqual(result.unreachableTiles, [{ x: 3, y: 1 }, { x: 4, y: 1 }]);
});

test("invalid parameters are rejected before a map is produced", () => {
  assert.throws(
    () => generateDungeon({ ...base, width: 6 }),
    (error) => error.name === "ValidationError" && error.errors.some((e) => e.includes("地图宽度"))
  );
  assert.throws(
    () => generateDungeon({ ...base, floorPercent: 60, grassPercent: 20, waterPercent: 10 }),
    /地形占比之和必须为 100%/
  );
});
