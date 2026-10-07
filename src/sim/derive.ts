import type { SimState } from './state.ts';
import { tickCandle, tickSwing } from './state.ts';

export interface MissingNodeFinding {
  kind: 'missing-node';
  stripId: string;
  endpoint: 'start' | 'end';
  missingNodeId: string;
}

export interface CycleFinding {
  kind: 'cycle';
  path: string[];
}

export type SkeletonFinding = MissingNodeFinding | CycleFinding;

export interface SkeletonReport {
  totalStrips: number;
  validStrips: string[];
  findings: SkeletonFinding[];
  ok: boolean;
}

export function analyzeSkeleton(state: SimState): SkeletonReport {
  const nodeIds = new Set(state.nodes.map((node) => node.id));
  const findings: SkeletonFinding[] = [];
  const validStrips: string[] = [];
  const adjacency = new Map<string, string[]>();

  for (const strip of state.bambooStrips) {
    let valid = true;
    if (!nodeIds.has(strip.startNodeId)) {
      findings.push({ kind: 'missing-node', stripId: strip.id, endpoint: 'start', missingNodeId: strip.startNodeId });
      valid = false;
    }
    if (!nodeIds.has(strip.endNodeId)) {
      findings.push({ kind: 'missing-node', stripId: strip.id, endpoint: 'end', missingNodeId: strip.endNodeId });
      valid = false;
    }
    if (!valid) continue;
    validStrips.push(strip.id);
    if (strip.startNodeId === strip.endNodeId) {
      findings.push({ kind: 'cycle', path: [strip.startNodeId, strip.startNodeId] });
      continue;
    }
    adjacency.set(strip.startNodeId, [...(adjacency.get(strip.startNodeId) ?? []), strip.endNodeId]);
    adjacency.set(strip.endNodeId, [...(adjacency.get(strip.endNodeId) ?? []), strip.startNodeId]);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();
  const parent = new Map<string, string>();

  const dfs = (start: string): void => {
    const stack: string[] = [start];
    visited.add(start);
    inStack.add(start);
    while (stack.length > 0) {
      const current = stack[stack.length - 1];
      const neighbors = adjacency.get(current) ?? [];
      let advanced = false;
      for (const next of neighbors) {
        if (!visited.has(next)) {
          visited.add(next);
          inStack.add(next);
          parent.set(next, current);
          stack.push(next);
          advanced = true;
          break;
        }
        if (inStack.has(next) && parent.get(current) !== next) {
          const path: string[] = [next];
          let cursor = current;
          while (cursor !== next) {
            path.push(cursor);
            cursor = parent.get(cursor)!;
          }
          path.push(next);
          findings.push({ kind: 'cycle', path });
          inStack.delete(next);
        }
      }
      if (!advanced) {
        inStack.delete(current);
        stack.pop();
      }
    }
  };

  for (const id of adjacency.keys()) {
    if (!visited.has(id)) dfs(id);
  }

  return { totalStrips: state.bambooStrips.length, validStrips, findings, ok: findings.length === 0 };
}

export type PanelVerdict = 'hidden-detached' | 'affected-neighbor' | 'intact';

export interface PanelConclusion {
  panelId: string;
  verdict: PanelVerdict;
  reasons: string[];
}

export interface NodeConclusion {
  nodeId: string;
  status: 'supported' | 'unsupported';
  reasons: string[];
}

export interface DisplayReport {
  panels: PanelConclusion[];
  nodes: NodeConclusion[];
}

export function deriveDisplay(state: SimState): DisplayReport {
  const detached = state.silkPanels.filter((panel) => panel.isDetached);
  const intact = state.silkPanels.filter((panel) => !panel.isDetached);

  const nodes: NodeConclusion[] = state.nodes.map((node) => {
    const supporters = intact.filter((panel) => panel.nodeIds.includes(node.id));
    if (supporters.length > 0) {
      return {
        nodeId: node.id,
        status: 'supported',
        reasons: [`held by intact panel(s): ${supporters.map((p) => p.id).join(', ')}`],
      };
    }
    const detachedRefs = detached.filter((panel) => panel.nodeIds.includes(node.id));
    const reasons = detachedRefs.length > 0
      ? [`only referenced by detached panel(s): ${detachedRefs.map((p) => p.id).join(', ')}`]
      : ['not referenced by any panel'];
    return { nodeId: node.id, status: 'unsupported', reasons };
  });

  const panels: PanelConclusion[] = state.silkPanels.map((panel) => {
    if (panel.isDetached) {
      return { panelId: panel.id, verdict: 'hidden-detached', reasons: ['panel is detached'] };
    }
    const reasons: string[] = [];
    for (const other of detached) {
      const shared = panel.nodeIds.filter((id) => other.nodeIds.includes(id));
      if (shared.length > 0) {
        reasons.push(`shares node(s) ${shared.join(', ')} with detached panel ${other.id}`);
      }
    }
    return reasons.length > 0
      ? { panelId: panel.id, verdict: 'affected-neighbor', reasons }
      : { panelId: panel.id, verdict: 'intact', reasons: ['no shared nodes with detached panels'] };
  });

  return { panels, nodes };
}

export interface ConvergenceResult {
  steps: number;
  finalValue: number;
  settledAtStep: number | null;
  converged: boolean;
}

function settleStep(series: number[], target: number, eps: number): number | null {
  let settled: number | null = null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (Math.abs(series[i] - target) <= eps) {
      settled = i;
    } else {
      break;
    }
  }
  return settled;
}

export function simulateCandle(
  initial: SimState,
  dt = 1 / 60,
  steps = 600,
  eps = 1e-3,
): ConvergenceResult & { finalFlicker: number } {
  let state = initial;
  const series: number[] = [];
  for (let i = 0; i < steps; i++) {
    state = tickCandle(state, dt);
    series.push(state.candle.brightness);
  }
  const target = initial.candle.isLit ? 1 : 0;
  const settledAtStep = settleStep(series, target, eps);
  return {
    steps,
    finalValue: state.candle.brightness,
    finalFlicker: state.candle.flickerOffset,
    settledAtStep,
    converged: settledAtStep !== null,
  };
}

export function simulateSwing(
  initial: SimState,
  dt = 1 / 60,
  steps = 600,
  eps = 1e-2,
): ConvergenceResult & { finalVelocity: number } {
  let state = initial;
  const angleSeries: number[] = [];
  const velocitySeries: number[] = [];
  for (let i = 0; i < steps; i++) {
    state = tickSwing(state, dt);
    angleSeries.push(state.hanging.swingAngle);
    velocitySeries.push(state.hanging.swingVelocity);
  }
  const angleSettled = settleStep(angleSeries, 0, eps);
  const velocitySettled = settleStep(velocitySeries, 0, eps);
  const settledAtStep =
    angleSettled !== null && velocitySettled !== null ? Math.max(angleSettled, velocitySettled) : null;
  return {
    steps,
    finalValue: state.hanging.swingAngle,
    finalVelocity: state.hanging.swingVelocity,
    settledAtStep,
    converged: settledAtStep !== null,
  };
}
