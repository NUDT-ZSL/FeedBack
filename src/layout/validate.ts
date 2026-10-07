import type { Constraint, LayoutIssue } from "./types.ts";

export function constraintEndpoints(c: Constraint): string[] {
  switch (c.type) {
    case "adjacent":
    case "align":
    case "mutex":
      return [c.a, c.b];
    case "contain":
      return [c.container, c.content];
  }
}

function isNonNegativeInt(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

export function validateLayout(
  blocks: { id: string; width: number; height: number; xRange: { min: number; max: number }; yRange: { min: number; max: number } }[],
  constraints: Constraint[],
): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const blockIds = new Set<string>();
  const seenBlocks = new Set<string>();
  for (const b of blocks) {
    if (seenBlocks.has(b.id)) {
      issues.push({
        code: "duplicate_block_id",
        message: `duplicate block id: ${b.id}`,
        blockIds: [b.id],
        constraintIds: [],
      });
    }
    seenBlocks.add(b.id);
    blockIds.add(b.id);
    if (!isNonNegativeInt(b.width) || !isNonNegativeInt(b.height)) {
      issues.push({
        code: "invalid_dimension",
        message: `block ${b.id} has negative or non-integer dimension ${b.width}x${b.height}`,
        blockIds: [b.id],
        constraintIds: [],
      });
    }
    if (b.xRange.min > b.xRange.max || b.yRange.min > b.yRange.max) {
      issues.push({
        code: "invalid_range",
        message: `block ${b.id} has an empty position range`,
        blockIds: [b.id],
        constraintIds: [],
      });
    }
  }

  const seenConstraints = new Set<string>();
  for (const c of constraints) {
    if (seenConstraints.has(c.id)) {
      issues.push({
        code: "duplicate_constraint_id",
        message: `duplicate constraint id: ${c.id}`,
        blockIds: [],
        constraintIds: [c.id],
      });
    }
    seenConstraints.add(c.id);
    const endpoints = constraintEndpoints(c);
    const missing = endpoints.filter((id) => !blockIds.has(id));
    if (missing.length > 0) {
      issues.push({
        code: "missing_reference",
        message: `constraint ${c.id} references missing block(s): ${missing.join(", ")}`,
        blockIds: missing,
        constraintIds: [c.id],
      });
    }
    if (new Set(endpoints).size !== endpoints.length) {
      issues.push({
        code: "self_reference",
        message: `constraint ${c.id} references the same block twice`,
        blockIds: [endpoints[0]],
        constraintIds: [c.id],
      });
    }
  }
  issues.push(...detectContainCycles(constraints));
  return issues;
}

export function detectContainCycles(constraints: Constraint[]): LayoutIssue[] {
  const edges = new Map<string, { to: string; constraintId: string }[]>();
  for (const c of constraints) {
    if (c.type !== "contain") continue;
    const list = edges.get(c.container) ?? [];
    list.push({ to: c.content, constraintId: c.id });
    edges.set(c.container, list);
  }
  const issues: LayoutIssue[] = [];
  const reported = new Set<string>();
  const state = new Map<string, "visiting" | "done">();
  const stack: { id: string }[] = [];

  const visit = (node: string): void => {
    state.set(node, "visiting");
    stack.push({ id: node });
    for (const edge of edges.get(node) ?? []) {
      if (state.get(edge.to) === "visiting") {
        const cycleStart = stack.findIndex((s) => s.id === edge.to);
        const cycleNodes = stack.slice(cycleStart).map((s) => s.id);
        cycleNodes.push(edge.to);
        const cycleKey = cycleNodes.join("->");
        if (!reported.has(cycleKey)) {
          reported.add(cycleKey);
          const involvedConstraints: string[] = [];
          for (let i = cycleStart; i < stack.length; i++) {
            const from = stack[i].id;
            const to = i + 1 < stack.length ? stack[i + 1].id : edge.to;
            const hit = (edges.get(from) ?? []).find((e2) => e2.to === to);
            if (hit) involvedConstraints.push(hit.constraintId);
          }
          issues.push({
            code: "constraint_cycle",
            message: `contain constraints form a cycle: ${cycleKey}`,
            blockIds: [...new Set(cycleNodes)],
            constraintIds: involvedConstraints,
          });
        }
        continue;
      }
      if (!state.has(edge.to)) visit(edge.to);
    }
    stack.pop();
    state.set(node, "done");
  };

  for (const node of edges.keys()) {
    if (!state.has(node)) visit(node);
  }
  return issues;
}
