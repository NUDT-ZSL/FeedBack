/**
 * 路线图的静态校验与行进。
 *
 * 关键约束：路线上出现指向缺失（边指向不存在的节点）、无法通行节点、
 * 或目的地不可达时，必须返回带定位信息的 FailureReport，
 * 绝不静默跳过或悄悄换路。
 */
import type { FailureReport, RouteEdge, RouteGraph } from "./types.ts";

/** 推演前静态校验：所有边的端点必须存在，起终点必须存在。 */
export function validateRoute(route: RouteGraph): FailureReport | null {
  const nodeIds = new Set(route.nodes.map((node) => node.id));

  if (!nodeIds.has(route.start)) {
    return {
      code: "MISSING_NODE",
      message: `起点节点 ${route.start} 不存在`,
      visitedPath: [],
      nodeIds: [route.start],
    };
  }
  if (!nodeIds.has(route.destination)) {
    return {
      code: "MISSING_NODE",
      message: `目的地节点 ${route.destination} 不存在`,
      visitedPath: [],
      nodeIds: [route.destination],
    };
  }
  for (const edge of route.edges) {
    const missing = [edge.from, edge.to].filter((id) => !nodeIds.has(id));
    if (missing.length > 0) {
      return {
        code: "DANGLING_EDGE",
        message: `边 ${edge.from} -> ${edge.to} 指向缺失节点: ${missing.join(", ")}`,
        visitedPath: [],
        nodeIds: missing,
        edge,
      };
    }
  }
  return null;
}

const isPassable = (route: RouteGraph, nodeId: string): boolean => {
  const node = route.nodes.find((item) => item.id === nodeId);
  return node !== undefined && node.kind !== "impassable";
};

/**
 * 从起点出发，每步选择可通行的最短出边前进，直到目的地。
 * 返回依次经过的边；中途被无法通行节点挡住或走入死路时返回 FailureReport。
 */
export function walkRoute(
  route: RouteGraph,
): { edges: RouteEdge[] } | { failure: FailureReport } {
  const invalid = validateRoute(route);
  if (invalid) {
    return { failure: invalid };
  }

  const edges: RouteEdge[] = [];
  const visitedPath = [route.start];
  const visited = new Set([route.start]);
  let current = route.start;

  while (current !== route.destination) {
    const candidates = route.edges
      .filter((edge) => edge.from === current && !visited.has(edge.to))
      .sort((a, b) => a.distance - b.distance);

    if (candidates.length === 0) {
      return {
        failure: {
          code: current === route.start ? "UNREACHABLE_DESTINATION" : "DEAD_END",
          message: `节点 ${current} 无可通行的出边，目的地 ${route.destination} 不可达`,
          visitedPath,
          nodeIds: [current],
        },
      };
    }

    const next = candidates[0];
    if (!isPassable(route, next.to)) {
      return {
        failure: {
          code: "IMPASSABLE_NODE",
          message: `节点 ${next.to} 无法通行，行进中止于 ${current}`,
          visitedPath,
          nodeIds: [next.to],
          edge: next,
        },
      };
    }

    edges.push(next);
    visited.add(next.to);
    visitedPath.push(next.to);
    current = next.to;
  }

  return { edges };
}
