import { LayoutEngine } from "./incremental.ts";
import { solveLayout } from "./solver.ts";
import { exportLayoutJson, renderSvg } from "./render.ts";
import type { Block, Constraint, Placement } from "./types.ts";

declare const process: { exit(code: number): never };

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`ok   ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`FAIL ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

function block(
  id: string,
  width: number,
  height: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  rotatable = false,
): Block {
  return { id, width, height, rotatable, xRange: { min: xMin, max: xMax }, yRange: { min: yMin, max: yMax } };
}

function placementOf(placements: ReadonlyMap<string, Placement>, id: string): Placement {
  const p = placements.get(id);
  if (!p) throw new Error(`missing placement for ${id}`);
  return p;
}

function samePlacement(a: Placement, b: Placement): boolean {
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.orientation === b.orientation
  );
}

// --- 1. constraint cycles are unsatisfiable and explicit ---
{
  const blocks = [block("A", 10, 10, 0, 100, 0, 100), block("B", 10, 10, 0, 100, 0, 100)];
  const constraints: Constraint[] = [
    { id: "c1", type: "contain", container: "A", content: "B" },
    { id: "c2", type: "contain", container: "B", content: "A" },
  ];
  const r = solveLayout(blocks, constraints);
  check("cycle: status unsatisfiable", r.status === "unsatisfiable");
  const issue = r.issues.find((i) => i.code === "constraint_cycle");
  check("cycle: issue reported", issue !== undefined);
  check(
    "cycle: names blocks and constraints",
    !!issue && issue.blockIds.includes("A") && issue.blockIds.includes("B") &&
      issue.constraintIds.includes("c1") && issue.constraintIds.includes("c2"),
    JSON.stringify(issue),
  );
}

// --- 2. missing references are unsatisfiable and explicit ---
{
  const blocks = [block("A", 10, 10, 0, 100, 0, 100)];
  const constraints: Constraint[] = [{ id: "c9", type: "align", a: "A", b: "GHOST", axis: "x", edge: "min" }];
  const r = solveLayout(blocks, constraints);
  check("missing ref: status unsatisfiable", r.status === "unsatisfiable");
  const issue = r.issues.find((i) => i.code === "missing_reference");
  check(
    "missing ref: reports constraint and block",
    !!issue && issue.constraintIds.includes("c9") && issue.blockIds.includes("GHOST"),
    JSON.stringify(issue),
  );
}

// --- 3. mutex multi-hit keeps both parties for adjudication ---
{
  const blocks = [
    block("A", 10, 10, 0, 10, 0, 10),
    block("B", 10, 10, 5, 15, 0, 10),
    block("C", 10, 10, 0, 20, 0, 10),
  ];
  const constraints: Constraint[] = [
    { id: "m1", type: "mutex", a: "A", b: "C" },
    { id: "m2", type: "mutex", a: "B", b: "C" },
  ];
  const engine = new LayoutEngine({ blocks, constraints });
  const r = engine.solve();
  check("mutex: adjudication required", r.status === "adjudication_required", r.status);
  check("mutex: exactly one conflict", r.conflicts.length === 1);
  const conflict = r.conflicts[0];
  check(
    "mutex: both parties retained",
    conflict.blockId === "C" &&
      conflict.blockers.some((b) => b.constraintId === "m1" && b.other === "A") &&
      conflict.blockers.some((b) => b.constraintId === "m2" && b.other === "B"),
    JSON.stringify(conflict),
  );
  const beforeA = placementOf(r.placements, "A");
  const beforeB = placementOf(r.placements, "B");

  const adjudicated = engine.update({ waiveMutex: ["m2"] });
  check("adjudication: incremental scope", adjudicated.scope === "incremental", adjudicated.scope);
  check("adjudication: satisfied after waiving m2", adjudicated.status === "satisfied", adjudicated.status);
  check(
    "adjudication: unaffected blocks do not drift",
    samePlacement(placementOf(adjudicated.placements, "A"), beforeA) &&
      samePlacement(placementOf(adjudicated.placements, "B"), beforeB),
  );
  check("adjudication: consistent with full solve", adjudicated.consistentWithFullSolve);
  const cAfter = placementOf(adjudicated.placements, "C");
  const aAfter = placementOf(adjudicated.placements, "A");
  const overlapsAC =
    cAfter.x < aAfter.x + aAfter.width && aAfter.x < cAfter.x + cAfter.width &&
    cAfter.y < aAfter.y + aAfter.height && aAfter.y < cAfter.y + cAfter.height;
  check("adjudication: enforced mutex m1 holds", !overlapsAC);
}

// --- 4. incremental update matches full re-solve, unaffected blocks pinned ---
{
  const blocks = [
    block("A", 10, 10, 0, 60, 0, 60),
    block("B", 10, 10, 0, 60, 0, 60),
    block("C", 10, 10, 0, 60, 0, 60),
    block("D", 8, 8, 0, 60, 0, 60),
  ];
  const constraints: Constraint[] = [
    { id: "mAB", type: "mutex", a: "A", b: "B" },
    { id: "alBC", type: "align", a: "B", b: "C", axis: "x", edge: "min" },
    { id: "adCD", type: "adjacent", a: "C", b: "D", axis: "x", gap: 2 },
  ];
  const engine = new LayoutEngine({ blocks, constraints });
  const base = engine.solve();
  check("incremental: base satisfied", base.status === "satisfied", base.status);

  const updated = engine.update({ blocks: [{ id: "B", xRange: { min: 30, max: 60 } }] });
  check("incremental: scope incremental", updated.scope === "incremental", updated.scope);
  check("incremental: satisfied", updated.status === "satisfied", updated.status);
  check("incremental: consistent with full solve", updated.consistentWithFullSolve);
  check(
    "incremental: earlier block A untouched",
    samePlacement(placementOf(updated.placements, "A"), placementOf(base.placements, "A")),
  );
  check(
    "incremental: affected set contains B",
    updated.affectedBlockIds.includes("B"),
    updated.affectedBlockIds.join(","),
  );

  const added = engine.update({
    addConstraints: [{ id: "alAD", type: "align", a: "A", b: "D", axis: "y", edge: "min" }],
  });
  check("incremental: added constraint satisfied", added.status === "satisfied", added.status);
  check("incremental: added constraint consistent with full", added.consistentWithFullSolve);
  check(
    "incremental: new constraint holds",
    placementOf(added.placements, "A").y === placementOf(added.placements, "D").y,
  );

  const removed = engine.update({ removeConstraintIds: ["alAD"] });
  check("incremental: removal consistent with full", removed.consistentWithFullSolve);

  const noop = engine.update({});
  check("incremental: no-op update keeps placements", noop.scope === "unchanged", noop.scope);
  check(
    "incremental: no-op placements identical",
    samePlacement(placementOf(noop.placements, "C"), placementOf(removed.placements, "C")),
  );
}

// --- 5. boundary sizes: exact fit, overflow, zero size ---
{
  const blocks = [
    block("A", 10, 10, 0, 10, 0, 10),
    block("B", 6, 10, 10, 20, 0, 10, true),
  ];
  const constraints: Constraint[] = [
    { id: "ad", type: "adjacent", a: "A", b: "B", axis: "x", gap: 0 },
    { id: "al", type: "align", a: "A", b: "B", axis: "y", edge: "min" },
  ];
  const r = solveLayout(blocks, constraints);
  check("boundary: exact edge fit satisfied", r.status === "satisfied", r.status);
  const b = placementOf(r.placements, "B");
  check("boundary: B flush against A", b.x === 10 && b.y === 0, JSON.stringify(b));
}
{
  const blocks = [
    block("A", 10, 10, 0, 10, 0, 10),
    block("B", 12, 10, 10, 20, 0, 10, true),
  ];
  const constraints: Constraint[] = [{ id: "ad", type: "adjacent", a: "A", b: "B", axis: "x", gap: 0 }];
  const r = solveLayout(blocks, constraints);
  check("boundary: overflowing rotation deterministically rejected", r.status === "unsatisfiable", r.status);
  check(
    "boundary: overflow reported as no_feasible_placement",
    r.issues.some((i) => i.code === "no_feasible_placement" && i.blockIds.includes("B")),
  );
}
{
  const blocks = [
    block("A", 10, 10, 0, 20, 0, 20),
    block("Z", 0, 0, 0, 20, 0, 20),
  ];
  const constraints: Constraint[] = [{ id: "al", type: "align", a: "A", b: "Z", axis: "x", edge: "min" }];
  const r = solveLayout(blocks, constraints);
  check("boundary: zero-size block has deterministic placement", r.status === "satisfied", r.status);
  const z = placementOf(r.placements, "Z");
  check("boundary: zero-size aligned to A min edge", z.x === 0 && z.width === 0, JSON.stringify(z));
}

// --- 6. determinism: repeated solves are identical ---
{
  const blocks = [
    block("A", 10, 10, 0, 50, 0, 50),
    block("B", 12, 6, 0, 50, 0, 50, true),
    block("C", 5, 5, 0, 50, 0, 50),
  ];
  const constraints: Constraint[] = [
    { id: "m1", type: "mutex", a: "A", b: "B" },
    { id: "ad", type: "adjacent", a: "B", b: "C", axis: "y", gap: 1 },
  ];
  const r1 = solveLayout(blocks, constraints);
  const r2 = solveLayout(blocks, constraints);
  check("determinism: both satisfied", r1.status === "satisfied" && r2.status === "satisfied");
  check(
    "determinism: identical placements",
    ["A", "B", "C"].every((id) => samePlacement(placementOf(r1.placements, id), placementOf(r2.placements, id))),
  );
}

// --- 7. offline render & export ---
{
  const blocks = [block("A", 10, 10, 0, 20, 0, 20), block("B", 5, 5, 0, 20, 0, 20)];
  const constraints: Constraint[] = [{ id: "ct", type: "contain", container: "A", content: "B" }];
  const r = solveLayout(blocks, constraints);
  check("render: contain satisfied", r.status === "satisfied", r.status);
  const svg = renderSvg(blocks, constraints, r.placements);
  check("render: svg produced offline", svg.startsWith("<svg") && svg.includes("</svg>"));
  check("render: one rect per placed block", (svg.match(/<rect /g) ?? []).length === 2);
  const json = exportLayoutJson(blocks, constraints, r.placements);
  const parsed = JSON.parse(json);
  check(
    "export: json round-trips placements",
    parsed.placements.length === 2 && parsed.constraints[0].id === "ct",
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`failures: ${failures.join("; ")}`);
  process.exit(1);
}
