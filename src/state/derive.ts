import type { LanternState } from './engine.ts';

export type StructureCode = 'MISSING_NODE' | 'SELF_LOOP' | 'CYCLE';

export type StripStatus = 'ok' | 'dangling' | 'self-loop' | 'in-cycle';

export interface StructureFinding {
  code: StructureCode;
  message: string;
  stripIds: string[];
  nodeIds: string[];
  path?: string[];
}

export interface StripStructure {
  id: string;
  startNodeId: string;
  endNodeId: string;
  status: StripStatus;
  missingNodeIds: string[];
}

export interface StructureReport {
  valid: boolean;
  findings: StructureFinding[];
  strips: StripStructure[];
  totalStripCount: number;
  okStripCount: number;
}

/**
 * 对竹条连接关系做结构推演。竹条方向（startNodeId -> endNodeId）表示拼装落位依赖，
 * 因此成环按有向图检测：有向环意味着依赖互相前置、无法顺序拼装。
 * 推演永不静默跳过：缺失端点、自环、有向环都会逐条给出可追溯结论。
 */
export function inferStructure(state: LanternState): StructureReport {
  const nodeIds = new Set(state.nodes.map((n) => n.id));
  const findings: StructureFinding[] = [];
  const stripStatuses = new Map<string, StripStatus>();
  const missingByStrip = new Map<string, string[]>();
  const cycleEdges = new Set<string>();
  const cycleStripIds = new Set<string>();

  const adjacency = new Map<string, Array<{ to: string; stripId: string }>>();

  for (const strip of state.bambooStrips) {
    const missing: string[] = [];
    if (!nodeIds.has(strip.startNodeId)) missing.push(strip.startNodeId);
    if (!nodeIds.has(strip.endNodeId)) missing.push(strip.endNodeId);
    const distinct = [...new Set(missing)];
    missingByStrip.set(strip.id, distinct);

    if (distinct.length > 0) {
      stripStatuses.set(strip.id, 'dangling');
      findings.push({
        code: 'MISSING_NODE',
        message: `竹条 ${strip.id} 指向的节点 ${distinct.join('、')} 在骨架中不存在，该连接悬空，无法参与拼装推演`,
        stripIds: [strip.id],
        nodeIds: distinct,
      });
      continue;
    }

    if (strip.startNodeId === strip.endNodeId) {
      stripStatuses.set(strip.id, 'self-loop');
      findings.push({
        code: 'SELF_LOOP',
        message: `竹条 ${strip.id} 的起点与终点均为节点 ${strip.startNodeId}，构成自环，拼装依赖无法成立`,
        stripIds: [strip.id],
        nodeIds: [strip.startNodeId],
      });
      continue;
    }

    stripStatuses.set(strip.id, 'ok');
    const edges = adjacency.get(strip.startNodeId) ?? [];
    edges.push({ to: strip.endNodeId, stripId: strip.id });
    adjacency.set(strip.startNodeId, edges);
  }

  // 有向环检测（三色 DFS），保持节点/竹条遍历顺序以保证结论可复现。
  const colors = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const stackIndex = new Map<string, number>();

  const visit = (from: string): void => {
    colors.set(from, 1);
    stackIndex.set(from, stack.length);
    stack.push(from);
    for (const { to, stripId } of adjacency.get(from) ?? []) {
      const color = colors.get(to) ?? 0;
      if (color === 0) {
        visit(to);
      } else if (color === 1) {
        const start = stackIndex.get(to) ?? 0;
        const cycleNodes = stack.slice(start);
        const path = [...cycleNodes, to];
        const edgeKey = (a: string, b: string): string => `${a}->${b}`;
        for (let i = 0; i < cycleNodes.length; i += 1) {
          cycleEdges.add(edgeKey(cycleNodes[i], path[i + 1]));
        }
        const edgeToStrip = new Map<string, string>();
        for (const strip of state.bambooStrips) {
          if (stripStatuses.get(strip.id) === 'ok') {
            edgeToStrip.set(edgeKey(strip.startNodeId, strip.endNodeId), strip.id);
          }
        }
        const stripIds = path
          .slice(0, -1)
          .map((node, i) => edgeToStrip.get(edgeKey(node, path[i + 1])))
          .filter((id): id is string => id !== undefined);
        for (const id of stripIds) cycleStripIds.add(id);
        findings.push({
          code: 'CYCLE',
          message: `竹条连接构成有向环 ${path.join(' -> ')}，各节点互为拼装前置，无法顺序落位`,
          stripIds,
          nodeIds: cycleNodes,
          path,
        });
      }
    }
    stack.pop();
    stackIndex.delete(from);
    colors.set(from, 2);
  };

  for (const node of state.nodes) {
    if ((colors.get(node.id) ?? 0) === 0) visit(node.id);
  }

  const strips: StripStructure[] = state.bambooStrips.map((strip) => {
    const status = cycleStripIds.has(strip.id)
      ? 'in-cycle'
      : (stripStatuses.get(strip.id) ?? 'dangling');
    return {
      id: strip.id,
      startNodeId: strip.startNodeId,
      endNodeId: strip.endNodeId,
      status,
      missingNodeIds: missingByStrip.get(strip.id) ?? [],
    };
  });

  return {
    valid: findings.length === 0,
    findings,
    strips,
    totalStripCount: strips.length,
    okStripCount: strips.filter((s) => s.status === 'ok').length,
  };
}

export type PanelDisplayStatus = 'pasted' | 'partial' | 'detached' | 'bare';
export type NodeDisplayStatus = 'covered' | 'exposed' | 'bare';

export interface PanelDisplay {
  id: string;
  status: PanelDisplayStatus;
  color: string;
  progress: number;
  tension: number;
  isDetached: boolean;
  adjacentPanelIds: string[];
  compromisedBy: string[];
}

export interface NodeDisplay {
  id: string;
  status: NodeDisplayStatus;
  coveredBy: string[];
  exposedBy: string[];
}

export interface DisplayReport {
  panels: Record<string, PanelDisplay>;
  nodes: Record<string, NodeDisplay>;
  overallProgress: number;
  readyForAssembly: boolean;
}

/**
 * 由共享状态推导各绸面与节点的展示结论。
 * 绸面脱离会即时传播：相邻绸面被标记为 compromisedBy，失去全部依托绸面的节点从 covered 变为 exposed。
 */
export function deriveDisplay(state: LanternState): DisplayReport {
  const panels = state.silkPanels.map((panel) => {
    let status: PanelDisplayStatus;
    if (panel.isDetached) status = 'detached';
    else if (panel.pastingProgress >= 100) status = 'pasted';
    else if (panel.pastingProgress > 0) status = 'partial';
    else status = 'bare';
    return { panel, status };
  });

  const adjacency = new Map<string, Set<string>>();
  for (const { panel } of panels) adjacency.set(panel.id, new Set());
  for (let i = 0; i < panels.length; i += 1) {
    const own = new Set(panels[i].panel.nodeIds);
    for (let j = i + 1; j < panels.length; j += 1) {
      const other = panels[j].panel;
      if (other.nodeIds.some((id) => own.has(id))) {
        adjacency.get(panels[i].panel.id)?.add(other.id);
        adjacency.get(other.id)?.add(panels[i].panel.id);
      }
    }
  }

  const detachedIds = new Set(
    panels.filter(({ panel }) => panel.isDetached).map(({ panel }) => panel.id),
  );

  const panelReport: Record<string, PanelDisplay> = {};
  for (const { panel, status } of panels) {
    const adjacentPanelIds = [...(adjacency.get(panel.id) ?? [])].sort();
    panelReport[panel.id] = {
      id: panel.id,
      status,
      color: panel.color,
      progress: panel.pastingProgress,
      tension: panel.tension,
      isDetached: panel.isDetached,
      adjacentPanelIds,
      compromisedBy: panel.isDetached
        ? []
        : adjacentPanelIds.filter((id) => detachedIds.has(id)),
    };
  }

  const nodeReport: Record<string, NodeDisplay> = {};
  for (const node of state.nodes) {
    const covering = panels.filter(({ panel }) => panel.nodeIds.includes(node.id));
    const attachedCovering = covering.filter(
      ({ panel }) => !panel.isDetached && panel.pastingProgress > 0,
    );
    const detachedCovering = covering.filter(({ panel }) => panel.isDetached);
    let status: NodeDisplayStatus;
    if (attachedCovering.length > 0) status = 'covered';
    else if (detachedCovering.length > 0) status = 'exposed';
    else status = 'bare';
    nodeReport[node.id] = {
      id: node.id,
      status,
      coveredBy: attachedCovering.map(({ panel }) => panel.id),
      exposedBy: detachedCovering.map(({ panel }) => panel.id),
    };
  }

  const overallProgress =
    panels.length === 0
      ? 0
      : panels.reduce((sum, { panel }) => sum + panel.pastingProgress, 0) / panels.length;

  const readyForAssembly =
    panels.length > 0 &&
    panels.every(({ panel }) => !panel.isDetached && panel.pastingProgress >= 100);

  return { panels: panelReport, nodes: nodeReport, overallProgress, readyForAssembly };
}
