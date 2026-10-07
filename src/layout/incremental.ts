import type {
  Block,
  Constraint,
  LayoutInput,
  LayoutPatch,
  MutexConflict,
  Placement,
  UpdateResult,
} from "./types.ts";
import { constraintEndpoints, validateLayout } from "./validate.ts";
import { canonicalOrder, checkCandidate, solveLayout, verifyPlacements } from "./solver.ts";

function cloneBlocks(blocks: Block[]): Block[] {
  return blocks.map((b) => ({ ...b, xRange: { ...b.xRange }, yRange: { ...b.yRange } }));
}

function cloneConstraints(constraints: Constraint[]): Constraint[] {
  return constraints.map((c) => ({ ...c }));
}

function placementsEqual(a: ReadonlyMap<string, Placement>, b: ReadonlyMap<string, Placement>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, pa] of a) {
    const pb = b.get(k);
    if (!pb) return false;
    if (
      pa.x !== pb.x ||
      pa.y !== pb.y ||
      pa.width !== pb.width ||
      pa.height !== pb.height ||
      pa.orientation !== pb.orientation
    ) {
      return false;
    }
  }
  return true;
}

function samePlacement(a: Placement, b: Placement): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.orientation === b.orientation
  );
}

export class LayoutEngine {
  private blocks: Block[];
  private constraints: Constraint[];
  private waivedMutex: Set<string>;
  private lastPlacements: Map<string, Placement> | null = null;
  private lastConflicts: MutexConflict[] = [];

  constructor(input: LayoutInput) {
    this.blocks = cloneBlocks(input.blocks);
    this.constraints = cloneConstraints(input.constraints);
    this.waivedMutex = new Set();
  }

  getBlocks(): Block[] {
    return cloneBlocks(this.blocks);
  }

  getConstraints(): Constraint[] {
    return cloneConstraints(this.constraints);
  }

  solve(): UpdateResult {
    const result = solveLayout(this.blocks, this.constraints, { waivedMutex: this.waivedMutex });
    this.lastPlacements = result.placements.size > 0 ? result.placements : null;
    this.lastConflicts = result.conflicts;
    return { ...result, scope: "full", affectedBlockIds: this.blocks.map((b) => b.id), consistentWithFullSolve: true };
  }

  update(patch: LayoutPatch): UpdateResult {
    const prevConstraints = this.constraints;
    const prevWaived = this.waivedMutex;
    const prevPlacements = this.lastPlacements;

    const nextBlocks = cloneBlocks(this.blocks);
    const blockIndex = new Map<string, number>(nextBlocks.map((b, i) => [b.id, i] as [string, number]));
    const changedBlockIds = new Set<string>();
    for (const bp of patch.blocks ?? []) {
      const idx = blockIndex.get(bp.id);
      if (idx === undefined) continue;
      const target = nextBlocks[idx];
      if (bp.width !== undefined) target.width = bp.width;
      if (bp.height !== undefined) target.height = bp.height;
      if (bp.rotatable !== undefined) target.rotatable = bp.rotatable;
      if (bp.xRange !== undefined) target.xRange = { ...bp.xRange };
      if (bp.yRange !== undefined) target.yRange = { ...bp.yRange };
      changedBlockIds.add(bp.id);
    }

    let nextConstraints = cloneConstraints(prevConstraints);
    const removed = new Set(patch.removeConstraintIds ?? []);
    if (removed.size > 0) {
      nextConstraints = nextConstraints.filter((c) => !removed.has(c.id));
    }
    if (patch.addConstraints) {
      nextConstraints = nextConstraints.concat(patch.addConstraints.map((c) => ({ ...c })));
    }

    const nextWaived = new Set(prevWaived);
    for (const id of patch.waiveMutex ?? []) nextWaived.add(id);
    for (const id of patch.enforceMutex ?? []) nextWaived.delete(id);

    const changedConstraintIds = new Set<string>([
      ...removed,
      ...(patch.addConstraints ?? []).map((c) => c.id),
      ...(patch.waiveMutex ?? []),
      ...(patch.enforceMutex ?? []),
    ]);

    const structural = validateLayout(nextBlocks, nextConstraints);
    if (structural.length > 0) {
      this.blocks = nextBlocks;
      this.constraints = nextConstraints;
      this.waivedMutex = nextWaived;
      this.lastPlacements = null;
      this.lastConflicts = [];
      return {
        status: "unsatisfiable",
        placements: new Map(),
        issues: structural,
        conflicts: [],
        scope: "full",
        affectedBlockIds: [],
        consistentWithFullSolve: true,
      };
    }

    const noChanges =
      changedBlockIds.size === 0 && changedConstraintIds.size === 0 && prevPlacements !== null;
    if (noChanges && prevPlacements) {
      return {
        status: this.lastConflicts.length > 0 ? "adjudication_required" : "satisfied",
        placements: prevPlacements,
        issues: [],
        conflicts: this.lastConflicts,
        scope: "unchanged",
        affectedBlockIds: [],
        consistentWithFullSolve: true,
      };
    }

    const containTouched = [...changedConstraintIds].some((id) => {
      const inPrev = prevConstraints.find((c) => c.id === id);
      const inNext = nextConstraints.find((c) => c.id === id);
      return inPrev?.type === "contain" || inNext?.type === "contain";
    });

    const mustFullSolve =
      prevPlacements === null ||
      prevPlacements.size !== nextBlocks.length ||
      containTouched;

    this.blocks = nextBlocks;
    this.constraints = nextConstraints;
    this.waivedMutex = nextWaived;

    if (mustFullSolve) {
      const result = solveLayout(this.blocks, this.constraints, { waivedMutex: this.waivedMutex });
      this.lastPlacements = result.placements.size > 0 ? result.placements : null;
      this.lastConflicts = result.conflicts;
      return {
        ...result,
        scope: "full",
        affectedBlockIds: this.blocks.map((b) => b.id),
        consistentWithFullSolve: true,
      };
    }

    return this.incrementalSweep(prevPlacements!, changedBlockIds, changedConstraintIds);
  }

  private incrementalSweep(
    prevPlacements: Map<string, Placement>,
    changedBlockIds: Set<string>,
    changedConstraintIds: Set<string>,
  ): UpdateResult {
    const order = canonicalOrder(this.blocks, this.constraints);
    const orderIndex = new Map(order.map((b, i) => [b.id, i]));

    const directlyAffected = new Set<string>(changedBlockIds);
    for (const c of this.constraints) {
      if (!changedConstraintIds.has(c.id)) continue;
      for (const id of constraintEndpoints(c)) directlyAffected.add(id);
    }

    let startIndex = order.length;
    for (const id of directlyAffected) {
      const idx = orderIndex.get(id);
      if (idx !== undefined && idx < startIndex) startIndex = idx;
    }
    if (startIndex === order.length) startIndex = 0;

    const placed = new Map<string, Placement>();
    for (let i = 0; i < startIndex; i++) {
      const id = order[i].id;
      const prev = prevPlacements.get(id);
      if (prev) placed.set(id, prev);
    }

    const moved = new Set<string>();
    const recomputed = new Set<string>();
    const conflicts: MutexConflict[] = [];

    for (let i = startIndex; i < order.length; i++) {
      const block = order[i];
      const prev = prevPlacements.get(block.id);
      if (!prev) continue;
      let needs = directlyAffected.has(block.id);
      if (!needs) {
        for (const c of this.constraints) {
          const endpoints = constraintEndpoints(c);
          const idx = endpoints.indexOf(block.id);
          if (idx < 0) continue;
          if (moved.has(endpoints[1 - idx])) {
            needs = true;
            break;
          }
        }
      }
      if (!needs) {
        placed.set(block.id, prev);
        continue;
      }
      recomputed.add(block.id);
      let chosen: Placement | null = null;
      let pending: { p: Placement; blockers: { constraintId: string; other: string }[] } | null = null;
      const orientations: { w: number; h: number; o: "normal" | "rotated" }[] = [
        { w: block.width, h: block.height, o: "normal" },
      ];
      if (block.rotatable && block.width !== block.height) {
        orientations.push({ w: block.height, h: block.width, o: "rotated" });
      }
      outer: for (const { w, h, o } of orientations) {
        for (let x = block.xRange.min; x + w <= block.xRange.max; x++) {
          for (let y = block.yRange.min; y + h <= block.yRange.max; y++) {
            const cand = { x, y, width: w, height: h, orientation: o };
            const verdict = checkCandidate(block, cand, this.constraints, placed, this.waivedMutex);
            if (verdict.ok) {
              chosen = { blockId: block.id, ...cand };
              break outer;
            }
            if (
              pending === null &&
              verdict.failedConstraintIds.length === 0 &&
              verdict.mutexBlockers.length >= 2
            ) {
              pending = { p: { blockId: block.id, ...cand }, blockers: verdict.mutexBlockers };
            }
          }
        }
      }
      const next = chosen ?? pending?.p ?? null;
      if (next === null) {
        const full = solveLayout(this.blocks, this.constraints, { waivedMutex: this.waivedMutex });
        this.lastPlacements = full.placements.size > 0 ? full.placements : null;
        this.lastConflicts = full.conflicts;
        return {
          ...full,
          scope: "full",
          affectedBlockIds: this.blocks.map((b) => b.id),
          consistentWithFullSolve: true,
        };
      }
      placed.set(block.id, next);
      if (!samePlacement(prev, next)) moved.add(block.id);
      if (pending && !chosen) {
        conflicts.push({
          blockId: block.id,
          x: pending.p.x,
          y: pending.p.y,
          width: pending.p.width,
          height: pending.p.height,
          orientation: pending.p.orientation,
          blockers: pending.blockers,
        });
      }
    }

    const verifyIssues = verifyPlacements(this.blocks, this.constraints, placed, this.waivedMutex);
    if (verifyIssues.length > 0) {
      const full = solveLayout(this.blocks, this.constraints, { waivedMutex: this.waivedMutex });
      this.lastPlacements = full.placements.size > 0 ? full.placements : null;
      this.lastConflicts = full.conflicts;
      return {
        ...full,
        scope: "full",
        affectedBlockIds: this.blocks.map((b) => b.id),
        consistentWithFullSolve: true,
      };
    }

    const fullCheck = solveLayout(this.blocks, this.constraints, { waivedMutex: this.waivedMutex });
    const consistent =
      fullCheck.status !== "unsatisfiable" && placementsEqual(fullCheck.placements, placed);

    const status = conflicts.length > 0 ? "adjudication_required" : "satisfied";
    this.lastPlacements = placed;
    this.lastConflicts = conflicts;
    return {
      status,
      placements: placed,
      issues: [],
      conflicts,
      scope: "incremental",
      affectedBlockIds: [...recomputed].sort(),
      consistentWithFullSolve: consistent,
    };
  }
}
