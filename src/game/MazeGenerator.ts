import type { CellType, MazeData, Rift, Fragment } from '../types/game';

const MAZE_WIDTH = 21;
const MAZE_HEIGHT = 21;
const CELL_SIZE = 40;
const RIFT_COUNT_MIN = 10;
const RIFT_COUNT_MAX = 15;
const FRAGMENT_COUNT = 30;

function createGrid(width: number, height: number): CellType[][] {
  const grid: CellType[][] = [];
  for (let y = 0; y < height; y++) {
    grid[y] = [];
    for (let x = 0; x < width; x++) {
      grid[y][x] = 1;
    }
  }
  return grid;
}

function recursiveDivide(
  grid: CellType[][],
  x: number,
  y: number,
  width: number,
  height: number
): void {
  if (width < 3 || height < 3) return;

  const horizontal = height >= width;

  if (horizontal) {
    const wallY = y + 2 + Math.floor(Math.random() * Math.floor((height - 2) / 2)) * 2;
    const passageX = x + 1 + Math.floor(Math.random() * Math.floor((width - 1) / 2)) * 2;

    for (let i = x; i < x + width; i++) {
      if (i !== passageX) {
        grid[wallY][i] = 1;
      } else {
        grid[wallY][i] = 0;
      }
    }

    for (let i = x; i < x + width; i++) {
      if (grid[wallY - 1]) grid[wallY - 1][i] = 0;
      if (grid[wallY + 1]) grid[wallY + 1][i] = 0;
    }

    recursiveDivide(grid, x, y, width, wallY - y);
    recursiveDivide(grid, x, wallY + 1, width, y + height - wallY - 1);
  } else {
    const wallX = x + 2 + Math.floor(Math.random() * Math.floor((width - 2) / 2)) * 2;
    const passageY = y + 1 + Math.floor(Math.random() * Math.floor((height - 1) / 2)) * 2;

    for (let i = y; i < y + height; i++) {
      if (i !== passageY) {
        grid[i][wallX] = 1;
      } else {
        grid[i][wallX] = 0;
      }
    }

    for (let i = y; i < y + height; i++) {
      if (grid[i]) grid[i][wallX - 1] = 0;
      if (grid[i]) grid[i][wallX + 1] = 0;
    }

    recursiveDivide(grid, x, y, wallX - x, height);
    recursiveDivide(grid, wallX + 1, y, x + width - wallX - 1, height);
  }
}

function generateBaseMaze(): CellType[][] {
  const grid = createGrid(MAZE_WIDTH, MAZE_HEIGHT);

  for (let y = 0; y < MAZE_HEIGHT; y++) {
    for (let x = 0; x < MAZE_WIDTH; x++) {
      if (x > 0 && x < MAZE_WIDTH - 1 && y > 0 && y < MAZE_HEIGHT - 1) {
        grid[y][x] = 0;
      }
    }
  }

  recursiveDivide(grid, 1, 1, MAZE_WIDTH - 2, MAZE_HEIGHT - 2);

  grid[1][1] = 0;
  grid[1][2] = 0;
  grid[2][1] = 0;
  grid[MAZE_HEIGHT - 2][MAZE_WIDTH - 2] = 0;
  grid[MAZE_HEIGHT - 2][MAZE_WIDTH - 3] = 0;
  grid[MAZE_HEIGHT - 3][MAZE_WIDTH - 2] = 0;

  return grid;
}

function findWallCells(grid: CellType[][]): { x: number; y: number; direction: 'horizontal' | 'vertical' }[] {
  const walls: { x: number; y: number; direction: 'horizontal' | 'vertical' }[] = [];

  for (let y = 1; y < MAZE_HEIGHT - 1; y++) {
    for (let x = 1; x < MAZE_WIDTH - 1; x++) {
      if (grid[y][x] === 1) {
        if (y > 0 && y < MAZE_HEIGHT - 1 && grid[y - 1][x] === 0 && grid[y + 1][x] === 0) {
          walls.push({ x, y, direction: 'horizontal' });
        }
        if (x > 0 && x < MAZE_WIDTH - 1 && grid[y][x - 1] === 0 && grid[y][x + 1] === 0) {
          walls.push({ x, y, direction: 'vertical' });
        }
      }
    }
  }

  return walls;
}

function createRifts(grid: CellType[][]): Rift[] {
  const riftCount = RIFT_COUNT_MIN + Math.floor(Math.random() * (RIFT_COUNT_MAX - RIFT_COUNT_MIN + 1));
  const walls = findWallCells(grid);
  const rifts: Rift[] = [];
  const used = new Set<string>();

  for (let i = 0; i < riftCount && walls.length > 0; i++) {
    const idx = Math.floor(Math.random() * walls.length);
    const wall = walls[idx];
    const key = `${wall.x},${wall.y}`;

    if (!used.has(key)) {
      grid[wall.y][wall.x] = 0;
      rifts.push({ x: wall.x, y: wall.y, direction: wall.direction });
      used.add(key);
    }

    walls.splice(idx, 1);
  }

  return rifts;
}

function findPathCells(grid: CellType[][]): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < MAZE_HEIGHT; y++) {
    for (let x = 0; x < MAZE_WIDTH; x++) {
      if (grid[y][x] === 0) {
        if (!(x === 1 && y === 1) && !(x === MAZE_WIDTH - 2 && y === MAZE_HEIGHT - 2)) {
          cells.push({ x, y });
        }
      }
    }
  }
  return cells;
}

function createFragments(grid: CellType[][]): Fragment[] {
  const pathCells = findPathCells(grid);
  const fragments: Fragment[] = [];
  const shuffled = [...pathCells].sort(() => Math.random() - 0.5);

  const count = Math.min(FRAGMENT_COUNT, shuffled.length);
  for (let i = 0; i < count; i++) {
    const cell = shuffled[i];
    fragments.push({
      id: i,
      x: cell.x * CELL_SIZE + CELL_SIZE / 2,
      y: cell.y * CELL_SIZE + CELL_SIZE / 2,
      rotation: Math.random() * Math.PI * 2,
      collected: false,
      collectParticles: [],
    });
  }

  return fragments;
}

export function generateMaze(): { maze: MazeData; fragments: Fragment[] } {
  const grid = generateBaseMaze();
  const rifts = createRifts(grid);
  const fragments = createFragments(grid);

  const maze: MazeData = {
    grid,
    width: MAZE_WIDTH,
    height: MAZE_HEIGHT,
    cellSize: CELL_SIZE,
    rifts,
    exit: { gridX: MAZE_WIDTH - 2, gridY: MAZE_HEIGHT - 2 },
  };

  return { maze, fragments };
}

export function getSpawnPosition(cellSize: number): { x: number; y: number } {
  return {
    x: 1 * cellSize + cellSize / 2,
    y: 1 * cellSize + cellSize / 2,
  };
}

export function getExitPosition(maze: MazeData): { x: number; y: number } {
  return {
    x: maze.exit.gridX * maze.cellSize + maze.cellSize / 2,
    y: maze.exit.gridY * maze.cellSize + maze.cellSize / 2,
  };
}
