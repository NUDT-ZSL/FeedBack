/**
 * 场景三：路线上存在无法通行或指向缺失的节点时，
 * 推演必须给出可追溯的失败结论，而不是静默跳过。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createConvoy } from "../factory.ts";
import { runEscortSimulation } from "../simulate.ts";
import type { RouteGraph } from "../types.ts";

const convoy = () => createConvoy({ id: "convoy-x" });

test("边指向不存在的节点，报 DANGLING_EDGE 并给出定位信息", () => {
  const route: RouteGraph = {
    nodes: [
      { id: "A", kind: "waypoint" },
      { id: "B", kind: "destination" },
    ],
    edges: [
      { from: "A", to: "B", distance: 100 },
      { from: "B", to: "GHOST", distance: 50 }, // 指向缺失节点
    ],
    start: "A",
    destination: "B",
  };

  const result = runEscortSimulation({ convoy: convoy(), route, arrivalId: "arr-1" });

  assert.equal(result.ok, false);
  assert.equal(result.settlement, undefined);
  assert.equal(result.failure?.code, "DANGLING_EDGE");
  assert.deepEqual(result.failure?.nodeIds, ["GHOST"]);
  assert.equal(result.failure?.edge?.to, "GHOST");
  assert.equal(result.finalState.status, "failed");
  // 失败依据写入轨迹，可离线追溯
  assert.ok(result.finalState.trace.some((line) => line.includes("GHOST")));
});

test("唯一通路经过无法通行节点，报 IMPASSABLE_NODE 且停在受阻处", () => {
  const route: RouteGraph = {
    nodes: [
      { id: "A", kind: "waypoint" },
      { id: "B", kind: "impassable" },
      { id: "C", kind: "destination" },
    ],
    edges: [
      { from: "A", to: "B", distance: 100 },
      { from: "B", to: "C", distance: 100 },
    ],
    start: "A",
    destination: "C",
  };

  const result = runEscortSimulation({ convoy: convoy(), route, arrivalId: "arr-1" });

  assert.equal(result.ok, false);
  assert.equal(result.failure?.code, "IMPASSABLE_NODE");
  assert.deepEqual(result.failure?.nodeIds, ["B"]);
  assert.deepEqual(result.failure?.visitedPath, ["A"]);
  assert.equal(result.settlement, undefined);
});

test("目的地不可达（死路），报 DEAD_END 并保留已走路径", () => {
  const route: RouteGraph = {
    nodes: [
      { id: "A", kind: "waypoint" },
      { id: "B", kind: "waypoint" },
      { id: "C", kind: "destination" },
    ],
    edges: [{ from: "A", to: "B", distance: 100 }], // B 之后无路到 C
    start: "A",
    destination: "C",
  };

  const result = runEscortSimulation({ convoy: convoy(), route, arrivalId: "arr-1" });

  assert.equal(result.ok, false);
  assert.equal(result.failure?.code, "DEAD_END");
  assert.deepEqual(result.failure?.visitedPath, ["A", "B"]);
  assert.ok(result.failure?.message.includes("C"));
});

test("起点即无出边，报 UNREACHABLE_DESTINATION", () => {
  const route: RouteGraph = {
    nodes: [
      { id: "A", kind: "waypoint" },
      { id: "C", kind: "destination" },
    ],
    edges: [],
    start: "A",
    destination: "C",
  };

  const result = runEscortSimulation({ convoy: convoy(), route, arrivalId: "arr-1" });

  assert.equal(result.ok, false);
  assert.equal(result.failure?.code, "UNREACHABLE_DESTINATION");
  assert.equal(result.settlement, undefined);
});

test("目的地节点本身缺失，报 MISSING_NODE", () => {
  const route: RouteGraph = {
    nodes: [{ id: "A", kind: "waypoint" }],
    edges: [],
    start: "A",
    destination: "NOWHERE",
  };

  const result = runEscortSimulation({ convoy: convoy(), route, arrivalId: "arr-1" });

  assert.equal(result.ok, false);
  assert.equal(result.failure?.code, "MISSING_NODE");
  assert.deepEqual(result.failure?.nodeIds, ["NOWHERE"]);
});
