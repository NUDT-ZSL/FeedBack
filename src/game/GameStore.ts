import { create } from 'zustand';
import {
  GridCell,
  WaterParticle,
  WaterSplash,
  Direction,
  PipeType,
  GameState,
  GameActions,
  PIPE_CONNECTIONS,
  DIRECTION_OFFSETS,
  OPPOSITE_DIRECTION,
  LEVEL_CONFIGS,
  COLORS,
} from './types';

const initializeGrid = (levelIndex: number): GridCell[][] => {
  const config = LEVEL_CONFIGS[levelIndex];
  const grid: GridCell[][] = [];

  for (let y = 0; y < config.gridSize; y++) {
    const row: GridCell[] = [];
    for (let x = 0; x < config.gridSize; x++) {
      const isWaterSource = x === config.waterSource.x && y === config.waterSource.y;
      const isTarget = x === config.target.x && y === config.target.y;
      const terrainType = (x + y) % 3 === 0 ? 'sand' : 'grass';

      row.push({
        x,
        y,
        pipeType: isWaterSource || isTarget ? 'straight' : null,
        rotation: isWaterSource ? 1 : isTarget ? 3 : 0,
        isWaterSource,
        isTarget,
        terrainType,
      });
    }
    grid.push(row);
  }

  return grid;
};

const getRotatedConnections = (pipeType: PipeType, rotation: Direction): Direction[] => {
  const baseConnections = PIPE_CONNECTIONS[pipeType];
  return baseConnections.map((dir) => ((dir + rotation) % 4) as Direction);
};

const findWaterPath = (grid: GridCell[][]): { x: number; y: number }[] => {
  let sourceCell: GridCell | null = null;
  let targetCell: GridCell | null = null;

  for (const row of grid) {
    for (const cell of row) {
      if (cell.isWaterSource) sourceCell = cell;
      if (cell.isTarget) targetCell = cell;
    }
  }

  if (!sourceCell || !targetCell) return [];

  const visited = new Set<string>();
  const queue: { cell: GridCell; path: { x: number; y: number }[] }[] = [
    { cell: sourceCell, path: [{ x: sourceCell.x, y: sourceCell.y }] },
  ];

  while (queue.length > 0) {
    const { cell, path } = queue.shift()!;
    const key = `${cell.x},${cell.y}`;

    if (visited.has(key)) continue;
    visited.add(key);

    if (cell.x === targetCell.x && cell.y === targetCell.y) {
      return path;
    }

    if (!cell.pipeType) continue;

    const connections = getRotatedConnections(cell.pipeType, cell.rotation);

    for (const dir of connections) {
      const { dx, dy } = DIRECTION_OFFSETS[dir];
      const nx = cell.x + dx;
      const ny = cell.y + dy;

      if (nx < 0 || ny < 0 || ny >= grid.length || nx >= grid[0].length) continue;

      const neighbor = grid[ny][nx];
      if (!neighbor.pipeType) continue;

      const neighborConnections = getRotatedConnections(neighbor.pipeType, neighbor.rotation);
      const oppositeDir = OPPOSITE_DIRECTION[dir];

      if (neighborConnections.includes(oppositeDir)) {
        const newPath = [...path, { x: nx, y: ny }];
        queue.push({ cell: neighbor, path: newPath });
      }
    }
  }

  return [];
};

let particleIdCounter = 0;
let splashIdCounter = 0;

const lerpColor = (color1: string, color2: string, t: number): string => {
  const c1 = hexToRgb(color1);
  const c2 = hexToRgb(color2);
  const r = Math.round(c1.r + (c2.r - c1.r) * t);
  const g = Math.round(c1.g + (c2.g - c1.g) * t);
  const b = Math.round(c1.b + (c2.b - c1.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
};

const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 };
};

export const useGameStore = create<GameState & GameActions>((set, get) => ({
  currentLevel: 0,
  grid: initializeGrid(0),
  steps: 0,
  waterPath: [],
  particles: [],
  splashes: [],
  isWaterFlowing: false,
  isLevelComplete: false,
  stars: 0,
  showHint: false,
  hintText: '',
  hintOpacity: 0,
  selectedPipe: null,
  waterWheelRotation: 0,
  showWaterWheel: false,
  levelConfigs: LEVEL_CONFIGS,

  placePipe: (x: number, y: number, type: PipeType) => {
    const state = get();
    const cell = state.grid[y]?.[x];
    if (!cell || cell.isWaterSource || cell.isTarget || cell.pipeType) return;

    const newGrid = state.grid.map((row) =>
      row.map((c) => (c.x === x && c.y === y ? { ...c, pipeType: type, rotation: 0 as Direction } : c))
    );

    set({
      grid: newGrid,
      steps: state.steps + 1,
      selectedPipe: null,
    });

    get().checkWaterFlow();
  },

  rotatePipe: (x: number, y: number) => {
    const state = get();
    const cell = state.grid[y]?.[x];
    if (!cell || cell.isWaterSource || cell.isTarget || !cell.pipeType) return;

    const newRotation = ((cell.rotation + 1) % 4) as Direction;
    const now = performance.now();

    const newGrid = state.grid.map((row) =>
      row.map((c) =>
        c.x === x && c.y === y
          ? {
              ...c,
              rotation: newRotation,
              rotationAnimation: {
                startTime: now,
                startRotation: cell.rotation,
                targetRotation: newRotation,
              },
            }
          : c
      )
    );

    set({
      grid: newGrid,
      steps: state.steps + 1,
    });

    setTimeout(() => {
      const currentState = get();
      const clearedGrid = currentState.grid.map((row) =>
        row.map((c) => {
          if (c.x === x && c.y === y && c.rotationAnimation) {
            const { rotationAnimation, ...rest } = c;
            return rest;
          }
          return c;
        })
      );
      set({ grid: clearedGrid });
    }, 200);

    get().checkWaterFlow();
  },

  resetLevel: () => {
    const state = get();
    set({
      grid: initializeGrid(state.currentLevel),
      steps: 0,
      waterPath: [],
      particles: [],
      splashes: [],
      isWaterFlowing: false,
      isLevelComplete: false,
      stars: 0,
      showHint: false,
      hintText: '',
      hintOpacity: 0,
      selectedPipe: null,
      waterWheelRotation: 0,
      showWaterWheel: false,
    });
  },

  selectPipe: (type: PipeType | null) => {
    set({ selectedPipe: type });
  },

  nextLevel: () => {
    const state = get();
    const nextLevel = Math.min(state.currentLevel + 1, LEVEL_CONFIGS.length - 1);
    set({
      currentLevel: nextLevel,
      grid: initializeGrid(nextLevel),
      steps: 0,
      waterPath: [],
      particles: [],
      splashes: [],
      isWaterFlowing: false,
      isLevelComplete: false,
      stars: 0,
      showHint: false,
      hintText: '',
      hintOpacity: 0,
      selectedPipe: null,
      waterWheelRotation: 0,
      showWaterWheel: false,
    });
  },

  checkWaterFlow: () => {
    const state = get();
    const path = findWaterPath(state.grid);

    if (path.length > 0) {
      const config = LEVEL_CONFIGS[state.currentLevel];
      let stars = 0;
      if (state.steps <= config.starThresholds[0]) stars = 3;
      else if (state.steps <= config.starThresholds[1]) stars = 2;
      else if (state.steps <= config.starThresholds[2]) stars = 1;

      const targetCell = path[path.length - 1];
      const newSplashes: WaterSplash[] = [];
      for (let i = 0; i < 30; i++) {
        newSplashes.push({
          id: splashIdCounter++,
          x: targetCell.x,
          y: targetCell.y,
          vx: (Math.random() - 0.5) * 4,
          vy: -Math.random() * 3 - 1,
          size: 2 + Math.random() * 3,
          life: 1,
          maxLife: 1,
        });
      }

      set({
        waterPath: path,
        isWaterFlowing: true,
        isLevelComplete: true,
        stars,
        showWaterWheel: true,
        splashes: newSplashes,
      });
    } else {
      set({
        waterPath: [],
        isWaterFlowing: false,
        isLevelComplete: false,
        stars: 0,
        showWaterWheel: false,
        splashes: [],
      });
    }
  },

  updateParticles: (deltaTime: number) => {
    const state = get();
    if (!state.isWaterFlowing || state.waterPath.length < 2) {
      set({
        particles: state.particles.filter(() => false),
      });
      return;
    }

    let newParticles = [...state.particles];
    const path = state.waterPath;
    const speed = 0.02 * deltaTime * 60;

    if (Math.random() < 0.3) {
      const colorT = Math.random();
      newParticles.push({
        id: particleIdCounter++,
        x: path[0].x + 0.5,
        y: path[0].y + 0.5,
        targetX: path[1] ? path[1].x + 0.5 : path[0].x + 0.5,
        targetY: path[1] ? path[1].y + 0.5 : path[0].y + 0.5,
        progress: 0,
        pathIndex: 0,
        color: lerpColor(COLORS.waterStart, COLORS.waterEnd, colorT),
      });
    }

    if (newParticles.length > 200) {
      newParticles = newParticles.slice(-200);
    }

    newParticles = newParticles
      .map((p) => {
        let { progress, pathIndex, x, y, targetX, targetY } = p;
        progress += speed;

        if (progress >= 1) {
          progress = 0;
          pathIndex++;

          if (pathIndex >= path.length - 1) {
            return null;
          }

          x = targetX;
          y = targetY;
          targetX = path[pathIndex + 1].x + 0.5;
          targetY = path[pathIndex + 1].y + 0.5;
        }

        const currentX = x + (targetX - x) * progress;
        const currentY = y + (targetY - y) * progress;

        return {
          ...p,
          x: currentX,
          y: currentY,
          progress,
          pathIndex,
          targetX,
          targetY,
        };
      })
      .filter((p): p is WaterParticle => p !== null);

    let newSplashes = state.splashes
      .map((s) => ({
        ...s,
        x: s.x + s.vx * deltaTime * 0.06,
        y: s.y + s.vy * deltaTime * 0.06,
        vy: s.vy + 0.1 * deltaTime * 0.06,
        life: s.life - deltaTime * 0.001,
      }))
      .filter((s) => s.life > 0);

    let newWaterWheelRotation = state.waterWheelRotation;
    if (state.showWaterWheel) {
      newWaterWheelRotation += deltaTime * 0.006;
    }

    set({
      particles: newParticles,
      splashes: newSplashes,
      waterWheelRotation: newWaterWheelRotation,
    });
  },

  setHint: (text: string) => {
    set({
      showHint: true,
      hintText: text,
      hintOpacity: 1,
    });
  },

  updateHintOpacity: (deltaTime: number) => {
    const state = get();
    if (state.hintOpacity > 0) {
      const newOpacity = Math.max(0, state.hintOpacity - deltaTime * 0.0005);
      set({
        hintOpacity: newOpacity,
        showHint: newOpacity > 0,
      });
    }
  },
}));
