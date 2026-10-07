import { v4 as uuidv4 } from 'uuid';

export interface Point {
  x: number;
  y: number;
}

export interface Branch {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  thickness: number;
  color: string;
  hasLeaves: boolean;
}

export interface Rock {
  id: string;
  x: number;
  y: number;
  diameter: number;
  color: string;
}

export interface WaterFlow {
  id: string;
  path: Point[];
  flowProgress: number;
}

export interface Calligraphy {
  id: string;
  points: Point[];
  color: string;
  thickness: number;
}

export interface Particle {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  life: number;
  maxLife: number;
  size: number;
  type: 'leaf' | 'gold';
}

export interface Ripple {
  id: string;
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  life: number;
  maxLife: number;
}

export type ToolType = 'scissors' | 'rock' | 'water' | 'brush';

export const POT_RADIUS = 200;
export const POT_CENTER = { x: 200, y: 200 };
export const GRID_SIZE = 15;

export function generateBranches(): Branch[] {
  const branches: Branch[] = [];
  const trunkStartX = 200;
  const trunkStartY = 320;
  
  const trunk: Branch = {
    id: uuidv4(),
    startX: trunkStartX,
    startY: trunkStartY,
    endX: trunkStartX + (Math.random() - 0.5) * 20,
    endY: trunkStartY - 80,
    thickness: 12,
    color: '#5d4037',
    hasLeaves: false
  };
  branches.push(trunk);
  
  const generateSubBranches = (
    startX: number, 
    startY: number, 
    angle: number, 
    length: number, 
    thickness: number, 
    depth: number, 
    maxDepth: number
  ) => {
    if (depth > maxDepth || length < 8) return;
    
    const endX = startX + Math.cos(angle) * length;
    const endY = startY + Math.sin(angle) * length;
    
    const branch: Branch = {
      id: uuidv4(),
      startX,
      startY,
      endX,
      endY,
      thickness,
      color: depth < 2 ? '#5d4037' : '#6d4c41',
      hasLeaves: depth >= 2 && Math.random() > 0.3
    };
    branches.push(branch);
    
    const branchCount = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < branchCount; i++) {
      const newAngle = angle + (Math.random() - 0.5) * Math.PI * 0.7;
      const newLength = length * (0.5 + Math.random() * 0.3);
      const newThickness = thickness * 0.6;
      generateSubBranches(endX, endY, newAngle, newLength, newThickness, depth + 1, maxDepth);
    }
  };
  
  const mainBranches = 3 + Math.floor(Math.random() * 2);
  for (let i = 0; i < mainBranches; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.6;
    const length = 50 + Math.random() * 30;
    generateSubBranches(trunk.endX, trunk.endY, angle, length, 7, 0, 3);
  }
  
  return branches;
}

export function generateInitialRocks(): Rock[] {
  const rocks: Rock[] = [];
  const positions = [
    { x: 120, y: 340 },
    { x: 280, y: 330 },
    { x: 200, y: 360 }
  ];
  
  for (const pos of positions) {
    rocks.push({
      id: uuidv4(),
      x: pos.x + (Math.random() - 0.5) * 20,
      y: pos.y + (Math.random() - 0.5) * 10,
      diameter: 15 + Math.random() * 10,
      color: Math.random() > 0.5 ? '#607d8b' : '#8d6e63'
    });
  }
  
  return rocks;
}

export function checkCollision(obj1: { x: number; y: number; radius: number }, obj2: { x: number; y: number; radius: number }, minDistance: number = 2): boolean {
  const dx = obj1.x - obj2.x;
  const dy = obj1.y - obj2.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return distance < obj1.radius + obj2.radius + minDistance;
}

export function checkBranchRockCollision(branch: Branch, rock: Rock): boolean {
  const rockCircle = { x: rock.x, y: rock.y, radius: rock.diameter / 2 };
  
  const dist = pointToLineDistance(
    rockCircle.x, rockCircle.y,
    branch.startX, branch.startY,
    branch.endX, branch.endY
  );
  
  return dist < rockCircle.radius + branch.thickness / 2 + 2;
}

export function pointToLineDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;
  
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  
  if (lenSq !== 0) param = dot / lenSq;
  
  let xx, yy;
  
  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }
  
  const dx = px - xx;
  const dy = py - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

interface GridNode {
  x: number;
  y: number;
  g: number;
  h: number;
  f: number;
  parent: GridNode | null;
}

export function findWaterPath(start: Point, end: Point, rocks: Rock[], potRadius: number, potCenter: Point): Point[] {
  const gridW = Math.ceil((potRadius * 2) / GRID_SIZE);
  const gridH = Math.ceil((potRadius * 2) / GRID_SIZE);
  
  const isBlocked = (gridX: number, gridY: number): boolean => {
    const worldX = gridX * GRID_SIZE + GRID_SIZE / 2;
    const worldY = gridY * GRID_SIZE + GRID_SIZE / 2;
    
    const dx = worldX - potCenter.x;
    const dy = worldY - potCenter.y;
    if (Math.sqrt(dx * dx + dy * dy) > potRadius - 5) return true;
    
    for (const rock of rocks) {
      const rdx = worldX - rock.x;
      const rdy = worldY - rock.y;
      if (Math.sqrt(rdx * rdx + rdy * rdy) < rock.diameter / 2 + 8) return true;
    }
    
    return false;
  };
  
  const heuristic = (a: GridNode, b: GridNode): number => {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  };
  
  const startGrid: GridNode = {
    x: Math.floor((start.x - potCenter.x + potRadius) / GRID_SIZE),
    y: Math.floor((start.y - potCenter.y + potRadius) / GRID_SIZE),
    g: 0,
    h: 0,
    f: 0,
    parent: null
  };
  
  const endGrid: GridNode = {
    x: Math.floor((end.x - potCenter.x + potRadius) / GRID_SIZE),
    y: Math.floor((end.y - potCenter.y + potRadius) / GRID_SIZE),
    g: 0,
    h: 0,
    f: 0,
    parent: null
  };
  
  startGrid.h = heuristic(startGrid, endGrid);
  startGrid.f = startGrid.g + startGrid.h;
  
  const openList: GridNode[] = [startGrid];
  const closedSet = new Set<string>();
  const nodeMap = new Map<string, GridNode>();
  nodeMap.set(`${startGrid.x},${startGrid.y}`, startGrid);
  
  while (openList.length > 0) {
    openList.sort((a, b) => a.f - b.f);
    const current = openList.shift()!;
    
    if (current.x === endGrid.x && current.y === endGrid.y) {
      const path: Point[] = [];
      let node: GridNode | null = current;
      while (node) {
        path.unshift({
          x: node.x * GRID_SIZE + GRID_SIZE / 2,
          y: node.y * GRID_SIZE + GRID_SIZE / 2
        });
        node = node.parent;
      }
      return smoothPath(path);
    }
    
    closedSet.add(`${current.x},${current.y}`);
    
    const neighbors = [
      { x: current.x - 1, y: current.y },
      { x: current.x + 1, y: current.y },
      { x: current.x, y: current.y - 1 },
      { x: current.x, y: current.y + 1 },
      { x: current.x - 1, y: current.y - 1 },
      { x: current.x + 1, y: current.y - 1 },
      { x: current.x - 1, y: current.y + 1 },
      { x: current.x + 1, y: current.y + 1 }
    ];
    
    for (const neighborPos of neighbors) {
      if (neighborPos.x < 0 || neighborPos.x >= gridW || neighborPos.y < 0 || neighborPos.y >= gridH) continue;
      if (isBlocked(neighborPos.x, neighborPos.y)) continue;
      if (closedSet.has(`${neighborPos.x},${neighborPos.y}`)) continue;
      
      const isDiagonal = neighborPos.x !== current.x && neighborPos.y !== current.y;
      const movementCost = isDiagonal ? 1.4 : 1;
      
      const tentativeG = current.g + movementCost;
      const key = `${neighborPos.x},${neighborPos.y}`;
      
      let neighbor = nodeMap.get(key);
      if (!neighbor) {
        neighbor = {
          x: neighborPos.x,
          y: neighborPos.y,
          g: tentativeG,
          h: 0,
          f: 0,
          parent: current
        };
        neighbor.h = heuristic(neighbor, endGrid);
        neighbor.f = neighbor.g + neighbor.h;
        nodeMap.set(key, neighbor);
        openList.push(neighbor);
      } else if (tentativeG < neighbor.g) {
        neighbor.g = tentativeG;
        neighbor.f = neighbor.g + neighbor.h;
        neighbor.parent = current;
        
        const idx = openList.indexOf(neighbor);
        if (idx === -1) openList.push(neighbor);
      }
    }
  }
  
  return [];
}

export function smoothPath(path: Point[]): Point[] {
  if (path.length < 3) return path;
  
  const smoothed: Point[] = [path[0]];
  
  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1];
    const curr = path[i];
    const next = path[i + 1];
    
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    
    const dot = v1x * v2x + v1y * v2y;
    const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);
    
    if (mag1 > 0 && mag2 > 0) {
      const cos = dot / (mag1 * mag2);
      if (cos < 0.95) {
        smoothed.push(curr);
      }
    }
  }
  
  smoothed.push(path[path.length - 1]);
  return smoothed;
}

export function calculatePathLength(path: Point[]): number {
  let length = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    length += Math.sqrt(dx * dx + dy * dy);
  }
  return length;
}

export function calculatePathCurvature(path: Point[]): number {
  if (path.length < 3) return 0;
  
  let totalCurvature = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1];
    const curr = path[i];
    const next = path[i + 1];
    
    const angle1 = Math.atan2(curr.y - prev.y, curr.x - prev.x);
    const angle2 = Math.atan2(next.y - curr.y, next.x - curr.x);
    
    let angleDiff = Math.abs(angle2 - angle1);
    if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
    
    totalCurvature += angleDiff;
  }
  
  return totalCurvature / (path.length - 2);
}

export function calculateCompositionScore(
  branches: Branch[],
  rocks: Rock[],
  waterFlows: WaterFlow[]
): {
  total: number;
  branchScore: number;
  rockScore: number;
  waterScore: number;
} {
  let branchScore = 0;
  const leafBranches = branches.filter(b => b.hasLeaves);
  if (leafBranches.length >= 5 && leafBranches.length <= 12) {
    branchScore += 10;
  }
  
  const leftSide = branches.filter(b => b.endX < 200).length;
  const rightSide = branches.filter(b => b.endX > 200).length;
  if (Math.abs(leftSide - rightSide) <= 3) {
    branchScore += 20;
  }
  
  let rockScore = 0;
  if (rocks.length >= 3 && rocks.length <= 6) {
    const diameters = rocks.map(r => r.diameter);
    const sorted = [...diameters].sort((a, b) => b - a);
    if (sorted[0] > sorted[1] * 1.3) {
      rockScore += 25;
    }
    
    const positions = rocks.map(r => ({ x: r.x, y: r.y }));
    let spread = 0;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        spread += Math.sqrt(dx * dx + dy * dy);
      }
    }
    if (spread > 150 && spread < 400) {
      rockScore += 15;
    }
  }
  
  let waterScore = 0;
  for (const flow of waterFlows) {
    if (flow.path.length > 5) {
      const length = calculatePathLength(flow.path);
      if (length > 100 && length < 400) {
        waterScore += 15;
      }
      
      const curvature = calculatePathCurvature(flow.path);
      if (curvature > 0.1 && curvature < 0.8) {
        waterScore += 10;
      }
    }
  }
  
  if (waterFlows.length === 0) {
    waterScore = 0;
  }
  
  return {
    total: branchScore + rockScore + waterScore,
    branchScore,
    rockScore,
    waterScore
  };
}

export function isPointInPot(x: number, y: number, centerX: number, centerY: number, radius: number): boolean {
  const dx = x - centerX;
  const dy = y - centerY;
  return Math.sqrt(dx * dx + dy * dy) <= radius;
}

export function findNearestBranch(x: number, y: number, branches: Branch[]): Branch | null {
  let nearest: Branch | null = null;
  let minDist = Infinity;
  
  for (const branch of branches) {
    const dist = pointToLineDistance(x, y, branch.startX, branch.startY, branch.endX, branch.endY);
    if (dist < minDist && dist < branch.thickness + 10) {
      minDist = dist;
      nearest = branch;
    }
  }
  
  return nearest;
}

export function findNearestRock(x: number, y: number, rocks: Rock[]): Rock | null {
  let nearest: Rock | null = null;
  let minDist = Infinity;
  
  for (const rock of rocks) {
    const dx = x - rock.x;
    const dy = y - rock.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < minDist && dist < rock.diameter + 10) {
      minDist = dist;
      nearest = rock;
    }
  }
  
  return nearest;
}

export function createLeafParticles(x: number, y: number, count: number): Particle[] {
  const particles: Particle[] = [];
  const particleCount = Math.floor(Math.random() * 6) + 15;
  
  for (let i = 0; i < Math.min(count, particleCount); i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 3;
    particles.push({
      id: uuidv4(),
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      color: '#4caf50',
      life: 0.8,
      maxLife: 0.8,
      size: 3 + Math.random() * 4,
      type: 'leaf'
    });
  }
  
  return particles;
}

export function createGoldParticles(centerX: number, centerY: number, count: number): Particle[] {
  const particles: Particle[] = [];
  
  for (let i = 0; i < count; i++) {
    particles.push({
      id: uuidv4(),
      x: centerX + (Math.random() - 0.5) * 400,
      y: centerY - 200 - Math.random() * 100,
      vx: (Math.random() - 0.5) * 2,
      vy: 1 + Math.random() * 3,
      color: '#ffd700',
      life: 2,
      maxLife: 2,
      size: 4 + Math.random() * 6,
      type: 'gold'
    });
  }
  
  return particles;
}
