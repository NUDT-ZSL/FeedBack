import type {
  Block,
  Constraint,
  LayoutIssue,
  MutexBlocker,
  MutexConflict,
  Orientation,
  Placement,
  SolveOptions,
  SolveResult,
} from "./types.ts";
import { constraintEndpoints, validateLayout } from "./validate.ts";

export function canonicalOrder(blocks: Block[], constraints: Constraint[]): Block[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const contains = constraints.filter((c) => c.type === "contain");
  const depthCache = new Map<string, number>();
  const depthOf = (id: string, seen: Set<string>): number => {
    const cached = depthCache.get(id);
    if (cached !== undefined) return cached;
    if (seen.has(id)) return 0;
    seen.add(id);
    let depth = 0;
    for (const c of contains) {
      if (c.type === "contain" && c.content === id && byId.has(c.container)) {
        depth = Math.max(depth, 1 + depthOf(c.container, seen));
      }
    }
    depthCache.set(id, depth);
    return depth;
  };
  return [...blocks].sort((a, b) => {
    const da = depthOf(a.id, new Set());
    const db = depthOf(b.id, new Set());
    if (da !== db) return da - db;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

interface Candidate {
  x: number;
  y: number;
  width: number;
  height: number;
  orientation: Orientation;
}

function* enumerateCandidates(block: Block): Generator<Candidate> {
  const orientations: { w: number; h: number; o: Orientation }[] = [
    { w: block.width, h: block.height, o: "normal" },
  ];
  if (block.rotatable && block.width !== block.height) {
    orientations.push({ w: block.height, h: block.width, o: "rotated" });
  }
  for (const { w, h, o } of orientations) {
    for (let x = block.xRange.min; x + w <= block.xRange.max; x++) {
      for (let y = block.yRange.min; y + h <= block.yRange.max; y++) {
        yield { x, y, width: w, height: h, orientation: o };
      }
    }
  }
}

function spanMin(p: Placement | Candidate, axis: "x" | "y"): number {
  return axis === "x" ? p.x : p.y;
}

function spanMax(p: Placement | Candidate, axis: "x" | "y"): number {
  return axis === "x" ? p.x + p.width : p.y + p.height;
}

function overlap(a: Placement | Candidate, b: Placement | Candidate): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function satisfiesPair(
  c: Constraint,
  cand: Candidate,
  other: Placement,
  candIsFirst: boolean,
): boolean {
  const first = candIsFirst ? cand : other;
  const second = candIsFirst ? other : cand;
  switch (c.type) {
    case "adjacent":
      return spanMax(first, c.axis) + c.gap === spanMin(second, c.axis);
    case "align":
      return c.edge === "min"
        ? spanMin(first, c.axis) === spanMin(second, c.axis)
        : spanMax(first, c.axis) === spanMax(second, c.axis);
    case "mutex":
      return !overlap(first, second);
    case "contain": {
      const content = candIsFirst ? other : cand;
      const container = candIsFirst ? cand : other;
      return (
        content.x >= container.x &&
        content.y >= container.y &&
        content.x + content.width <= container.x + container.width &&
        content.y + content.height <= container.y + container.height
      );
    }
  }
}

export interface CandidateVerdict {
  ok: boolean;
  mutexBlockers: MutexBlocker[];
  failedConstraintIds: string[];
}

export function checkCandidate(
  block: Block,
  cand: Candidate,
  constraints: Constraint[],
  placed: ReadonlyMap<string, Placement>,
  waivedMutex: ReadonlySet<string>,
): CandidateVerdict {
  const mutexBlockers: MutexBlocker[] = [];
  const failedConstraintIds: string[] = [];
  for (const c of constraints) {
    const endpoints = constraintEndpoints(c);
    const idx = endpoints.indexOf(block.id);
    if (idx < 0) continue;
    const otherId = endpoints[1 - idx];
    const other = placed.get(otherId);
    if (!other) continue;
    if (c.type === "mutex") {
      if (waivedMutex.has(c.id)) continue;
      if (overlap(cand, other)) {
        mutexBlockers.push({ constraintId: c.id, other: otherId });
      }
      continue;
    }
    const candIsFirst = c.type === "contain" ? c.container === block.id : endpoints[0] === block.id;
    if (!satisfiesPair(c, cand, other, candIsFirst)) {
      failedConstraintIds.push(c.id);
    }
  }
  return { ok: mutexBlockers.length === 0 && failedConstraintIds.length === 0, mutexBlockers, failedConstraintIds };
}

export function solveLayout(
  blocks: Block[],
  constraints: Constraint[],
  options: SolveOptions = {},
): SolveResult {
  const pinned = options.pinned ?? new Map<string, Placement>();
  const waivedMutex = options.waivedMutex ?? new Set<string>();

  const structural = validateLayout(blocks, constraints);
  if (structural.length > 0) {
    return { status: "unsatisfiable", placements: new Map(), issues: structural, conflicts: [] };
  }

  const order = canonicalOrder(blocks, constraints);
  const placed = new Map<string, Placement>(pinned);
  const conflicts: MutexConflict[] = [];
  const issues: LayoutIssue[] = [];

  for (const block of order) {
    if (placed.has(block.id)) continue;
    let chosen: Candidate | null = null;
    let pending: { cand: Candidate; blockers: MutexBlocker[] } | null = null;
    const failedConstraintIds = new Set<string>();
    for (const cand of enumerateCandidates(block)) {
      const verdict = checkCandidate(block, cand, constraints, placed, waivedMutex);
      for (const id of verdict.failedConstraintIds) failedConstraintIds.add(id);
      if (verdict.ok) {
        chosen = cand;
        break;
      }
      if (
        pending === null &&
        verdict.failedConstraintIds.length === 0 &&
        verdict.mutexBlockers.length >= 2
      ) {
        pending = { cand, blockers: verdict.mutexBlockers };
      }
    }
    if (chosen) {
      placed.set(block.id, { blockId: block.id, ...chosen });
      continue;
    }
    if (pending) {
      placed.set(block.id, { blockId: block.id, ...pending.cand });
      conflicts.push({
        blockId: block.id,
        x: pending.cand.x,
        y: pending.cand.y,
        width: pending.cand.width,
        height: pending.cand.height,
        orientation: pending.cand.orientation,
        blockers: pending.blockers,
      });
      continue;
    }
    issues.push({
      code: "no_feasible_placement",
      message: `block ${block.id} has no feasible placement`,
      blockIds: [block.id],
      constraintIds: [...failedConstraintIds].sort(),
    });
  }

  if (issues.length > 0) {
    return { status: "unsatisfiable", placements: new Map(), issues, conflicts: [] };
  }
  if (conflicts.length > 0) {
    return { status: "adjudication_required", placements: placed, issues: [], conflicts };
  }
  return { status: "satisfied", placements: placed, issues: [], conflicts: [] };
}

export function verifyPlacements(
  blocks: Block[],
  constraints: Constraint[],
  placements: ReadonlyMap<string, Placement>,
  waivedMutex: ReadonlySet<string> = new Set(),
): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  for (const b of blocks) {
    const p = placements.get(b.id);
    if (!p) {
      issues.push({
        code: "no_feasible_placement",
        message: `block ${b.id} has no placement`,
        blockIds: [b.id],
        constraintIds: [],
      });
      continue;
    }
    const orientations: { w: number; h: number }[] = [{ w: b.width, h: b.height }];
    if (b.rotatable) orientations.push({ w: b.height, h: b.width });
    const matchesOrientation = orientations.some((o) => o.w === p.width && o.h === p.height);
    const inRange =
      p.x >= b.xRange.min &&
      p.y >= b.yRange.min &&
      p.x + p.width <= b.xRange.max &&
      p.y + p.height <= b.yRange.max;
    if (!matchesOrientation || !inRange) {
      issues.push({
        code: "no_feasible_placement",
        message: `placement of block ${b.id} violates its own size/orientation/range`,
        blockIds: [b.id],
        constraintIds: [],
      });
    }
  }
  for (const c of constraints) {
    if (c.type === "mutex" && waivedMutex.has(c.id)) continue;
    const endpoints = constraintEndpoints(c);
    const pa = placements.get(endpoints[0]);
    const pb = placements.get(endpoints[1]);
    if (!pa || !pb) continue;
    if (!satisfiesPair(c, pa, pb, true)) {
      issues.push({
        code: "incremental_conflict",
        message: `constraint ${c.id} is violated by the resulting placements`,
        blockIds: endpoints,
        constraintIds: [c.id],
      });
    }
  }
  return issues;
}
