export type NodeType = 'start' | 'process' | 'decision' | 'subprocess';

export interface FlowNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

export interface Connection {
  id: string;
  fromNodeId: string;
  toNodeId: string;
}

export interface HistoryState {
  nodes: FlowNode[];
  connections: Connection[];
}

export interface HistoryManager {
  past: HistoryState[];
  present: HistoryState;
  future: HistoryState[];
}

export const NODE_SIZES: Record<NodeType, { width: number; height: number }> = {
  start: { width: 120, height: 60 },
  process: { width: 140, height: 70 },
  decision: { width: 120, height: 100 },
  subprocess: { width: 150, height: 80 },
};

export const NODE_LABELS: Record<NodeType, string> = {
  start: '开始/结束',
  process: '流程',
  decision: '判断',
  subprocess: '子流程',
};

export function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

export function cloneState(state: HistoryState): HistoryState {
  return {
    nodes: state.nodes.map((n) => ({ ...n })),
    connections: state.connections.map((c) => ({ ...c })),
  };
}

export function createInitialHistory(): HistoryManager {
  return {
    past: [],
    present: { nodes: [], connections: [] },
    future: [],
  };
}

export function pushHistory(
  history: HistoryManager,
  newState: HistoryState,
  maxSteps: number = 30
): HistoryManager {
  const newPast = [...history.past, history.present];
  if (newPast.length > maxSteps) {
    newPast.shift();
  }
  return {
    past: newPast,
    present: cloneState(newState),
    future: [],
  };
}

export function undoHistory(history: HistoryManager): HistoryManager {
  if (history.past.length === 0) return history;
  const newPast = [...history.past];
  const previous = newPast.pop()!;
  return {
    past: newPast,
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoHistory(history: HistoryManager): HistoryManager {
  if (history.future.length === 0) return history;
  const newFuture = [...history.future];
  const next = newFuture.shift()!;
  return {
    past: [...history.past, history.present],
    present: next,
    future: newFuture,
  };
}

export function getNodeCenter(node: FlowNode): { x: number; y: number } {
  return {
    x: node.x + node.width / 2,
    y: node.y + node.height / 2,
  };
}

export function getConnectionPoints(
  fromNode: FlowNode,
  toNode: FlowNode
): { startX: number; startY: number; endX: number; endY: number } {
  const fromCenter = getNodeCenter(fromNode);
  const toCenter = getNodeCenter(toNode);

  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;

  const startPoint = getNodeEdgePoint(fromNode, dx, dy);
  const endPoint = getNodeEdgePoint(toNode, -dx, -dy);

  return {
    startX: startPoint.x,
    startY: startPoint.y,
    endX: endPoint.x,
    endY: endPoint.y,
  };
}

function getNodeEdgePoint(
  node: FlowNode,
  dx: number,
  dy: number
): { x: number; y: number } {
  const center = getNodeCenter(node);
  const halfW = node.width / 2;
  const halfH = node.height / 2;

  if (node.type === 'decision') {
    const slope = halfH / halfW;
    if (Math.abs(dy / dx) > slope) {
      const y = dy > 0 ? center.y + halfH : center.y - halfH;
      const x = center.x + (dy > 0 ? halfW * (dx / Math.abs(dy)) : -halfW * (dx / Math.abs(dy)));
      return { x: center.x + (x - center.x) * (halfH / Math.abs(dy)), y };
    } else {
      const x = dx > 0 ? center.x + halfW : center.x - halfW;
      const y = center.y + (dx > 0 ? halfH * (dy / Math.abs(dx)) : -halfH * (dy / Math.abs(dx)));
      return { x, y: center.y + (y - center.y) * (halfW / Math.abs(dx)) };
    }
  }

  const slope = dy / dx;

  if (dx >= 0 && Math.abs(slope) <= halfH / halfW) {
    return { x: center.x + halfW, y: center.y + slope * halfW };
  } else if (dx < 0 && Math.abs(slope) <= halfH / halfW) {
    return { x: center.x - halfW, y: center.y - slope * halfW };
  } else if (dy >= 0) {
    return { x: center.x + halfH / slope, y: center.y + halfH };
  } else {
    return { x: center.x - halfH / slope, y: center.y - halfH };
  }
}

export function getBezierPath(
  startX: number,
  startY: number,
  endX: number,
  endY: number
): string {
  const dx = endX - startX;
  const dy = endY - startY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const controlOffset = Math.min(distance * 0.5, 80);

  const cp1x = startX + controlOffset;
  const cp1y = startY;
  const cp2x = endX - controlOffset;
  const cp2y = endY;

  return `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`;
}

export function isPointInNode(
  x: number,
  y: number,
  node: FlowNode
): boolean {
  return (
    x >= node.x &&
    x <= node.x + node.width &&
    y >= node.y &&
    y <= node.y + node.height
  );
}

export function findNodeAtPosition(
  x: number,
  y: number,
  nodes: FlowNode[]
): FlowNode | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (isPointInNode(x, y, nodes[i])) {
      return nodes[i];
    }
  }
  return null;
}

export function getArrowHeadPoints(
  endX: number,
  endY: number,
  angle: number,
  size: number = 10
): string {
  const rad = (angle * Math.PI) / 180;
  const p1x = endX - size * Math.cos(rad - Math.PI / 6);
  const p1y = endY - size * Math.sin(rad - Math.PI / 6);
  const p2x = endX - size * Math.cos(rad + Math.PI / 6);
  const p2y = endY - size * Math.sin(rad + Math.PI / 6);
  return `${p1x},${p1y} ${endX},${endY} ${p2x},${p2y}`;
}

export function getConnectionAngle(
  startX: number,
  startY: number,
  endX: number,
  endY: number
): number {
  const dx = endX - startX;
  const dy = endY - startY;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

export function measureTextWidth(text: string, fontSize: number = 14): number {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return text.length * fontSize;
  ctx.font = `${fontSize}px sans-serif`;
  return ctx.measureText(text).width;
}
